from __future__ import annotations

import base64
import http.server
import importlib.util
import ipaddress
import io
import json
import os
import pathlib
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from unittest import mock
from urllib.parse import urlsplit

HOST_PATH = pathlib.Path(__file__).resolve().parents[1] / "host.py"
SPEC = importlib.util.spec_from_file_location("fluxcatch_host", HOST_PATH)
host = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = host
SPEC.loader.exec_module(host)

FILE_BYTES = bytes(range(256)) * 131_072  # 32 MiB, enough for multiple ranges.
SEGMENTS = {"/seg0.ts": b"first-segment\n", "/seg1.ts": b"second-segment\n", "/seg2.ts": b"third-segment\n"}
HLS_VIDEO_SEGMENTS = {
    "/separate-video-0.ts": b"separate-video-zero|",
    "/separate-video-1.ts": b"separate-video-one|",
}
HLS_AUDIO_SEGMENTS = {
    "/separate-audio-0.aac": b"separate-audio-zero|",
    "/separate-audio-1.aac": b"separate-audio-one|",
}
PACKED = b"init-aaaabbbbccccddddeeee"
DASH_FILES = {
    "/dash/init-stream0.m4s": b"video-init|",
    "/dash/chunk-stream0-00001.m4s": b"video-one|",
    "/dash/init-stream1.m4s": b"audio-init|",
    "/dash/chunk-stream1-00001.m4s": b"audio-one|",
    "/dash/chunk-stream1-00002.m4s": b"audio-two|",
    "/dash/chunk-stream1-00003.m4s": b"audio-three|",
}
DASH_PAIR_VIDEO = b"fixture-fmp4-video-track"
DASH_PAIR_AUDIO = b"fixture-fmp4-audio-track"
DASH_MPD = b'''<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT3S">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="0" bandwidth="60000" width="640" height="360">
        <SegmentTemplate timescale="12288" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1">
          <SegmentTimeline><S t="0" d="36864"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation id="1" bandwidth="69000">
        <SegmentTemplate timescale="44100" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1">
          <SegmentTimeline><S t="0" d="44032"/><S d="45056"/><S d="44032"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>'''


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # Tests may inject {"path": {"body": bytes, "mime": str}} for generated
    # fixtures; consulted before the fixed routes and restored by the test.
    dynamic_routes = {}
    request_log: list[tuple[str, str]] = []
    log_lock = threading.Lock()

    def log_message(self, _format, *_args):
        pass

    @classmethod
    def reset(cls):
        with cls.log_lock:
            cls.request_log.clear()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path in {"/file.bin", "/bad-range.bin", "/range-no-id.bin"}:
            self.send_response(200)
            self.send_header("Content-Length", str(len(FILE_BYTES)))
            self.send_header("Accept-Ranges", "bytes")
            if path != "/range-no-id.bin":
                self.send_header("ETag", '"fixture-v1"')
            self.end_headers()
        elif path == "/no-range.bin":
            self.send_response(200)
            self.send_header("Content-Length", str(len(FILE_BYTES)))
            self.end_headers()
        elif path == "/hotlink-page.mp4":
            # Hotlink/expiry fallback: the CDN answers a media URL with the
            # site's own page, declared as text/html.
            self._bytes(
                b"<!DOCTYPE html><html><head><title>watch page</title></head><body>full page</body></html>",
                "text/html; charset=utf-8",
            )
        elif path == "/hotlink-page-untyped.mp4":
            # Same fallback with no Content-Type; the first body bytes decide.
            self._bytes(b"\n<html><body>untyped page</body></html>")
        elif path in {"/dash-pair/video.m4s", "/dash-pair/audio.m4s"}:
            data = DASH_PAIR_VIDEO if path.endswith("video.m4s") else DASH_PAIR_AUDIO
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
        else:
            self.send_error(404)

    def do_GET(self):
        path = urlsplit(self.path).path
        range_header = self.headers.get("Range") or ""
        with self.log_lock:
            self.request_log.append((path, range_header))

        dynamic = FixtureHandler.dynamic_routes.get(path)
        if dynamic is not None:
            self._bytes(dynamic["body"], dynamic.get("mime", "application/octet-stream"))
            return
        if path == "/aes/index.m3u8":
            self._bytes(
                b"#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:7\n"
                b'#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001\n'
                b"#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n",
                "application/vnd.apple.mpegurl",
            )
            return
        if path == "/aes/key.bin":
            self._bytes(bytes(range(16)), "application/octet-stream")
            return
        if path in {"/aes/seg0.ts", "/aes/seg1.ts"}:
            self._bytes(FILE_BYTES)
            return
        if path == "/hotlink-page.mp4":
            self._bytes(
                b"<!DOCTYPE html><html><head><title>watch page</title></head><body>full page</body></html>",
                "text/html; charset=utf-8",
            )
            return
        if path == "/hotlink-page-untyped.mp4":
            self._bytes(b"\n<html><body>untyped page</body></html>")
            return
        if path == "/redirect.bin":
            self.send_response(302)
            self.send_header("Location", "/no-range.bin?token=REDIRECT_SECRET")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path in {"/file.bin", "/bad-range.bin", "/range-no-id.bin", "/head-rejected-range.bin"}:
            if range_header:
                start, end = map(int, range_header.removeprefix("bytes=").split("-"))
                actual_start, actual_end = start, end
                if path == "/bad-range.bin" and (start, end) != (0, 0):
                    actual_start = min(end, start + 1)
                data = FILE_BYTES[actual_start : actual_end + 1]
                self.send_response(206)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Range", f"bytes {actual_start}-{actual_end}/{len(FILE_BYTES)}")
                self.send_header("Accept-Ranges", "bytes")
                if path != "/range-no-id.bin":
                    self.send_header("ETag", '"fixture-v1"')
                self.end_headers()
                self._write(data)
                return
            self._bytes(FILE_BYTES)
            return
        if path == "/no-range.bin":
            self._bytes(FILE_BYTES)
            return
        if path == "/master.m3u8":
            self._bytes(b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nmedia.m3u8\n", "application/vnd.apple.mpegurl")
            return
        if path == "/media.m3u8":
            body = b"#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/separate-master.m3u8":
            body = b'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,URI="audio-drm.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,AUDIO="audio"\nmedia.m3u8\n'
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/audio-drm.m3u8":
            body = b'#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fixture"\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n'
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/separate-clear-master.m3u8":
            body = (
                b'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Alternate",DEFAULT=NO,AUTOSELECT=YES,URI="audio-alternate.m3u8"\n'
                b'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,AUTOSELECT=YES,URI="audio-default.m3u8"\n'
                b'#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,AUDIO="audio"\nseparate-video.m3u8\n'
            )
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/separate-video.m3u8":
            body = b"#EXTM3U\n#EXTINF:4,\nseparate-video-0.ts\n#EXTINF:4,\nseparate-video-1.ts\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/rendition/video-1080.m3u8":
            body = b"#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/separate-video-0.ts\n#EXTINF:4,\n/separate-video-1.ts\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/rendition/video-720.m3u8":
            body = b"#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/separate-video-1.ts\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/rendition/audio.m3u8":
            body = b"#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/separate-audio-0.aac\n#EXTINF:4,\n/separate-audio-1.aac\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/audio-default.m3u8":
            body = b"#EXTM3U\n#EXTINF:4,\nseparate-audio-0.aac\n#EXTINF:4,\nseparate-audio-1.aac\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/audio-alternate.m3u8":
            body = b"#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/byterange.m3u8":
            body = b"#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:4@0\npacked.bin\n#EXTINF:1,\n#EXT-X-BYTERANGE:4\npacked.bin\n#EXTINF:1,\n#EXT-X-BYTERANGE:5@8\npacked.bin\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/bad-byterange.m3u8":
            body = b"#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:4@0\npacked-ignore.bin\n#EXT-X-ENDLIST\n"
            self._bytes(body, "application/vnd.apple.mpegurl")
            return
        if path == "/packed.bin":
            if range_header:
                start, end = map(int, range_header.removeprefix("bytes=").split("-"))
                data = PACKED[start : end + 1]
                self.send_response(206)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(PACKED)}")
                self.end_headers()
                self._write(data)
                return
            self._bytes(PACKED)
            return
        if path == "/packed-ignore.bin":
            self._bytes(PACKED)
            return
        if path in SEGMENTS:
            self._bytes(SEGMENTS[path], "video/mp2t")
            return
        if path in HLS_VIDEO_SEGMENTS:
            self._bytes(HLS_VIDEO_SEGMENTS[path], "video/mp2t")
            return
        if path in HLS_AUDIO_SEGMENTS:
            self._bytes(HLS_AUDIO_SEGMENTS[path], "audio/aac")
            return
        if path == "/dash/out.mpd":
            self._bytes(DASH_MPD, "application/dash+xml")
            return
        if path in DASH_FILES:
            self._bytes(DASH_FILES[path], "video/iso.segment")
            return
        if path == "/dash-pair/video.m4s":
            self._bytes(DASH_PAIR_VIDEO, "video/iso.segment")
            return
        if path == "/dash-pair/audio.m4s":
            self._bytes(DASH_PAIR_AUDIO, "audio/mp4")
            return
        self.send_error(404)

    def _bytes(self, data: bytes, mime="application/octet-stream"):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self._write(data)

    def _write(self, data: bytes):
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class LoopbackServer(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Avoid reverse-DNS lookup in HTTPServer.server_bind; fixtures are local.
        socketserver.TCPServer.server_bind(self)
        address, port = self.server_address[:2]
        self.server_name = address
        self.server_port = port


class HeaderLineageHandler(http.server.BaseHTTPRequestHandler):
    """Configurable redirect fixture that records every received header."""

    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        headers = {key.lower(): value for key, value in self.headers.items()}
        with self.server.log_lock:
            self.server.request_log.append((path, headers))
        route = self.server.routes.get(path)
        if route is None:
            self.send_error(404)
            return
        if "redirect" in route:
            self.send_response(302)
            self.send_header("Location", route["redirect"])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = route["body"]
        self.send_response(200)
        self.send_header("Content-Type", route.get("mime", "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class ChunkedReader(io.BytesIO):
    def read(self, size=-1):
        return super().read(1 if size < 0 else min(size, 1))


class FakeResponse:
    def __init__(self, chunks: list[bytes], length: int, cancel: threading.Event | None = None):
        self.chunks = list(chunks)
        self.headers = {"Content-Length": str(length)}
        self.status = 200
        self.cancel = cancel

    def read(self, _size=-1):
        if not self.chunks:
            return b""
        result = self.chunks.pop(0)
        if self.cancel is not None:
            self.cancel.set()
        return result

    def close(self):
        pass


class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = LoopbackServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        FixtureHandler.reset()

        def fixture_resolver(hostname, port, **_kwargs):
            if hostname in {"127.0.0.1", "::1"}:
                return socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]

        self.network_token = host.set_current_network_policy(host.NetworkPolicy(
            allow_private_network_media=True,
            resolver=fixture_resolver,
        ))

    def tearDown(self):
        host.reset_current_network_policy(self.network_token)

    def start_lineage_server(self):
        server = LoopbackServer(("127.0.0.1", 0), HeaderLineageHandler)
        server.routes = {}
        server.request_log = []
        server.log_lock = threading.Lock()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # Cleanups run in reverse registration order: shutdown, then close.
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, f"http://127.0.0.1:{server.server_port}"

    def test_validation_and_filename_byte_limit(self):
        self.assertEqual(host.valid_url("https://example.test/a"), "https://example.test/a")
        for value in ("file:///etc/passwd", "https://user:pass@example.test/a", "https://example.test/a\r\nX: y"):
            with self.subTest(value=value), self.assertRaises(host.DownloadError):
                host.valid_url(value)
        self.assertEqual(host.safe_filename("../bad:name?.mp4"), "_bad_name_.mp4")
        self.assertEqual(host.safe_filename("COM9.txt"), "_COM9.txt")
        self.assertLessEqual(len(host.safe_filename("😀" * 200 + ".mp4").encode("utf-8")), 200)
        self.assertNotIn("x-extra", host.clean_headers({"X-Extra": "no", "Cookie": "a=b"}))
        self.assertEqual(host.clean_headers({"Cookie": "a=b"})["cookie"], "a=b")

    def test_redirect_strips_credentials_cross_origin(self):
        request = host.urllib.request.Request(
            "https://one.example/file",
            headers={
                "Authorization": "Bearer secret",
                "Cookie": "a=b",
                "Referer": "https://page.example/",
                "If-Range": '"private-etag"',
                "If-Match": '"private-match"',
                "Accept": "*/*",
            },
        )
        peer_socket = mock.Mock()
        peer_socket.getpeername.return_value = ("93.184.216.34", 443)
        peer_response = mock.Mock()
        peer_response._sock = peer_socket
        redirected = host.SafeRedirectHandler().redirect_request(request, peer_response, 302, "Found", {}, "https://two.example/file")
        self.assertIsNotNone(redirected)
        lowered = {key.lower(): value for key, value in redirected.headers.items()}
        self.assertNotIn("authorization", lowered)
        self.assertNotIn("cookie", lowered)
        self.assertNotIn("referer", lowered)
        self.assertNotIn("if-range", lowered)
        self.assertNotIn("if-match", lowered)
        self.assertEqual(lowered["accept"], "*/*")

        same_origin = host.urllib.request.Request(
            "https://one.example/file",
            headers={"If-Range": '"same-etag"', "If-Match": '"same-match"'},
        )
        same_redirect = host.SafeRedirectHandler().redirect_request(
            same_origin,
            peer_response,
            302,
            "Found",
            {},
            "https://one.example/next",
        )
        same_headers = {key.lower(): value for key, value in same_redirect.headers.items()}
        self.assertEqual(same_headers["if-range"], '"same-etag"')
        self.assertEqual(same_headers["if-match"], '"same-match"')

        with self.assertRaisesRegex(host.NetworkPolicyError, "downgrade"):
            host.SafeRedirectHandler().redirect_request(
                same_origin,
                peer_response,
                302,
                "Found",
                {},
                "http://one.example/insecure",
            )

        same = host.scope_subresource_headers(
            "https://media.example/manifest.m3u8",
            ["https://media.example/segment.ts"],
            {"cookie": "session=fixture", "referer": "https://page.example/", "user-agent": "fixture"},
        )
        self.assertIn("cookie", same)
        cross = host.scope_subresource_headers(
            "https://media.example/manifest.m3u8",
            ["https://cdn.example/segment.ts"],
            same,
        )
        self.assertNotIn("cookie", cross)
        self.assertNotIn("referer", cross)
        self.assertEqual(cross["user-agent"], "fixture")

    def test_network_policy_blocks_non_public_targets_and_allows_explicit_private_opt_in(self):
        def resolver_for(address):
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            return lambda _hostname, port, **_kwargs: [
                (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port))
            ]

        blocked = [
            "127.0.0.1",
            "::1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "0.0.0.0",
            "224.0.0.1",
            "240.0.0.1",
            "169.254.169.254",
            "100.100.100.200",
            "fec0::1",
            "100::1",
            "2001::1",
            "2001:db8::1",
            "3fff::1",
            "2001:10::1",
            "2001:20::1",
            "5f00::1",
        ]
        for address in blocked:
            policy = host.NetworkPolicy(resolver=resolver_for(address))
            with self.subTest(address=address), self.assertRaises(host.NetworkPolicyError):
                policy.authorize("https://target.example/media")

        public = host.NetworkPolicy(resolver=resolver_for("93.184.216.34"))
        target = public.authorize("https://public.example/media?token=SECRET")
        self.assertEqual(target.addresses, frozenset({"93.184.216.34"}))

        for address in ("127.0.0.1", "10.20.30.40", "172.20.30.40", "192.168.30.40", "::1", "fd00::1"):
            private = host.NetworkPolicy(
                allow_private_network_media=True,
                resolver=resolver_for(address),
            )
            self.assertEqual(
                private.authorize("http://nas.example/video").addresses,
                frozenset({str(ipaddress.ip_address(address))}),
            )

        transition_private = [
            "::ffff:192.168.1.2",
            "::192.168.1.2",
            "64:ff9b::192.168.1.2",
            "64:ff9b:1:c0a8:1:200::",
            "2002:c0a8:0102::",
        ]
        for address in transition_private:
            denied = host.NetworkPolicy(resolver=resolver_for(address))
            with self.subTest(transition_private_denied=address), self.assertRaises(host.NetworkPolicyError):
                denied.authorize("https://transition.example/video")
            allowed = host.NetworkPolicy(
                allow_private_network_media=True,
                resolver=resolver_for(address),
            )
            self.assertEqual(
                allowed.authorize("https://transition.example/video").addresses,
                frozenset({str(ipaddress.ip_address(address))}),
            )

        transition_public = [
            "::ffff:8.8.8.8",
            "::8.8.8.8",
            "64:ff9b::8.8.8.8",
            "64:ff9b:1:808:8:800::",
            "2002:0808:0808::",
            "2606:4700:4700::1111",
        ]
        for address in transition_public:
            allowed = host.NetworkPolicy(resolver=resolver_for(address))
            self.assertEqual(
                allowed.authorize("https://transition.example/video").addresses,
                frozenset({str(ipaddress.ip_address(address))}),
            )

        for address in (
            "169.254.169.254",
            "100.100.100.200",
            "240.0.0.1",
            "100.64.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "198.18.0.1",
            "fec0::1",
            "100::1",
            "2001::1",
            "2001:db8::1",
            "3fff::1",
            "2001:10::1",
            "2001:20::1",
            "5f00::1",
            "::ffff:169.254.169.254",
            "::192.0.2.1",
            "64:ff9b::169.254.169.254",
            "64:ff9b:1:a9fe:a9:fe00::",
            "64:ff9b:1::c0a8:102",
            "2002:c000:0201::",
        ):
            always_blocked = host.NetworkPolicy(
                allow_private_network_media=True,
                resolver=resolver_for(address),
            )
            with self.subTest(always_blocked=address), self.assertRaises(host.NetworkPolicyError):
                always_blocked.authorize("http://metadata.example/latest")

        metadata_names = ("metadata", "metadata.aws.internal", "metadata.azure.internal", "metadata.google.internal")
        for hostname in metadata_names:
            policy = host.NetworkPolicy(
                allow_private_network_media=True,
                resolver=resolver_for("93.184.216.34"),
            )
            with self.subTest(metadata_hostname=hostname), self.assertRaises(host.NetworkPolicyError):
                policy.authorize(f"http://{hostname}/latest")

    def test_network_policy_rechecks_redirects_manifest_children_peers_and_redacts_queries(self):
        addresses = {
            "one.example": "93.184.216.34",
            "two.example": "10.0.0.5",
            "media.example": "93.184.216.34",
            "changed.example": "93.184.216.35",
        }

        def resolver(hostname, port, **_kwargs):
            address = addresses.get(hostname, hostname)
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port))]

        policy = host.NetworkPolicy(resolver=resolver)
        token = host.set_current_network_policy(policy)
        try:
            redirect_request = host.urllib.request.Request("https://one.example/file")
            with self.assertRaises(host.NetworkPolicyError):
                host.SafeRedirectHandler().redirect_request(
                    redirect_request,
                    None,
                    302,
                    "Found",
                    {},
                    "https://two.example/private",
                )

            playlist = host.HlsPlaylist(
                url="https://media.example/index.m3u8",
                segments=[host.HlsSegment("http://127.0.0.1/admin")],
            )
            with self.assertRaises(host.DownloadError):
                host.authorize_hls_playlist(playlist)
            with self.assertRaises(host.DownloadError):
                host.ffmpeg_download(
                    "http://127.0.0.1/private.m3u8",
                    pathlib.Path("blocked.mp4"),
                    {},
                    threading.Event(),
                    host.Progress(lambda _event: None, "blocked", "blocked.mp4"),
                    "/fixture/ffmpeg",
                )

            authorized = policy.authorize("https://one.example/file")
            with self.assertRaises(host.NetworkPolicyError):
                policy.validate_peer("93.184.216.35", authorized)
        finally:
            host.reset_current_network_policy(token)

        private_policy = host.NetworkPolicy(resolver=lambda _hostname, port, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", port))
        ])
        token = host.set_current_network_policy(private_policy)
        try:
            with mock.patch.object(host.HTTP_OPENER, "open") as network_open, self.assertRaises(
                host.NetworkPolicyDownloadError
            ) as blocked:
                host.request("http://blocked.example/private?token=TOP_SECRET", {})
            network_open.assert_not_called()
            self.assertNotIn("TOP_SECRET", str(blocked.exception))
        finally:
            host.reset_current_network_policy(token)

        redacted = host.redact_url("https://media.example/path/video.m3u8?token=TOP_SECRET#fragment")
        self.assertEqual(redacted, "https://media.example/…")
        self.assertNotIn("TOP_SECRET", host.redact_text(
            "failed https://media.example/path/video.m3u8?token=TOP_SECRET"
        ))

        response = host.request(f"{self.base}/redirect.bin?entry=SECRET", {})
        try:
            self.assertEqual(response.read(), FILE_BYTES)
            self.assertEqual(urlsplit(response.geturl()).path, "/no-range.bin")
        finally:
            response.close()

    def test_http_connector_pins_the_authorized_ip_before_sending(self):
        policy = host.NetworkPolicy(resolver=lambda _hostname, port, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))
        ])
        policy_token = host.set_current_network_policy(policy)
        target_token = host._ACTIVE_AUTHORIZED_TARGET.set(
            policy.authorize("https://public.example/video")
        )
        connection = mock.Mock()
        connection.getpeername.return_value = ("93.184.216.34", 443)
        try:
            with mock.patch.object(host.socket, "create_connection", return_value=connection) as connect:
                result = host._create_pinned_connection(("public.example", 443), 12, None)
            self.assertIs(result, connection)
            connect.assert_called_once_with(("93.184.216.34", 443), 12, None)

            with mock.patch.object(host.socket, "create_connection") as connect:
                with self.assertRaisesRegex(OSError, "did not match"):
                    host._create_pinned_connection(("other.example", 443), 12, None)
            connect.assert_not_called()
        finally:
            host._ACTIVE_AUTHORIZED_TARGET.reset(target_token)
            host.reset_current_network_policy(policy_token)

    def test_probe_falls_back_to_range_when_cdn_rejects_head(self):
        info = host.probe_direct(f"{self.base}/head-rejected-range.bin", {})

        self.assertTrue(info.range_supported)
        self.assertEqual(info.length, len(FILE_BYTES))
        self.assertEqual(urlsplit(info.final_url).path, "/head-rejected-range.bin")
        self.assertIn(("/head-rejected-range.bin", "bytes=0-0"), FixtureHandler.request_log)

    def test_hls_parser_and_ranges(self):
        parsed = host.parse_hls("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nv.m3u8\n", f"{self.base}/master.m3u8")
        self.assertEqual(parsed.variants[0]["height"], 360)
        self.assertEqual(parsed.variants[0]["url"], f"{self.base}/v.m3u8")
        ranged = host.parse_hls(
            "#EXTM3U\n#EXT-X-MAP:URI=\"packed.bin\",BYTERANGE=\"4@0\"\n#EXT-X-BYTERANGE:4@4\npacked.bin\n#EXT-X-BYTERANGE:5\npacked.bin\n#EXT-X-ENDLIST\n",
            f"{self.base}/index.m3u8",
        )
        self.assertEqual(ranged.init_map_range, "4@0")
        self.assertEqual([segment.byte_range for segment in ranged.segments], ["4@4", "5@8"])
        with self.assertRaises(host.DownloadError):
            host.parse_hls("#EXTM3U\n#EXT-X-BYTERANGE:0@0\na.ts\n", f"{self.base}/bad.m3u8")

        mixed = host.parse_hls(
            '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fixture"\n#EXTINF:1,\na.ts\n'
            '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nb.ts\n',
            f"{self.base}/mixed.m3u8",
        )
        self.assertEqual(mixed.protection, "drm")

    def test_manifest_structural_limits_and_missing_hls_variant_fail_closed(self):
        too_many_segments = "#EXTM3U\n" + "\n".join(
            f"segment-{index}.ts" for index in range(host.MAX_HLS_SEGMENTS + 1)
        )
        with self.assertRaisesRegex(host.DownloadError, "segment limit"):
            host.parse_hls(too_many_segments, "https://media.example/master.m3u8")

        representations = "".join(
            f'<Representation id="v{index}" bandwidth="1"><BaseURL>v{index}.mp4</BaseURL></Representation>'
            for index in range(host.MAX_DASH_REPRESENTATIONS + 1)
        )
        oversized_mpd = (
            '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>'
            '<AdaptationSet contentType="video">'
            f"{representations}</AdaptationSet></Period></MPD>"
        )
        with self.assertRaisesRegex(host.UnsupportedDashError, "Representation limit"):
            host.plan_static_dash(oversized_mpd, "https://media.example/out.mpd")

        master = host.ManifestFetchResult(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\ncurrent.m3u8\n",
            "https://media.example/master.m3u8",
            {},
        )
        with mock.patch.object(host, "fetch_manifest", return_value=master) as fetch:
            with self.assertRaisesRegex(host.DownloadError, "no longer present"):
                host.select_hls_media(
                    master.final_url,
                    {},
                    "https://media.example/removed.m3u8",
                )
        fetch.assert_called_once()

    def test_progress_report_uses_one_throttle_for_manifest_workers(self):
        events = []
        progress = host.Progress(events.append, "bounded-progress", "media.mp4")
        self.assertTrue(progress.report({"status": "downloading", "progress": 0.1}))
        self.assertFalse(progress.report({"status": "downloading", "progress": 0.2}))
        self.assertTrue(progress.report({"status": "downloading", "progress": 1.0}, force=True))
        self.assertEqual([event["progress"] for event in events], [0.1, 1.0])

    def test_manifest_executor_keeps_a_fixed_future_window(self):
        gate = threading.Event()
        fourth_submitted = threading.Event()
        submitted = 0
        submitted_lock = threading.Lock()
        pool = host.concurrent.futures.ThreadPoolExecutor(max_workers=2)
        real_submit = pool.submit

        def counting_submit(*args, **kwargs):
            nonlocal submitted
            with submitted_lock:
                submitted += 1
                if submitted == 4:
                    fourth_submitted.set()
            return real_submit(*args, **kwargs)

        pool.submit = counting_submit
        results = []

        def task(value):
            gate.wait(2)
            return value

        consumer = threading.Thread(target=lambda: results.extend(host._bounded_executor_results(
            pool,
            task,
            ((value,) for value in range(20)),
            max_pending=4,
        )))
        consumer.start()
        self.assertTrue(fourth_submitted.wait(1))
        with submitted_lock:
            self.assertEqual(submitted, 4, "the remaining manifest is not materialized as Futures")
        gate.set()
        consumer.join(3)
        pool.shutdown(wait=True, cancel_futures=True)
        self.assertFalse(consumer.is_alive())
        self.assertEqual(sorted(results), list(range(20)))

    def test_hls_separate_audio_revalidates_alternate_manifest_protection(self):
        FixtureHandler.reset()
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "output.mp4"
            with mock.patch.object(host, "run_ffmpeg") as run:
                with self.assertRaisesRegex(host.DownloadError, "DRM/SAMPLE-AES audio HLS"):
                    host.hls_fast_download(
                        f"{self.base}/separate-master.m3u8",
                        target,
                        {},
                        2,
                        threading.Event(),
                        host.Progress(lambda _event: None, "job", target.name),
                        sys.executable,
                    )
            run.assert_not_called()
        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/audio-drm.m3u8", requested)
        self.assertNotIn("/seg0.ts", requested)

    def test_dash_protection_is_revalidated(self):
        clear = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet/></Period></MPD>'
        protected = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:test"/></AdaptationSet></Period></MPD>'
        self.assertFalse(host.dash_is_protected(clear))
        self.assertTrue(host.dash_is_protected(protected))
        with self.assertRaises(host.DownloadError):
            host.dash_is_protected("<html></html>")

    def test_ffmpeg_capability_probe_is_exact(self):
        results = [
            subprocess.CompletedProcess([], 0, "ffmpeg version 8.1 Copyright fixture\n", ""),
            subprocess.CompletedProcess([], 0, " Demuxers:\n D  hls Apple HLS\n D  webm_dash_manifest WebM manifest\n", ""),
            subprocess.CompletedProcess([], 0, " Encoders:\n A....D libmp3lame MP3\n", ""),
        ]
        with mock.patch.object(host.subprocess, "run", side_effect=results):
            capability = host.probe_ffmpeg(sys.executable)
        self.assertEqual(capability.path, str(pathlib.Path(sys.executable).resolve()))
        self.assertEqual(capability.version, "8.1")
        self.assertTrue(capability.hls_demuxer)
        self.assertFalse(capability.dash_demuxer)  # webm_dash_manifest is not the DASH demuxer.
        self.assertTrue(capability.libmp3lame)
        self.assertEqual(capability.probe_error, "")

    def test_aes128_hls_end_to_end_with_real_ffmpeg(self):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            self.skipTest("ffmpeg is required for the end-to-end AES-128 run")
        key = bytes(range(16))
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "input.mp4"
            key_path = pathlib.Path(directory) / "enc.key"
            keyinfo = pathlib.Path(directory) / "keyinfo"
            key_path.write_bytes(key)
            keyinfo.write_text(f"key.key\n{key_path}\n000102030405060708090a0b0c0d0e0f\n", "utf-8")
            gen = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=15",
                "-f", "lavfi", "-i", "sine=duration=4",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-y", str(source),
            ], capture_output=True)
            if gen.returncode != 0:
                self.skipTest(f"fixture generation failed: {gen.stderr[-120:]!r}")
            playlist = pathlib.Path(directory) / "stream.m3u8"
            enc = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(source),
                "-c", "copy", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
                "-hls_key_info_file", str(keyinfo),
                "-hls_segment_filename", "seg%d.ts",
                str(playlist),
            ], capture_output=True, cwd=directory)
            if enc.returncode != 0:
                self.skipTest(f"encryption fixture failed: {enc.stderr[-120:]!r}")

            # Real CDNs hand the playlist out with an absolute key URL.
            text = playlist.read_text().replace('URI="key.key"', f'URI="{self.base}/aes2/key.key"')
            FixtureHandler.dynamic_routes = {
                "/aes2/stream.m3u8": {"body": text.encode(), "mime": "application/vnd.apple.mpegurl"},
                "/aes2/key.key": {"body": key},
                **{
                    f"/aes2/seg{index}.ts": {"body": (pathlib.Path(directory) / f"seg{index}.ts").read_bytes(), "mime": "video/mp2t"}
                    for index in range(8)
                    if (pathlib.Path(directory) / f"seg{index}.ts").exists()
                },
            }
            self.addCleanup(setattr, FixtureHandler, "dynamic_routes", {})

            with tempfile.TemporaryDirectory() as out_dir:
                target = pathlib.Path(out_dir) / "aes-out.mp4"
                progress = host.Progress(lambda _event: None, "aes", target.name)
                result = host.hls_fast_download(
                    f"{self.base}/aes2/stream.m3u8", target, {}, 2,
                    threading.Event(), progress, ffmpeg,
                )
                self.assertTrue(target.exists())
                self.assertGreater(target.stat().st_size, 10_000)
                probed = subprocess.run([
                    shutil.which("ffprobe") or ffmpeg,
                    "-v", "error", "-show_entries", "stream=codec_type",
                    "-of", "csv=p=0", str(result),
                ], capture_output=True, text=True)
                kinds = sorted(line for line in probed.stdout.splitlines() if line)
                self.assertEqual(kinds, ["audio", "video"], "the decrypted merge carries both tracks")

    def test_inspect_hls_returns_playlist_text_through_pinned_client(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}):
            native = host.Host()
            try:
                with mock.patch.object(native, "send") as send:
                    native.handle({
                        "type": "inspect_hls",
                        "requestId": "inspect-1",
                        "url": f"{self.base}/aes/index.m3u8",
                        "headers": {"Referer": f"{self.base}/watch"},
                    })
                message = send.call_args.args[0]
                self.assertEqual(message["type"], "inspect_hls_result")
                self.assertEqual(message["requestId"], "inspect-1")
                self.assertTrue(message["ok"])
                self.assertIn("#EXT-X-KEY:METHOD=AES-128", message["text"])
                self.assertIn("#EXTINF:4,", message["text"])
                self.assertIn("/aes/index.m3u8", message["finalUrl"])

                with mock.patch.object(native, "send") as failing_send:
                    native.handle({
                        "type": "inspect_hls",
                        "requestId": "inspect-2",
                        "url": f"{self.base}/missing-playlist.m3u8",
                        "headers": {},
                    })
                failure = failing_send.call_args.args[0]
                self.assertEqual(failure["type"], "inspect_hls_result")
                self.assertFalse(failure["ok"])
                self.assertTrue(failure["error"])
            finally:
                native.close()

    def test_system_proxy_discovery_follows_runtime_changes_without_restart(self):
        # Turning a system proxy off (or on) must never require restarting
        # Chrome: discovery is re-read with a short cache instead of being
        # captured once at startup.
        with mock.patch.object(host, "_system_proxies", return_value={"https": "http://127.0.0.1:7890"}):
            host.reset_system_proxy_cache()
            proxied = host._system_proxy_opener()
            self.assertIsNotNone(proxied)
            self.assertIsNot(proxied, host.HTTP_OPENER)
            # Inside the refresh window the cached opener is reused as-is.
            with mock.patch.object(host, "_system_proxies", return_value={}):
                self.assertIs(host._system_proxy_opener(), proxied)
        host.reset_system_proxy_cache()
        with mock.patch.object(host, "_system_proxies", return_value={}):
            self.assertIsNone(host._system_proxy_opener(), "proxy off means direct connections with no restart")
            with mock.patch.object(host, "_system_proxies", return_value={"https": "http://127.0.0.1:7890"}):
                self.assertIsNone(host._system_proxy_opener(), "the cache holds until it expires")
        host.reset_system_proxy_cache()
        with mock.patch.object(host, "_system_proxies", return_value={"https": "http://127.0.0.1:7890"}):
            self.assertIsNotNone(host._system_proxy_opener(), "proxy back on is picked up after expiry")
        host.reset_system_proxy_cache()

    def test_ping_reports_precise_ffmpeg_capabilities(self):
        capability = host.FfmpegCapabilities(
            path="/fixture/ffmpeg",
            version="8.1",
            hls_demuxer=True,
            dash_demuxer=False,
            libmp3lame=True,
        )
        ytdlp = host.YtDlpCapabilities(path="/fixture/yt-dlp", version="2026.08.22")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}), mock.patch.object(host, "probe_ffmpeg", return_value=capability), mock.patch.object(host, "probe_ytdlp", return_value=ytdlp):
            native = host.Host()
            try:
                with mock.patch.object(native, "send") as send:
                    native.handle({"type": "ping", "requestId": "probe"})
                message = send.call_args.args[0]
                self.assertEqual(message["requestId"], "probe")
                self.assertEqual(message["capabilities"]["ffmpeg"], capability.as_dict())
                self.assertTrue(message["capabilities"]["ffmpeg"]["localProcessing"])
                self.assertFalse(message["capabilities"]["ffmpeg"]["networkInput"])
                self.assertTrue(message["capabilities"]["ffmpeg"]["networkDisabled"])
                self.assertTrue(message["capabilities"]["ytdlp"]["available"])
                self.assertTrue(message["capabilities"]["ytdlp"]["installed"])
                self.assertFalse(message["capabilities"]["ytdlp"]["networkDisabled"])
                self.assertEqual(message["capabilities"]["ytdlp"]["broker"], host.EXTERNAL_TOOL_BROKER_CAPABILITY)
                self.assertEqual(native.ytdlp, "/fixture/yt-dlp")
                self.assertEqual(message["capabilities"]["dashPlanner"], "static-v1")
                self.assertEqual(message["capabilities"]["dashPair"], "direct-v1")
                self.assertEqual(message["capabilities"]["externalNetworkProcesses"], host.EXTERNAL_TOOL_BROKER_CAPABILITY)
                # A probe that found no usable yt-dlp keeps the adapter closed.
                missing = host.YtDlpCapabilities(probe_error="yt-dlp was not found")
                self.assertFalse(missing.available)
                self.assertTrue(missing.as_dict()["networkDisabled"])
                broken = host.YtDlpCapabilities(path="/fixture/yt-dlp", probe_error="version probe exited 1")
                self.assertFalse(broken.available)
                self.assertEqual(message["protocolVersion"], host.NATIVE_PROTOCOL_VERSION)
                self.assertEqual(message["capabilityProfileVersion"], host.CAPABILITY_PROFILE_VERSION)
            finally:
                native.close()

    def test_native_admission_queue_is_bounded(self):
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(
            os.environ,
            {"FLUXCATCH_DOWNLOAD_DIR": directory},
        ), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            try:
                native.jobs = {
                    f"active-{index}": threading.Event()
                    for index in range(host.MAX_NATIVE_ADMITTED_JOBS)
                }
                with mock.patch.object(native, "send") as send, mock.patch.object(native.executor, "submit") as submit:
                    native.handle({
                        "type": "download",
                        "jobId": "overflow",
                        "url": "https://media.example/file.mp4",
                    })
                submit.assert_not_called()
                message = send.call_args.args[0]
                self.assertEqual(message["type"], "failed")
                self.assertEqual(message["status"], "failed")
                self.assertEqual(message["code"], "host_busy")
                self.assertNotIn("overflow", native.jobs)
            finally:
                native.close()

    def test_host_dash_pair_message_uses_selected_urls_scoped_headers_and_output_extension(self):
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg", libmp3lame=True)
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            events = []

            def fake_audio_download(audio_url, target, audio_headers, workers, _cancel, _progress, ffmpeg, **kwargs):
                self.assertEqual(audio_url, "https://audio.example/selected.m4s")
                self.assertEqual(target.suffix, ".mp3")
                self.assertEqual(audio_headers["authorization"], "Bearer AUDIO_SECRET")
                self.assertNotIn("cookie", audio_headers)
                self.assertEqual(workers, 6)
                self.assertEqual(ffmpeg, "/fixture/ffmpeg")
                self.assertEqual(kwargs["expected_duration"], 12.5)
                target.write_bytes(b"mp3")
                return target

            try:
                with mock.patch.object(native, "send", side_effect=events.append), mock.patch.object(host, "dash_pair_audio_download", side_effect=fake_audio_download) as download:
                    native.run_job("pair-message", {
                        "type": "download",
                        "mediaKind": "dash_pair",
                        "url": "https://video.example/selected.m4s",
                        "filename": "Selected lesson.mp4",
                        "headers": {"Authorization": "Bearer VIDEO_SECRET", "Cookie": "video=1"},
                        "options": {
                            "audioUrl": "https://audio.example/selected.m4s",
                            "audioHeaders": {"Authorization": "Bearer AUDIO_SECRET", "Cookie": "audio=1"},
                            "concurrentRanges": 6,
                            "expectedDuration": 12.5,
                            "extractAudio": True,
                            "outputContainer": "mp3",
                        },
                    }, threading.Event())
                self.assertEqual(download.call_count, 1)
                completed = next(event for event in events if event.get("type") == "complete")
                self.assertEqual(completed["filename"], "Selected lesson.mp3")
                self.assertEqual(pathlib.Path(completed["path"]).read_bytes(), b"mp3")
                self.assertEqual(native.reserved_targets, set())
            finally:
                native.close()

    def test_host_private_network_scope_requires_exact_opt_in_option(self):
        capability = host.FfmpegCapabilities()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(
            os.environ,
            {"FLUXCATCH_DOWNLOAD_DIR": directory},
        ), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            observed = []

            def fake_download(_url, target, _headers, _workers, _cancel, _progress):
                observed.append(host.current_network_policy().allow_private_network_media)
                target.write_bytes(b"fixture")
                return target

            try:
                with mock.patch.object(native, "send"), mock.patch.object(host, "multipart_download", side_effect=fake_download):
                    native.run_job("private-enabled", {
                        "type": "download",
                        "mediaKind": "video",
                        "url": "http://127.0.0.1/video.mp4",
                        "filename": "enabled.mp4",
                        "options": {"allowPrivateNetworkMedia": True},
                    }, threading.Event())
                    native.run_job("private-string", {
                        "type": "download",
                        "mediaKind": "video",
                        "url": "http://127.0.0.1/video.mp4",
                        "filename": "string.mp4",
                        "options": {"allowPrivateNetworkMedia": "true"},
                    }, threading.Event())
                self.assertEqual(observed, [True, False])
            finally:
                native.close()

    def test_fluxcatch_environment_names_and_defaults(self):
        self.assertEqual(host.USER_AGENT, f"Mozilla/5.0 FluxCatch/{host.VERSION}")
        capability = host.FfmpegCapabilities(path="/fixture/new-ffmpeg")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            with mock.patch.dict(os.environ, {
                "FLUXCATCH_FFMPEG": "/fixture/new-ffmpeg",
                "FLUXCATCH_DOWNLOAD_DIR": str(root / "new"),
            }, clear=True), mock.patch.object(host, "probe_ffmpeg", return_value=capability) as probe:
                native = host.Host()
                try:
                    probe.assert_called_once_with("/fixture/new-ffmpeg")
                    self.assertEqual(native.download_dir, root / "new")
                finally:
                    native.close()

            with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
                host.Path, "home", return_value=root
            ), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
                native = host.Host()
                try:
                    self.assertEqual(native.download_dir, root / "Downloads" / "FluxCatch")
                finally:
                    native.close()

    def test_static_dash_planner_expands_timeline_and_formatted_number(self):
        tracks = host.plan_static_dash(DASH_MPD.decode(), f"{self.base}/dash/out.mpd")
        video = next(track for track in tracks if track.kind == "video")
        audio = next(track for track in tracks if track.kind == "audio")
        self.assertEqual(
            [resource.url for resource in video.resources],
            [f"{self.base}/dash/init-stream0.m4s", f"{self.base}/dash/chunk-stream0-00001.m4s"],
        )
        self.assertEqual(
            [resource.url for resource in audio.resources],
            [
                f"{self.base}/dash/init-stream1.m4s",
                f"{self.base}/dash/chunk-stream1-00001.m4s",
                f"{self.base}/dash/chunk-stream1-00002.m4s",
                f"{self.base}/dash/chunk-stream1-00003.m4s",
            ],
        )

        repeated = DASH_MPD.decode().replace(
            '<S t="0" d="36864"/>',
            '<S t="0" d="12288" r="-1"/>',
        )
        repeated_video = next(track for track in host.plan_static_dash(repeated, f"{self.base}/dash/out.mpd") if track.kind == "video")
        self.assertEqual(len(repeated_video.resources), 4)  # init plus three seconds.

    def test_static_dash_planner_honors_selected_video_representation(self):
        selected_mpd = DASH_MPD.decode().replace(
            '    </AdaptationSet>\n    <AdaptationSet contentType="audio">',
            '''      <Representation id="2" bandwidth="120000" width="1280" height="720">
        <SegmentTemplate timescale="12288" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1">
          <SegmentTimeline><S t="0" d="36864"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">''',
        )
        video = next(
            track for track in host.plan_static_dash(
                selected_mpd,
                f"{self.base}/dash/out.mpd",
                selected_representation_index=1,
            ) if track.kind == "video"
        )
        self.assertTrue(all("stream2" in resource.url for resource in video.resources))
        self.assertEqual(video.height, 720)

    def test_static_dash_segment_list_and_drm_fail_closed(self):
        segment_list = '''<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S"><Period><AdaptationSet contentType="video"><SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="one.m4s"/><SegmentURL media="two.m4s" mediaRange="10-19"/></SegmentList><Representation id="v" bandwidth="100"/></AdaptationSet></Period></MPD>'''
        track = host.plan_static_dash(segment_list, f"{self.base}/dash/list.mpd")[0]
        self.assertEqual([item.url for item in track.resources], [f"{self.base}/dash/init.mp4", f"{self.base}/dash/one.m4s", f"{self.base}/dash/two.m4s"])
        self.assertEqual(track.resources[-1].byte_range, "10-19")

        protected = segment_list.replace(
            '<AdaptationSet contentType="video">',
            '<AdaptationSet contentType="video"><ContentProtection schemeIdUri="urn:uuid:fixture"/>',
        )
        with self.assertRaisesRegex(host.DownloadError, "Protected DASH"):
            host.plan_static_dash(protected, f"{self.base}/dash/list.mpd")

    def test_static_dash_planner_honors_preferred_representation(self):
        whole_object = '''<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="hi" bandwidth="5000000" width="1920" height="1080"><BaseURL>video-1080.m4s</BaseURL></Representation><Representation id="lo" bandwidth="2500000" width="1280" height="720"><BaseURL>video-720.m4s</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="aud" bandwidth="128000"><BaseURL>audio.m4s</BaseURL></Representation></AdaptationSet></Period></MPD>'''
        # Without a preference the planner keeps its best-first ladder.
        default_video = next(track for track in host.plan_static_dash(whole_object, f"{self.base}/dash/out.mpd") if track.kind == "video")
        self.assertEqual(default_video.representation_id, "hi")
        # The user's dialog choice selects that exact Representation (by its
        # document index, resolved from the opaque selector), never a substitute.
        chosen_video = next(
            track for track in host.plan_static_dash(whole_object, f"{self.base}/dash/out.mpd", selected_representation_index=1) if track.kind == "video"
        )
        self.assertEqual(chosen_video.representation_id, "lo")
        self.assertEqual([item.url for item in chosen_video.resources], [f"{self.base}/dash/video-720.m4s"])
        # A stale or forged preference fails loudly instead of falling back.
        with self.assertRaisesRegex(host.UnsupportedDashError, "no longer present"):
            host.plan_static_dash(whole_object, f"{self.base}/dash/out.mpd", selected_representation_index=7)

    def test_static_dash_download_fetches_tracks_then_merges_locally(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "fixture.mp4"
            progress = host.Progress(lambda _event: None, "dash", target.name)

            def fake_ffmpeg(args, output, _cancel, _progress):
                inputs = [pathlib.Path(args[index + 1]) for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(inputs[0].read_bytes(), DASH_FILES["/dash/init-stream0.m4s"] + DASH_FILES["/dash/chunk-stream0-00001.m4s"])
                self.assertEqual(
                    inputs[1].read_bytes(),
                    DASH_FILES["/dash/init-stream1.m4s"]
                    + DASH_FILES["/dash/chunk-stream1-00001.m4s"]
                    + DASH_FILES["/dash/chunk-stream1-00002.m4s"]
                    + DASH_FILES["/dash/chunk-stream1-00003.m4s"],
                )
                output.write_bytes(b"merged")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_ffmpeg):
                result = host.dash_static_download(
                    f"{self.base}/dash/out.mpd",
                    DASH_MPD.decode(),
                    target,
                    {},
                    4,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )
            self.assertEqual(result.read_bytes(), b"merged")
            requested = [path for path, _range in FixtureHandler.request_log]
            self.assertIn("/dash/chunk-stream0-00001.m4s", requested)
            self.assertIn("/dash/chunk-stream1-00003.m4s", requested)

    def test_dash_redirect_final_url_and_headers_reach_static_children(self):
        server_a, base_a = self.start_lineage_server()
        server_b, base_b = self.start_lineage_server()
        server_c, base_c = self.start_lineage_server()
        server_a.routes["/dash/entry/out.mpd"] = {"redirect": f"{base_b}/dash/hop/out.mpd"}
        server_b.routes["/dash/hop/out.mpd"] = {"redirect": f"{base_c}/dash/final/out.mpd"}
        dash_manifest = b'''<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1S">
  <Period><AdaptationSet contentType="video">
    <SegmentList><Initialization sourceURL="parts/init.mp4"/><SegmentURL media="parts/one.m4s"/></SegmentList>
    <Representation id="v" bandwidth="1000"/>
  </AdaptationSet></Period>
</MPD>'''
        server_c.routes.update({
            "/dash/final/out.mpd": {"body": dash_manifest, "mime": "application/dash+xml"},
            "/dash/final/parts/init.mp4": {"body": b"dash-init|", "mime": "video/mp4"},
            "/dash/final/parts/one.m4s": {"body": b"dash-one", "mime": "video/iso.segment"},
        })
        request_headers = {
            "Authorization": "Bearer DASH_SECRET",
            "Cookie": "session=DASH_SECRET",
            "Origin": "https://page.example",
            "Referer": "https://page.example/watch",
            "Accept": "application/dash+xml",
        }
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg", libmp3lame=True)
        events = []

        def fake_ffmpeg(args, output, _cancel, _progress, **_kwargs):
            inputs = [pathlib.Path(args[index + 1]) for index, value in enumerate(args[:-1]) if value == "-i"]
            self.assertEqual(len(inputs), 1)
            self.assertEqual(inputs[0].read_bytes(), b"dash-init|dash-one")
            output.write_bytes(b"dash-lineage-output")
            return output

        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(
            os.environ,
            {"FLUXCATCH_DOWNLOAD_DIR": directory},
        ), mock.patch.object(host, "probe_ffmpeg", return_value=capability), mock.patch.object(
            host,
            "run_ffmpeg",
            side_effect=fake_ffmpeg,
        ):
            native = host.Host()
            try:
                with mock.patch.object(native, "send", side_effect=events.append):
                    native.run_job("dash-lineage", {
                        "type": "download",
                        "mediaKind": "dash",
                        "url": f"{base_a}/dash/entry/out.mpd",
                        "filename": "lineage.mp4",
                        "headers": request_headers,
                        "options": {
                            "outputContainer": "mp4",
                            "concurrentFragments": 2,
                            "allowPrivateNetworkMedia": True,
                        },
                    }, threading.Event())
                completed = next(event for event in events if event.get("type") == "complete")
                self.assertEqual(pathlib.Path(completed["path"]).read_bytes(), b"dash-lineage-output")
            finally:
                native.close()

        def observed_headers(server, path):
            return [headers for observed_path, headers in server.request_log if observed_path == path]

        initial = observed_headers(server_a, "/dash/entry/out.mpd")[0]
        for key in host.SENSITIVE_REDIRECT_HEADERS:
            self.assertIn(key, initial)
        for server, path in (
            (server_b, "/dash/hop/out.mpd"),
            (server_c, "/dash/final/out.mpd"),
            (server_c, "/dash/final/parts/init.mp4"),
            (server_c, "/dash/final/parts/one.m4s"),
        ):
            headers = observed_headers(server, path)[0]
            for key in host.SENSITIVE_REDIRECT_HEADERS:
                self.assertNotIn(key, headers)
            self.assertEqual(headers["accept"], "application/dash+xml")
        self.assertFalse(any(path.startswith("/dash/entry/parts/") for path, _headers in server_a.request_log))

    def test_host_dash_always_uses_pinned_static_planner_even_with_dash_demuxer(self):
        capability = host.FfmpegCapabilities(
            path="/fixture/ffmpeg",
            dash_demuxer=True,
            libmp3lame=True,
        )
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(
            os.environ,
            {"FLUXCATCH_DOWNLOAD_DIR": directory},
        ), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            events = []

            def fake_static(manifest_url, manifest, target, request_headers, _workers, _cancel, _progress, ffmpeg, **_kwargs):
                self.assertEqual(manifest_url, "https://media.example/final/out.mpd")
                self.assertEqual(manifest, DASH_MPD.decode())
                self.assertEqual(request_headers, {"user-agent": "fixture"})
                self.assertEqual(ffmpeg, "/fixture/ffmpeg")
                target.write_bytes(b"pinned-static-dash")
                return target

            try:
                with mock.patch.object(native, "send", side_effect=events.append), mock.patch.object(
                    host,
                    "fetch_manifest",
                    return_value=host.ManifestFetchResult(
                        DASH_MPD.decode(),
                        "https://media.example/final/out.mpd",
                        {"user-agent": "fixture"},
                    ),
                ), mock.patch.object(host, "dash_static_download", side_effect=fake_static) as static, mock.patch.object(
                    host,
                    "ffmpeg_download",
                ) as external:
                    native.run_job("dash-static", {
                        "type": "download",
                        "mediaKind": "dash",
                        "url": "https://media.example/out.mpd",
                        "filename": "lesson.mp4",
                        "options": {"outputContainer": "mp4"},
                    }, threading.Event())
                static.assert_called_once()
                external.assert_not_called()
                completed = next(event for event in events if event.get("type") == "complete")
                self.assertEqual(pathlib.Path(completed["path"]).read_bytes(), b"pinned-static-dash")
            finally:
                native.close()

    def test_dash_pair_download_fetches_full_tracks_and_copy_muxes_locally(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "lesson.mp4"
            progress = host.Progress(events.append, "pair", target.name)

            def fake_ffmpeg(args, output, _cancel, ffmpeg_progress, **kwargs):
                inputs = [pathlib.Path(args[index + 1]) for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(inputs[0].read_bytes(), DASH_PAIR_VIDEO)
                self.assertEqual(inputs[1].read_bytes(), DASH_PAIR_AUDIO)
                self.assertEqual(args[args.index("-c") + 1], "copy")
                self.assertNotIn(f"{self.base}/dash-pair/video.m4s", args)
                self.assertNotIn(f"{self.base}/dash-pair/audio.m4s", args)
                self.assertEqual(kwargs["activity"], "正在无损合并 DASH 音视频")
                ffmpeg_progress.emit({"type": "progress", "progress": 1, "status": "downloading"})
                output.write_bytes(b"locally-muxed-mp4")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_ffmpeg):
                result = host.dash_pair_download(
                    f"{self.base}/dash-pair/video.m4s",
                    f"{self.base}/dash-pair/audio.m4s",
                    target,
                    {"user-agent": "video-fixture"},
                    {"user-agent": "audio-fixture"},
                    2,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                    expected_duration=42,
                )

            self.assertEqual(result.read_bytes(), b"locally-muxed-mp4")
            self.assertTrue(any(event.get("progress") == 0.9 and event.get("status") == "remuxing" for event in events))
            self.assertTrue(any(0.989 <= event.get("progress", 0) <= 0.991 for event in events))
            self.assertEqual(list(root.glob(".fluxcatch-dash-pair-*")), [])

    def test_dash_pair_mp3_downloads_only_audio_then_encodes_locally(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "lesson.mp3"
            fetched = []

            def fake_download(url, local, headers, _workers, _cancel, progress, *, allow_resume=True):
                self.assertFalse(allow_resume)
                fetched.append((url, headers))
                local.write_bytes(DASH_PAIR_AUDIO)
                progress.total = len(DASH_PAIR_AUDIO)
                progress.done = len(DASH_PAIR_AUDIO)
                progress.add(0, force=True)
                return local

            def fake_ffmpeg(args, output, _cancel, ffmpeg_progress, **kwargs):
                source = pathlib.Path(args[args.index("-i") + 1])
                self.assertEqual(source.read_bytes(), DASH_PAIR_AUDIO)
                self.assertIn("libmp3lame", args)
                self.assertNotIn("-c", args)
                self.assertFalse(kwargs["report_output_speed"])
                ffmpeg_progress.emit({"type": "progress", "progress": 1, "status": "downloading"})
                output.write_bytes(b"encoded-mp3")
                return output

            with mock.patch.object(host, "multipart_download", side_effect=fake_download), mock.patch.object(host, "run_ffmpeg", side_effect=fake_ffmpeg):
                result = host.dash_pair_audio_download(
                    "https://audio.example/track.m4s",
                    target,
                    {"authorization": "Bearer AUDIO"},
                    4,
                    threading.Event(),
                    host.Progress(events.append, "pair-mp3", target.name),
                    "/fixture/ffmpeg",
                    expected_duration=42,
                )

            self.assertEqual(fetched, [("https://audio.example/track.m4s", {"authorization": "Bearer AUDIO"})])
            self.assertEqual(result.read_bytes(), b"encoded-mp3")
            self.assertTrue(any(event.get("progress") == 0.9 for event in events))
            self.assertEqual(list(root.glob(".fluxcatch-dash-pair-*")), [])

    def test_dash_pair_failure_and_cancellation_remove_all_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "failed.mp4"
            def fail_audio(url, local, _headers, _workers, _cancel, _progress, *, allow_resume=True):
                self.assertFalse(allow_resume)
                if "video.example" in url:
                    local.write_bytes(DASH_PAIR_VIDEO)
                    return local
                raise host.DownloadError("audio fixture unavailable")

            with mock.patch.object(host, "multipart_download", side_effect=fail_audio):
                with self.assertRaisesRegex(host.DownloadError, "DASH audio track download failed.*audio fixture unavailable"):
                    host.dash_pair_download(
                        "https://video.example/track.m4s",
                        "https://audio.example/track.m4s",
                        target,
                        {},
                        {},
                        2,
                        threading.Event(),
                        host.Progress(lambda _event: None, "failed", target.name),
                        "/fixture/ffmpeg",
                    )
            self.assertFalse(target.exists())
            self.assertEqual(list(root.iterdir()), [])

            cancelled_target = root / "cancelled.mp4"
            cancel = threading.Event()

            def cancel_after_video(_url, local, _headers, _workers, _cancel, _progress, *, allow_resume=True):
                self.assertFalse(allow_resume)
                local.write_bytes(DASH_PAIR_VIDEO)
                cancel.set()
                return local

            with mock.patch.object(host, "multipart_download", side_effect=cancel_after_video):
                with self.assertRaises(host.Cancelled):
                    host.dash_pair_download(
                        "https://video.example/track.m4s",
                        "https://audio.example/track.m4s",
                        cancelled_target,
                        {},
                        {},
                        2,
                        cancel,
                        host.Progress(lambda _event: None, "cancelled", cancelled_target.name),
                        "/fixture/ffmpeg",
                    )
            self.assertFalse(cancelled_target.exists())
            self.assertEqual(list(root.iterdir()), [])

    def test_dash_pair_headers_are_isolated_per_track_and_drop_cookies(self):
        video, audio = host.dash_pair_headers(
            "https://video.example/track.m4s",
            "https://audio.example/track.m4s",
            {
                "Accept": "*/*",
                "Authorization": "Bearer VIDEO_SECRET",
                "Cookie": "session=VIDEO_COOKIE",
                "Origin": "https://page.example",
                "Referer": "https://page.example/watch",
                "User-Agent": "fixture",
            },
        )
        self.assertEqual(video["authorization"], "Bearer VIDEO_SECRET")
        self.assertNotIn("cookie", video)
        self.assertEqual(audio["accept"], "*/*")
        self.assertEqual(audio["user-agent"], "fixture")
        for key in ("authorization", "cookie", "origin", "referer"):
            self.assertNotIn(key, audio)

        explicit_video, explicit_audio = host.dash_pair_headers(
            "https://video.example/track.m4s",
            "https://audio.example/track.m4s",
            {},
            {"Authorization": "Bearer VIDEO_SECRET", "Cookie": "video=1"},
            {"Authorization": "Bearer AUDIO_SECRET", "Cookie": "audio=1", "Referer": "https://page.example/watch"},
        )
        self.assertEqual(explicit_video["authorization"], "Bearer VIDEO_SECRET")
        self.assertEqual(explicit_audio["authorization"], "Bearer AUDIO_SECRET")
        self.assertNotIn("VIDEO_SECRET", json.dumps(explicit_audio))
        self.assertNotIn("cookie", explicit_video)
        self.assertNotIn("cookie", explicit_audio)

    def test_dash_pair_disables_signed_url_checkpoints_and_startup_removes_crash_artifacts(self):
        secret_url = f"{self.base}/file.bin?upsig=TOP_SECRET&deadline=1999999999&token=PRIVATE"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "video.m4s"
            with mock.patch.object(host, "atomic_write_json") as checkpoint_write:
                result = host.multipart_download(
                    secret_url,
                    target,
                    {},
                    2,
                    threading.Event(),
                    host.Progress(lambda _event: None, "signed", target.name),
                    allow_resume=False,
                )
            self.assertEqual(result.read_bytes(), FILE_BYTES)
            checkpoint_write.assert_not_called()
            self.assertFalse(target.with_suffix(".m4s.part.json").exists())
            self.assertNotIn("TOP_SECRET", "\n".join(str(path) for path in root.rglob("*")))

    def test_dash_pair_disables_signed_url_checkpoints_and_startup_removes_crash_artifacts(self):
        secret_url = f"{self.base}/file.bin?upsig=TOP_SECRET&deadline=1999999999&token=PRIVATE"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "video.m4s"
            with mock.patch.object(host, "atomic_write_json") as checkpoint_write:
                result = host.multipart_download(
                    secret_url,
                    target,
                    {},
                    2,
                    threading.Event(),
                    host.Progress(lambda _event: None, "signed", target.name),
                    allow_resume=False,
                )
            self.assertEqual(result.read_bytes(), FILE_BYTES)
            checkpoint_write.assert_not_called()
            self.assertFalse(target.with_suffix(".m4s.part.json").exists())
            self.assertNotIn("TOP_SECRET", "\n".join(str(path) for path in root.rglob("*")))

            crash_dir = root / ".fluxcatch-dash-pair-crashed"
            crash_dir.mkdir()
            (crash_dir / "video.m4s.part").write_bytes(b"partial")
            (crash_dir / "video.m4s.part.json").write_text(json.dumps({"url": secret_url}), "utf-8")
            crash_dirs = [crash_dir]
            for name in ("fluxcatch-hls-crashed", "fluxcatch-dash-crashed", ".fluxcatch-convert-crashed"):
                work = root / name
                work.mkdir()
                (work / "partial.bin").write_bytes(b"partial")
                crash_dirs.append(work)
            unrelated = root / "keep-this-directory"
            unrelated.mkdir()
            capability = host.FfmpegCapabilities(path="/fixture/ffmpeg")
            with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": str(root)}), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
                native = host.Host()
                try:
                    self.assertTrue(all(not path.exists() for path in crash_dirs), "startup removes every native temporary-work class")
                    self.assertTrue(unrelated.exists())
                finally:
                    native.close()

    def test_media_transfers_refuse_html_pages_instead_of_saving_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            # Typed page: the probe's Content-Type gate rejects it before any
            # byte is written, ranged or not.
            typed_target = root / "typed.mp4"
            with self.assertRaisesRegex(host.HtmlMediaResponseError, "网页"):
                host.multipart_download(
                    f"{self.base}/hotlink-page.mp4",
                    typed_target,
                    {},
                    2,
                    threading.Event(),
                    host.Progress(lambda _event: None, "typed", typed_target.name),
                )
            self.assertFalse(typed_target.exists())
            self.assertFalse(typed_target.with_suffix(".mp4.part").exists())
            # Untyped page: the first streamed block is sniffed and the
            # transfer aborts without leaving a partial file behind.
            untyped_target = root / "untyped.mp4"
            with self.assertRaisesRegex(host.HtmlMediaResponseError, "网页"):
                host.single_download(
                    f"{self.base}/hotlink-page-untyped.mp4",
                    untyped_target,
                    {},
                    threading.Event(),
                    host.Progress(lambda _event: None, "untyped", untyped_target.name),
                )
            self.assertFalse(untyped_target.exists())
            self.assertFalse(untyped_target.with_suffix(".mp4.part").exists())

    def test_dash_pair_rejects_expired_queued_job_and_track_start_expiry(self):
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            events = []
            try:
                with mock.patch.object(native, "send", side_effect=events.append), mock.patch.object(host, "dash_pair_download") as download:
                    native.run_job("expired-pair", {
                        "type": "download",
                        "mediaKind": "dash_pair",
                        "url": "https://video.example/track.m4s?upsig=SECRET",
                        "filename": "expired.mp4",
                        "options": {
                            "audioUrl": "https://audio.example/track.m4s?upsig=SECRET",
                            "expiresAt": (host.time.time() - 1) * 1000,
                        },
                    }, threading.Event())
                download.assert_not_called()
                failed = next(event for event in events if event.get("type") == "failed")
                self.assertIn("任务开始前签名链接已过期", failed["error"])
                self.assertEqual(list(pathlib.Path(directory).iterdir()), [])
                self.assertEqual(native.reserved_targets, set())
            finally:
                native.close()

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "expires-between-tracks.mp4"
            with mock.patch.object(host.time, "time", side_effect=[100.0, 102.0]), mock.patch.object(host, "multipart_download") as download:
                with self.assertRaisesRegex(host.DownloadError, "音频轨启动前签名链接即将过期"):
                    host.dash_pair_download(
                        "https://video.example/track.m4s",
                        "https://audio.example/track.m4s",
                        target,
                        {},
                        {},
                        2,
                        threading.Event(),
                        host.Progress(lambda _event: None, "expiring", target.name),
                        "/fixture/ffmpeg",
                        expires_at=131.0,
                    )
            download.assert_not_called()
            self.assertFalse(target.exists())
            self.assertEqual(list(root.iterdir()), [])

    def test_missing_dash_demuxer_error_is_actionable(self):
        capability = host.FfmpegCapabilities(path="/opt/ffmpeg", version="8.1")
        error = host._dash_demuxer_error(capability, "dynamic MPD")
        self.assertIn("/opt/ffmpeg (version 8.1)", str(error))
        self.assertIn("pinned built-in static DASH planner", str(error))
        self.assertIn("Direct network access", str(error))

    def test_multipart_range_download(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "file.bin"
            progress = host.Progress(events.append, "job", "file.bin")
            result = host.multipart_download(f"{self.base}/file.bin", target, {}, 4, threading.Event(), progress)
            self.assertEqual(result.read_bytes(), FILE_BYTES)
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertFalse(target.with_suffix(".bin.part.json").exists())
            self.assertTrue(any(event.get("speed", 0) >= 0 for event in events))

    def test_multipart_user_cancellation_deletes_part_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "cancelled.bin"
            part = target.with_suffix(".bin.part")
            checkpoint = target.with_suffix(".bin.part.json")
            part.write_bytes(b"old partial")
            checkpoint.write_text(json.dumps({
                "schemaVersion": 2,
                "urlSha256": "0" * 64,
                "length": 11,
                "entity": {"etag": '"old"', "lastModified": ""},
                "completed": [],
            }), "utf-8")
            already_cancelled = threading.Event()
            already_cancelled.set()
            with self.assertRaises(host.Cancelled):
                host.multipart_download(
                    f"{self.base}/file.bin",
                    target,
                    {},
                    1,
                    already_cancelled,
                    host.Progress(lambda _event: None, "cancelled-before-start", target.name),
                )
            self.assertFalse(part.exists())
            self.assertFalse(checkpoint.exists())

            cancel = threading.Event()
            original_write = host._write_all

            def cancel_after_first_write(*args, **kwargs):
                result = original_write(*args, **kwargs)
                cancel.set()
                return result

            with mock.patch.object(host, "_write_all", side_effect=cancel_after_first_write):
                with self.assertRaises(host.Cancelled):
                    host.multipart_download(
                        f"{self.base}/file.bin",
                        target,
                        {},
                        1,
                        cancel,
                        host.Progress(lambda _event: None, "cancelled-in-flight", target.name),
                    )
            self.assertFalse(target.exists())
            self.assertFalse(part.exists())
            self.assertFalse(checkpoint.exists())

    def test_multipart_reuses_only_validated_checkpoint(self):
        chunks = host.range_chunks(len(FILE_BYTES), 4)
        start, end = chunks[0]
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "resume.bin"
            part = target.with_suffix(".bin.part")
            checkpoint = target.with_suffix(".bin.part.json")
            with part.open("wb") as output:
                output.truncate(len(FILE_BYTES))
            with part.open("r+b") as output:
                output.write(FILE_BYTES[start : end + 1])
            checkpoint.write_text(json.dumps({
                "schemaVersion": 2,
                "urlSha256": host.checkpoint_url_sha256(f"{self.base}/file.bin"),
                "length": len(FILE_BYTES),
                "entity": host.checkpoint_entity(host.Probe(length=len(FILE_BYTES), etag='"fixture-v1"')),
                "completed": [f"{start}-{end}"],
            }), "utf-8")
            progress = host.Progress(lambda _event: None, "job", target.name)
            host.multipart_download(f"{self.base}/file.bin", target, {}, 4, threading.Event(), progress)
            ranges = [value for path, value in FixtureHandler.request_log if path == "/file.bin"]
            self.assertNotIn(f"bytes={start}-{end}", ranges)
            self.assertEqual(target.read_bytes(), FILE_BYTES)

    def test_checkpoint_v2_never_persists_url_path_query_or_headers_and_discards_v1(self):
        secret_url = "https://media.example/private/account/video.bin?token=TOP_SECRET&sig=SIGNED"
        payload = host.checkpoint_payload(
            secret_url,
            host.Probe(length=123, etag='"entity-v1"', last_modified="Wed, 21 Oct 2015 07:28:00 GMT"),
            ["0-9"],
        )
        serialized = json.dumps(payload, sort_keys=True)
        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(len(payload["urlSha256"]), 64)
        self.assertRegex(payload["entity"]["etag"], r"^sha256:[0-9a-f]{64}$")
        self.assertRegex(payload["entity"]["lastModified"], r"^sha256:[0-9a-f]{64}$")
        for secret in (
            "media.example",
            "/private/account",
            "TOP_SECRET",
            "SIGNED",
            "entity-v1",
            "Wed, 21 Oct 2015",
            "authorization",
            "cookie",
        ):
            self.assertNotIn(secret.lower(), serialized.lower())

        chunks = host.range_chunks(len(FILE_BYTES), 4)
        start, end = chunks[0]
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "legacy.bin"
            part = target.with_suffix(".bin.part")
            checkpoint = target.with_suffix(".bin.part.json")
            with part.open("wb") as output:
                output.truncate(len(FILE_BYTES))
            checkpoint.write_text(json.dumps({
                "url": f"{self.base}/file.bin?token=LEGACY_SECRET",
                "length": len(FILE_BYTES),
                "identity": '"fixture-v1"',
                "completed": [f"{start}-{end}"],
            }), "utf-8")
            progress = host.Progress(lambda _event: None, "legacy", target.name)
            host.multipart_download(f"{self.base}/file.bin", target, {}, 4, threading.Event(), progress)
            ranges = [value for path, value in FixtureHandler.request_log if path == "/file.bin"]
            self.assertIn(f"bytes={start}-{end}", ranges)
            self.assertFalse(checkpoint.exists())

        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "probe-fails.bin"
            checkpoint = target.with_suffix(".bin.part.json")
            checkpoint.write_text(json.dumps({
                "url": "https://media.example/video?token=LEGACY_SECRET",
                "completed": [],
            }), "utf-8")
            with mock.patch.object(host, "probe_direct", side_effect=host.DownloadError("probe failed")):
                with self.assertRaisesRegex(host.DownloadError, "probe failed"):
                    host.multipart_download(
                        "https://media.example/video?token=NEW_SECRET",
                        target,
                        {},
                        2,
                        threading.Event(),
                        host.Progress(lambda _event: None, "probe-fails", target.name),
                    )
            self.assertFalse(checkpoint.exists())

    def test_multipart_rejects_mismatched_content_range(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(host, "_retry_wait", return_value=None):
            target = pathlib.Path(directory) / "bad.bin"
            progress = host.Progress(lambda _event: None, "job", target.name)
            with self.assertRaisesRegex(host.DownloadError, "mismatched byte range"):
                host.multipart_download(
                    f"{self.base}/bad-range.bin?token=TOP_SECRET&signature=SIGNED",
                    target,
                    {"Authorization": "Bearer HEADER_SECRET"},
                    2,
                    threading.Event(),
                    progress,
                )
            self.assertFalse(target.exists())
            checkpoint = target.with_suffix(".bin.part.json")
            saved = checkpoint.read_text("utf-8")
            self.assertEqual(json.loads(saved)["schemaVersion"], 2)
            for secret in ("TOP_SECRET", "SIGNED", "HEADER_SECRET", "bad-range.bin"):
                self.assertNotIn(secret, saved)

    def test_single_stream_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "file.bin"
            progress = host.Progress(lambda _event: None, "job", "file.bin")
            result = host.multipart_download(f"{self.base}/no-range.bin", target, {}, 8, threading.Event(), progress)
            self.assertEqual(result.read_bytes(), FILE_BYTES)

    def test_single_stream_retries_and_cleans_cancelled_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "small.bin"
            responses = [FakeResponse([b"ab"], 4), FakeResponse([b"abcd"], 4)]
            progress = host.Progress(lambda _event: None, "job", target.name)
            with mock.patch.object(host, "request", side_effect=responses), mock.patch.object(host, "_retry_wait", return_value=None):
                host.single_download("https://example.test/file", target, {}, threading.Event(), progress)
            self.assertEqual(target.read_bytes(), b"abcd")
            self.assertEqual(progress.done, 4)

            cancelled_target = pathlib.Path(directory) / "cancel.bin"
            cancel = threading.Event()
            progress = host.Progress(lambda _event: None, "job2", cancelled_target.name)
            with mock.patch.object(host, "request", return_value=FakeResponse([b"ab"], 4, cancel)):
                with self.assertRaises(host.Cancelled):
                    host.single_download("https://example.test/file", cancelled_target, {}, cancel, progress)
            self.assertFalse(cancelled_target.exists())
            self.assertFalse(cancelled_target.with_suffix(".bin.part").exists())

    def test_hls_fast_concat_without_ffmpeg(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "video.ts"
            progress = host.Progress(events.append, "job", "video.ts")
            result = host.hls_fast_download(f"{self.base}/master.m3u8", target, {}, 3, threading.Event(), progress, None)
            self.assertEqual(result.read_bytes(), b"".join(SEGMENTS[f"/seg{i}.ts"] for i in range(3)))
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertTrue(any(event.get("progress") == 1 for event in events))

    def test_separate_audio_hls_downloads_both_tracks_then_muxes_local_files(self):
        FixtureHandler.reset()
        events = []
        observed = {}
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "separate.mp4"
            progress = host.Progress(events.append, "hls-pair", target.name)

            def fake_run(args, output, _cancel, _progress, **kwargs):
                inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(len(inputs), 2)
                self.assertTrue(all(pathlib.Path(value).is_absolute() for value in inputs))
                self.assertTrue(all(pathlib.Path(value).is_file() for value in inputs))
                self.assertEqual(
                    pathlib.Path(inputs[0]).read_bytes(),
                    b"".join(HLS_VIDEO_SEGMENTS.values()),
                )
                self.assertEqual(
                    pathlib.Path(inputs[1]).read_bytes(),
                    b"".join(HLS_AUDIO_SEGMENTS.values()),
                )
                self.assertFalse(any("http://" in value or "https://" in value for value in args))
                maps = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-map"]
                self.assertEqual(maps, ["0:v:0", "1:a:0"])
                self.assertEqual(host.local_only_ffmpeg_args(args).count("-protocol_whitelist"), 2)
                observed.update(kwargs)
                output.write_bytes(b"locally-muxed-hls")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                result = host.hls_fast_download(
                    f"{self.base}/separate-clear-master.m3u8",
                    target,
                    {"Cookie": "session=fixture"},
                    3,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )

            self.assertEqual(result.read_bytes(), b"locally-muxed-hls")
            self.assertEqual(observed["expected_duration"], 8.0)
            self.assertEqual(observed["activity"], "正在无损合并 HLS 音视频")
            self.assertTrue(any(event.get("progress") == 1 for event in events))

        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/audio-default.m3u8", requested)
        self.assertNotIn("/audio-alternate.m3u8", requested)
        self.assertTrue(set(HLS_VIDEO_SEGMENTS).issubset(requested))
        self.assertTrue(set(HLS_AUDIO_SEGMENTS).issubset(requested))

    def test_separate_audio_hls_requires_ffmpeg_before_audio_fetch(self):
        FixtureHandler.reset()
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "separate.mp4"
            with self.assertRaisesRegex(host.DownloadError, "Separate-audio HLS requires FFmpeg"):
                host.hls_fast_download(
                    f"{self.base}/separate-clear-master.m3u8",
                    target,
                    {},
                    2,
                    threading.Event(),
                    host.Progress(lambda _event: None, "hls-no-ffmpeg", target.name),
                    None,
                )
        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertNotIn("/audio-default.m3u8", requested)
        self.assertFalse(set(HLS_VIDEO_SEGMENTS).intersection(requested))
        self.assertFalse(set(HLS_AUDIO_SEGMENTS).intersection(requested))

    def test_separate_audio_hls_extraction_downloads_only_audio_segments(self):
        FixtureHandler.reset()
        observed = {}
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "separate.mp3"
            progress = host.Progress(lambda _event: None, "hls-audio", target.name)

            def fake_run(args, output, _cancel, _progress, **kwargs):
                inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(len(inputs), 1)
                self.assertTrue(pathlib.Path(inputs[0]).is_absolute())
                self.assertEqual(
                    pathlib.Path(inputs[0]).read_bytes(),
                    b"".join(HLS_AUDIO_SEGMENTS.values()),
                )
                self.assertFalse(any("http://" in value or "https://" in value for value in args))
                self.assertIn("-vn", args)
                observed.update(kwargs)
                output.write_bytes(b"local-audio-only")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                result = host.hls_fast_download(
                    f"{self.base}/separate-clear-master.m3u8",
                    target,
                    {},
                    3,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                    extract_audio=True,
                )

            self.assertEqual(result.read_bytes(), b"local-audio-only")
            self.assertEqual(observed["expected_duration"], 8.0)
            self.assertFalse(observed["report_output_speed"])

        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/separate-video.m3u8", requested)
        self.assertIn("/audio-default.m3u8", requested)
        self.assertFalse(set(HLS_VIDEO_SEGMENTS).intersection(requested))
        self.assertTrue(set(HLS_AUDIO_SEGMENTS).issubset(requested))

    def test_dual_media_playlist_pair_downloads_and_merges_locally(self):
        """Rendition-style entries: the extension passes two media playlists."""
        events = []
        observed = {}
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "rendition-pair.mp4"
            progress = host.Progress(events.append, "hls-rendition", target.name)

            def fake_run(args, output, _cancel, _progress, **kwargs):
                inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(len(inputs), 2)
                self.assertTrue(all(pathlib.Path(value).is_file() for value in inputs))
                self.assertEqual(
                    pathlib.Path(inputs[0]).read_bytes(),
                    b"".join(HLS_VIDEO_SEGMENTS.values()),
                )
                self.assertEqual(
                    pathlib.Path(inputs[1]).read_bytes(),
                    b"".join(HLS_AUDIO_SEGMENTS.values()),
                )
                self.assertFalse(any("http://" in value or "https://" in value for value in args))
                maps = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-map"]
                self.assertEqual(maps, ["0:v:0", "1:a:0"])
                observed.update(kwargs)
                output.write_bytes(b"locally-muxed-renditions")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                result = host.hls_fast_download(
                    f"{self.base}/rendition/video-1080.m3u8",
                    target,
                    {"Cookie": "session=fixture"},
                    2,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                    audio_url=f"{self.base}/rendition/audio.m3u8",
                )

            self.assertEqual(result.read_bytes(), b"locally-muxed-renditions")
            self.assertEqual(observed["activity"], "正在无损合并 HLS 音视频")
            starting_messages = [
                str(event.get("message")) for event in events if event.get("status") == "starting"
            ]
            self.assertTrue(
                any("正在获取播放列表" in message for message in starting_messages),
                f"job start must announce playlist fetching, saw: {starting_messages}",
            )

        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/rendition/video-1080.m3u8", requested)
        self.assertIn("/rendition/audio.m3u8", requested)
        self.assertNotIn("/rendition/video-720.m3u8", requested)
        self.assertTrue(set(HLS_VIDEO_SEGMENTS).issubset(requested))
        self.assertTrue(set(HLS_AUDIO_SEGMENTS).issubset(requested))

    def test_download_message_routes_rendition_audio_url_into_dual_playlist_merge(self):
        """Regression: options.audioUrl from the extension must reach the merge, not the floor."""
        events = []
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(
            os.environ,
            {"FLUXCATCH_DOWNLOAD_DIR": directory},
        ), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            try:
                def fake_run(args, output, _cancel, _progress, **kwargs):
                    inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                    self.assertEqual(
                        len(inputs),
                        2,
                        "options.audioUrl must trigger the dual-playlist merge, not a silent video-only download",
                    )
                    maps = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-map"]
                    self.assertEqual(maps, ["0:v:0", "1:a:0"])
                    self.assertEqual(kwargs.get("activity"), "正在无损合并 HLS 音视频")
                    output.write_bytes(b"dispatched-dual-merge")
                    return output

                with mock.patch.object(native, "send", side_effect=events.append), mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                    native.run_job("rendition-dispatch", {
                        "type": "download",
                        "mediaKind": "hls",
                        "url": f"{self.base}/rendition/video-1080.m3u8",
                        "filename": "Rendition episode.mp4",
                        "headers": {"Cookie": "session=fixture"},
                        "options": {
                            "audioUrl": f"{self.base}/rendition/audio.m3u8",
                            "concurrentFragments": 2,
                            "allowPrivateNetworkMedia": True,
                        },
                    }, threading.Event())

                completed = next(event for event in events if event.get("type") == "complete")
                self.assertEqual(pathlib.Path(completed["path"]).read_bytes(), b"dispatched-dual-merge")
            finally:
                native.close()

        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/rendition/video-1080.m3u8", requested)
        self.assertIn("/rendition/audio.m3u8", requested)

    def test_legacy_single_playlist_entry_is_unchanged_without_audio_url(self):
        """Regression guard: the pre-dual-entry single-URL path keeps its shape."""
        observed = {}
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "legacy.mp4"
            progress = host.Progress(lambda _event: None, "hls-legacy", target.name)

            def fake_run(args, output, _cancel, _progress, **kwargs):
                inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(len(inputs), 1)
                self.assertEqual(pathlib.Path(inputs[0]).read_bytes(), b"".join(SEGMENTS.values()))
                observed.update(kwargs)
                output.write_bytes(b"legacy-remux")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                result = host.hls_fast_download(
                    f"{self.base}/master.m3u8",
                    target,
                    {},
                    2,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )

            self.assertEqual(result.read_bytes(), b"legacy-remux")

        requested = [path for path, _range in FixtureHandler.request_log]
        self.assertIn("/master.m3u8", requested)
        self.assertIn("/media.m3u8", requested)
        self.assertFalse(set(HLS_AUDIO_SEGMENTS).intersection(requested))
        self.assertNotIn("/rendition/audio.m3u8", requested)

    def test_manifest_fetch_fails_after_single_bounded_timeout_retry(self):
        attempts = []

        def fake_request(url, headers, **kwargs):  # noqa: ARG001 - fixture signature
            attempts.append(kwargs.get("timeout"))
            raise TimeoutError("the read operation timed out")

        with mock.patch.object(host, "request", side_effect=fake_request):
            with self.assertRaisesRegex(host.DownloadError, r"获取播放列表超时\(20s\): example\.test"):
                host.fetch_manifest("https://example.test/media/index.m3u8", {})

        self.assertEqual(attempts, [20, 20], "exactly one bounded retry after the first stall")

    def test_manifest_fetch_recovers_when_the_single_retry_succeeds(self):
        class StubResponse:
            status = 200

            def __init__(self, payload: bytes):
                self._payload = payload

            def read(self, _size=-1):
                chunk, self._payload = self._payload, b""
                return chunk

            def close(self):
                pass

            def geturl(self):
                return "https://example.test/media/index.m3u8"

        attempts = []

        def fake_request(url, headers, **kwargs):  # noqa: ARG001 - fixture signature
            attempts.append(kwargs.get("timeout"))
            if len(attempts) == 1:
                raise TimeoutError("timed out")
            response = StubResponse(b"#EXTM3U\n#EXT-X-ENDLIST\n")
            response._fluxcatch_request_headers = {"user-agent": "fixture"}  # noqa: SLF001
            return response

        with mock.patch.object(host, "request", side_effect=fake_request):
            fetched = host.fetch_manifest("https://example.test/media/index.m3u8", {})

        self.assertEqual(fetched.text, "#EXTM3U\n#EXT-X-ENDLIST\n")
        self.assertEqual(attempts, [20, 20])

    def test_manifest_fetch_non_timeout_failures_use_the_widened_retry_budget(self):
        attempts = []

        def failing_request(url, headers, **kwargs):  # noqa: ARG001 - fixture signature
            attempts.append(kwargs.get("timeout"))
            raise ConnectionError("connection refused")

        with mock.patch.object(host, "request", side_effect=failing_request):
            with self.assertRaisesRegex(host.DownloadError, "Manifest download failed after retries"):
                host.fetch_manifest("https://example.test/media/index.m3u8", {})

        # Connection-level bursts through local proxies (~4.5% TLS resets in
        # the field) need a wider window than 3 quick retries: six attempts
        # with 0.5→8s backoff ride out multi-second outages.
        self.assertEqual(len(attempts), 6)
        self.assertTrue(all(timeout == 20 for timeout in attempts))

    def test_hls_redirect_final_url_and_headers_follow_the_response_chain(self):
        server_a, base_a = self.start_lineage_server()
        server_b, base_b = self.start_lineage_server()
        server_c, base_c = self.start_lineage_server()
        server_a.routes.update({
            "/hls/entry/master.m3u8": {"redirect": f"{base_a}/hls/same/master.m3u8"},
            "/hls/same/master.m3u8": {"redirect": f"{base_b}/hls/hop/master.m3u8"},
            "/hls/final/master.m3u8": {
                "body": b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nchild/media.m3u8\n",
                "mime": "application/vnd.apple.mpegurl",
            },
            "/hls/final/child/media.m3u8": {"redirect": f"{base_c}/hls/final/media.m3u8"},
        })
        server_b.routes["/hls/hop/master.m3u8"] = {"redirect": f"{base_a}/hls/final/master.m3u8"}
        server_c.routes.update({
            "/hls/final/media.m3u8": {
                "body": b"#EXTM3U\n#EXTINF:4,\nsegments/seg0.ts\n#EXT-X-ENDLIST\n",
                "mime": "application/vnd.apple.mpegurl",
            },
            "/hls/final/segments/seg0.ts": {"body": b"lineage-segment", "mime": "video/mp2t"},
        })
        request_headers = {
            "Authorization": "Bearer HLS_SECRET",
            "Cookie": "session=HLS_SECRET",
            "Origin": "https://page.example",
            "Referer": "https://page.example/watch",
            "Accept": "application/vnd.apple.mpegurl",
        }

        playlist, text, master, selected = host.select_hls_media(
            f"{base_a}/hls/entry/master.m3u8",
            request_headers,
        )
        self.assertIsNotNone(master)
        self.assertIsNotNone(selected)
        self.assertEqual(master.url, f"{base_a}/hls/final/master.m3u8")
        self.assertEqual(selected["url"], f"{base_a}/hls/final/child/media.m3u8")
        self.assertEqual(playlist.url, f"{base_c}/hls/final/media.m3u8")
        self.assertEqual(playlist.segments[0].url, f"{base_c}/hls/final/segments/seg0.ts")
        self.assertIn("segments/seg0.ts", text)
        for key in host.SENSITIVE_REDIRECT_HEADERS:
            self.assertNotIn(key, master.request_headers)
            self.assertNotIn(key, playlist.request_headers)
        self.assertEqual(playlist.request_headers["accept"], "application/vnd.apple.mpegurl")

        def observed_headers(server, path):
            return [headers for observed_path, headers in server.request_log if observed_path == path]

        initial = observed_headers(server_a, "/hls/entry/master.m3u8")[0]
        same_origin = observed_headers(server_a, "/hls/same/master.m3u8")[0]
        for key in host.SENSITIVE_REDIRECT_HEADERS:
            self.assertIn(key, initial)
            self.assertIn(key, same_origin)
        for server, path in (
            (server_b, "/hls/hop/master.m3u8"),
            (server_a, "/hls/final/master.m3u8"),
            (server_a, "/hls/final/child/media.m3u8"),
            (server_c, "/hls/final/media.m3u8"),
        ):
            for headers in observed_headers(server, path):
                for key in host.SENSITIVE_REDIRECT_HEADERS:
                    self.assertNotIn(key, headers)

        for server in (server_a, server_b, server_c):
            with server.log_lock:
                server.request_log.clear()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            host,
            "select_hls_media",
            return_value=(playlist, text, master, selected),
        ):
            target = pathlib.Path(directory) / "lineage.ts"
            result = host.hls_fast_download(
                f"{base_a}/hls/entry/master.m3u8",
                target,
                request_headers,
                1,
                threading.Event(),
                host.Progress(lambda _event: None, "hls-lineage", target.name),
                None,
            )
            self.assertEqual(result.read_bytes(), b"lineage-segment")
        segment_headers = observed_headers(server_c, "/hls/final/segments/seg0.ts")[0]
        for key in host.SENSITIVE_REDIRECT_HEADERS:
            self.assertNotIn(key, segment_headers)

    def test_hls_byte_ranges_are_strict(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "ranges.ts"
            progress = host.Progress(lambda _event: None, "job", target.name)
            result = host.hls_fast_download(f"{self.base}/byterange.m3u8", target, {}, 3, threading.Event(), progress, None)
            self.assertEqual(result.read_bytes(), PACKED[:13])

            target = pathlib.Path(directory) / "ignored.ts"
            progress = host.Progress(lambda _event: None, "job2", target.name)
            with mock.patch.object(host, "_retry_wait", return_value=None):
                with self.assertRaisesRegex(host.DownloadError, "honoring range"):
                    host.hls_fast_download(f"{self.base}/bad-byterange.m3u8", target, {}, 1, threading.Event(), progress, None)
            self.assertFalse(target.exists())

    def test_complex_hls_external_network_processing_fails_closed(self):
        live = host.HlsPlaylist(url=f"{self.base}/live.m3u8", live=True, segments=[host.HlsSegment(f"{self.base}/seg0.ts")])
        target = pathlib.Path("capture.mp4")
        progress = host.Progress(lambda _event: None, "job", target.name)
        with mock.patch.object(host, "select_hls_media", return_value=(live, "", None, None)), mock.patch.object(host, "run_ffmpeg") as run:
            with self.assertRaisesRegex(host.DownloadError, "Live HLS recording.*0.2.5"):
                host.hls_fast_download(live.url, target, {}, 1, threading.Event(), progress, "/ffmpeg", live_duration=37)
        run.assert_not_called()

        master = host.HlsPlaylist(
            url=f"{self.base}/master.m3u8",
            audio_tracks=[{"GROUP-ID": "audio", "DEFAULT": "YES", "url": f"{self.base}/audio.m3u8"}],
        )
        selected = {"url": f"{self.base}/media.m3u8", "audio_group": "audio"}
        video = host.HlsPlaylist(
            url=f"{self.base}/media.m3u8",
            live=False,
            segments=[host.HlsSegment(f"{self.base}/seg0.ts")],
        )
        unsupported_audio = [
            (
                host.HlsPlaylist(
                    url=f"{self.base}/audio.m3u8",
                    live=True,
                    segments=[host.HlsSegment(f"{self.base}/seg0.ts")],
                ),
                "Live audio HLS",
            ),
            (
                host.HlsPlaylist(
                    url=f"{self.base}/audio.m3u8",
                    live=False,
                    discontinuity=True,
                    segments=[host.HlsSegment(f"{self.base}/seg0.ts")],
                ),
                "Discontinuous audio HLS",
            ),
        ]
        for audio, message in unsupported_audio:
            with self.subTest(message=message), mock.patch.object(
                host,
                "select_hls_media",
                side_effect=[(video, "", master, selected), (audio, "", None, None)],
            ), mock.patch.object(host, "run_ffmpeg") as run:
                with self.assertRaisesRegex(host.DownloadError, message):
                    host.hls_fast_download(
                        master.url,
                        target.with_suffix(".mp3"),
                        {},
                        1,
                        threading.Event(),
                        progress,
                        "/ffmpeg",
                        live_duration=22,
                        extract_audio=True,
                    )
            run.assert_not_called()

        unsupported = [
            (host.HlsPlaylist(url=f"{self.base}/discontinuous.m3u8", live=False, discontinuity=True, segments=[host.HlsSegment(f"{self.base}/seg0.ts")]), "Discontinuous HLS"),
        ]
        for playlist, message in unsupported:
            with self.subTest(message=message), mock.patch.object(host, "select_hls_media", return_value=(playlist, "", None, None)), mock.patch.object(host, "run_ffmpeg") as run:
                with self.assertRaisesRegex(host.DownloadError, f"{message}.*0.2.5"):
                    host.hls_fast_download(playlist.url, target, {}, 1, threading.Event(), progress, "/ffmpeg")
            run.assert_not_called()

    def test_aes128_hls_stages_local_playlist_and_decrypts_via_ffmpeg(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "aes.mp4"
            progress = host.Progress(lambda _event: None, "aes", target.name)
            captured: dict[str, Any] = {}

            def fake_ffmpeg(args, output, _cancel, _progress, **_kwargs):
                index_argument = args[args.index("-i") + 1]
                index_path = pathlib.Path(index_argument)
                # The work directory is wiped once this returns, so capture
                # every on-disk piece of evidence while it still exists.
                captured["index_text"] = index_path.read_text("utf-8")
                captured["staged_names"] = sorted(path.name for path in index_path.parent.iterdir())
                captured["key_bytes"] = (index_path.parent / "key0.bin").stat().st_size
                output.write_bytes(b"decrypted")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_ffmpeg):
                result = host.hls_fast_download(
                    f"{self.base}/aes/index.m3u8",
                    target,
                    {},
                    2,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )
            self.assertEqual(result.read_bytes(), b"decrypted")
            text = captured["index_text"]
            self.assertIn('#EXT-X-KEY:METHOD=AES-128,URI="key0.bin"', text, "the key URI points at the staged local key file")
            self.assertNotIn("seg0.ts", text, "remote segment names are rewritten to staged local files")
            self.assertIn("#EXT-X-MEDIA-SEQUENCE:7", text, "the sequence number survives the rewrite so IV derivation stays correct")
            # Staged segments keep their real extension: ffmpeg's hls demuxer
            # gates staged local playlists by segment file extension.
            self.assertIn("00000000.ts", text)
            self.assertIn("00000001.ts", text)
            self.assertEqual(captured["key_bytes"], 16)
            self.assertIn("00000000.ts", captured["staged_names"])
            self.assertIn("00000001.ts", captured["staged_names"])
            requested = [path for path, _range in FixtureHandler.request_log]
            self.assertIn("/aes/key.bin", requested, "the key is fetched through the pinned client")
            self.assertIn("/aes/seg0.ts", requested)
            self.assertIn("/aes/seg1.ts", requested)

        malformed_durations = host.HlsPlaylist(
            url=f"{self.base}/vod.m3u8",
            live=False,
            segments=[
                host.HlsSegment(f"{self.base}/seg0.ts", float("nan")),
                host.HlsSegment(f"{self.base}/seg1.ts", float("inf")),
                host.HlsSegment(f"{self.base}/seg2.ts", 4.0),
            ],
        )
        self.assertEqual(host.hls_media_duration(malformed_durations), 4.0)

    def test_static_hls_audio_extraction_downloads_pinned_then_uses_local_ffmpeg_input(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "capture.mp3"
            progress = host.Progress(lambda _event: None, "job", target.name)
            observed = {}

            def fake_run(args, output, _cancel, _progress, **kwargs):
                inputs = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"]
                self.assertEqual(len(inputs), 1)
                self.assertTrue(pathlib.Path(inputs[0]).is_file())
                self.assertEqual(
                    pathlib.Path(inputs[0]).read_bytes(),
                    b"".join(SEGMENTS[f"/seg{i}.ts"] for i in range(3)),
                )
                self.assertFalse(any("http://" in value or "https://" in value for value in args))
                self.assertIn("-vn", args)
                self.assertIn("libmp3lame", args)
                observed.update(kwargs)
                output.write_bytes(b"local-mp3")
                return output

            with mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
                result = host.hls_fast_download(
                    f"{self.base}/master.m3u8",
                    target,
                    {"Cookie": "session=fixture"},
                    3,
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                    extract_audio=True,
                )
            self.assertEqual(result.read_bytes(), b"local-mp3")
            self.assertEqual(observed["expected_duration"], 12.0)
            self.assertEqual(observed["activity"], "正在从本地媒体提取音频")
            self.assertFalse(observed["report_output_speed"])

    def test_external_network_processes_fail_closed_and_local_staging_is_atomic(self):
        target = pathlib.Path("capture.mp4")
        progress = host.Progress(lambda _event: None, "job", target.name)
        with mock.patch.object(host.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(host.DownloadError, "FFmpeg 直接联网.*pinned broker"):
                host.ffmpeg_download(
                    "https://media.example/vod.m3u8",
                    target,
                    {},
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )
            with self.assertRaisesRegex(host.DownloadError, "FFmpeg 直接联网.*pinned broker"):
                host.ffmpeg_download_pair(
                    "https://media.example/video.m4s",
                    "https://media.example/audio.m4s",
                    target,
                    {},
                    threading.Event(),
                    progress,
                    "/fixture/ffmpeg",
                )
            # yt-dlp is brokered rather than blocked, but without an installed
            # executable the job still fails before any process starts.
            with self.assertRaisesRegex(host.DownloadError, "yt-dlp is not installed"):
                host.youtube_download(
                    "https://video.example/watch?v=fixture",
                    target,
                    "mp4",
                    False,
                    threading.Event(),
                    progress,
                    None,
                )
        spawn.assert_not_called()

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "source.mp4"
            source.write_bytes(b"local fixture")
            local_args = host.local_only_ffmpeg_args([
                "/fixture/ffmpeg",
                "-i",
                str(source),
                "-progress",
                "pipe:1",
                str(root / "output.mp4"),
            ])
            self.assertEqual(local_args[local_args.index("-protocol_whitelist") + 1], "file")
            self.assertFalse(any(protocol in local_args for protocol in ("http", "https", "tcp", "tls")))
            with self.assertRaisesRegex(host.DownloadError, "existing local regular file"):
                host.local_only_ffmpeg_args([
                    "/fixture/ffmpeg",
                    "-i",
                    "https://media.example/playlist.m3u8",
                    str(root / "output.mp4"),
                ])

            script = root / "fake_ffmpeg.py"
            script.write_text(
                "import pathlib, sys\n"
                "pathlib.Path(sys.argv[-1]).write_bytes(b'finished')\n"
                "print('total_size=8', flush=True)\n"
                "print('progress=end', flush=True)\n",
                "utf-8",
            )
            target = root / "video.mp4"
            progress = host.Progress(lambda _event: None, "job", target.name)
            real_popen = host.subprocess.Popen
            observed_spawn = {}

            def spawn(*args, **kwargs):
                observed_spawn.update(kwargs)
                return real_popen(*args, **kwargs)

            with mock.patch.object(host.subprocess, "Popen", side_effect=spawn):
                result = host.run_ffmpeg([sys.executable, str(script), str(target)], target, threading.Event(), progress)
            self.assertEqual(result.read_bytes(), b"finished")
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob(".*.part.mp4")), [])
            self.assertIs(observed_spawn["stdin"], host.subprocess.DEVNULL)
            self.assertTrue(observed_spawn["start_new_session"])
            limited = host.resource_limited_ffmpeg_args(local_args)
            self.assertEqual(limited[limited.index("-threads") + 1], str(host.FFMPEG_MAX_THREADS))

    def test_ffmpeg_audio_progress_uses_media_time_not_encoded_bitrate(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script = root / "fake_ffmpeg_progress.py"
            script.write_text(
                "import pathlib, sys\n"
                "pathlib.Path(sys.argv[-1]).write_bytes(b'x' * 512)\n"
                "print('total_size=256')\n"
                "print('out_time_us=5000000')\n"
                "print('speed=2.50x')\n"
                "print('progress=continue')\n"
                "print('total_size=512')\n"
                "print('out_time_us=10000000')\n"
                "print('speed=3.00x')\n"
                "print('progress=end')\n",
                "utf-8",
            )
            target = root / "audio.mp3"
            result = host.run_ffmpeg(
                [sys.executable, str(script), str(target)],
                target,
                threading.Event(),
                host.Progress(events.append, "job", target.name),
                expected_duration=10,
                activity="正在提取音频",
                report_output_speed=False,
            )
            self.assertEqual(result.stat().st_size, 512)

        updates = [event for event in events if event.get("type") == "progress"]
        self.assertTrue(any(0.49 <= event["progress"] <= 0.51 for event in updates))
        self.assertEqual(updates[-1]["progress"], 1.0)
        self.assertTrue(all(event["speed"] == 0 for event in updates))
        self.assertTrue(any("0:05 / 0:10" in event["message"] and "2.50×" in event["message"] for event in updates))

    def test_ffmpeg_cancellation_removes_partial_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script = root / "slow_ffmpeg.py"
            script.write_text(
                "import pathlib, sys, time\n"
                "pathlib.Path(sys.argv[-1]).write_bytes(b'partial')\n"
                "time.sleep(10)\n",
                "utf-8",
            )
            target = root / "video.mp4"
            cancel = threading.Event()
            timer = threading.Timer(0.15, cancel.set)
            timer.start()
            try:
                with self.assertRaises(host.Cancelled):
                    host.run_ffmpeg([sys.executable, str(script), str(target)], target, cancel, host.Progress(lambda _event: None, "job", target.name))
            finally:
                timer.cancel()
            self.assertFalse(target.exists())
            self.assertEqual(list(root.glob(".*.part.mp4")), [])

    def test_commit_file_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "source.part"
            target = root / "target.bin"
            source.write_bytes(b"new")
            target.write_bytes(b"old")
            # An occupied name is never replaced; the finished bytes are
            # published under the next free name instead of being discarded.
            published = host.commit_file(source, target)
            self.assertEqual(published, root / "target (1).bin")
            self.assertEqual(target.read_bytes(), b"old")
            self.assertEqual(published.read_bytes(), b"new")
            self.assertFalse(source.exists())

    def test_native_message_reader_handles_short_reads(self):
        messages = [{"type": "ping", "requestId": "one"}, {"type": "cancel", "jobId": "two"}]
        framed = b"".join(struct.pack("=I", len(payload)) + payload for payload in (json.dumps(item).encode() for item in messages))
        self.assertEqual(list(host.read_messages(ChunkedReader(framed))), messages)
        with self.assertRaisesRegex(host.DownloadError, "Truncated native message"):
            list(host.read_messages(ChunkedReader(struct.pack("=I", 4) + b"{}")))
        with self.assertRaisesRegex(host.DownloadError, "empty"):
            list(host.read_messages(io.BytesIO(struct.pack("=I", 0))))

    def test_installer_uses_absolute_python_launcher(self):
        install = HOST_PATH.parent / "install-macos.sh"
        uninstall = HOST_PATH.parent / "uninstall-macos.sh"
        with tempfile.TemporaryDirectory() as home:
            environment = {**os.environ, "HOME": home}
            app_support = pathlib.Path(home) / "Library/Application Support"
            for browser_root in ("Google/Chrome for Testing", "Chromium"):
                (app_support / browser_root).mkdir(parents=True)
            subprocess.run(["bash", str(install)], env=environment, check=True, capture_output=True, text=True)
            manifest_paths = [
                app_support / "Google/Chrome/NativeMessagingHosts/io.github.blanchot_alice.fluxcatch.json",
                app_support / "Google/Chrome for Testing/NativeMessagingHosts/io.github.blanchot_alice.fluxcatch.json",
                app_support / "Chromium/NativeMessagingHosts/io.github.blanchot_alice.fluxcatch.json",
            ]
            self.assertTrue(all(path.is_file() for path in manifest_paths))
            manifest_path = manifest_paths[0]
            manifest = json.loads(manifest_path.read_text("utf-8"))
            self.assertEqual(manifest["name"], "io.github.blanchot_alice.fluxcatch")
            launcher = pathlib.Path(manifest["path"])
            launcher_text = launcher.read_text("utf-8")
            installed_host = pathlib.Path(home) / "Library/Application Support/FluxCatch/native-host/host.py"
            installed_policy = pathlib.Path(home) / "Library/Application Support/FluxCatch/native-host/fluxcatch_network_policy.py"
            self.assertTrue(launcher.is_absolute())
            self.assertTrue(os.access(launcher, os.X_OK))
            self.assertTrue(installed_host.is_file())
            self.assertEqual(installed_host.read_bytes(), HOST_PATH.read_bytes())
            self.assertEqual(installed_host.stat().st_mode & 0o777, 0o700)
            self.assertTrue(installed_policy.is_file())
            self.assertEqual(
                installed_policy.read_bytes(),
                (HOST_PATH.parent / "fluxcatch_network_policy.py").read_bytes(),
            )
            self.assertEqual(installed_policy.stat().st_mode & 0o777, 0o700)
            # The launcher must pin the stable interpreter path (the
            # `command -v python3` symlink such as /opt/homebrew/bin/python3),
            # never the versioned Cellar path it resolves to: a Homebrew
            # python upgrade plus cleanup would orphan the latter.
            stable_python = shutil.which("python3")
            self.assertTrue(stable_python)
            self.assertTrue(pathlib.Path(stable_python).is_absolute())
            self.assertIn(stable_python, launcher_text)
            resolved_python = str(pathlib.Path(stable_python).resolve())
            if resolved_python != stable_python:
                self.assertNotIn(resolved_python, launcher_text)
            self.assertIn(str(installed_host.resolve()), launcher_text)
            self.assertNotIn(str(HOST_PATH.resolve()), launcher_text)
            ffmpeg = shutil.which("ffmpeg")
            if ffmpeg:
                self.assertIn(f"FLUXCATCH_FFMPEG={ffmpeg}", launcher_text)
            self.assertNotIn("/usr/bin/env python3", launcher_text)

            subprocess.run(["bash", str(uninstall)], env=environment, check=True, capture_output=True, text=True)
            self.assertTrue(all(not path.exists() for path in manifest_paths))
            self.assertFalse(launcher.exists())
            self.assertFalse(installed_host.exists())
            self.assertFalse(installed_policy.exists())


    def test_multipart_pause_keeps_checkpoint_and_resume_skips_completed_ranges(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "paused.bin"
            part = target.with_suffix(".bin.part")
            checkpoint = target.with_suffix(".bin.part.json")
            control = host.JobControl()
            original_write = host.atomic_write_json

            def pause_once_a_range_is_durable(path, value):
                original_write(path, value)
                if value.get("completed"):
                    control.reason = "pause"
                    control.set()

            with mock.patch.object(host, "atomic_write_json", side_effect=pause_once_a_range_is_durable):
                with self.assertRaises(host.Cancelled):
                    host.multipart_download(
                        f"{self.base}/file.bin",
                        target,
                        {},
                        4,
                        control,
                        host.Progress(lambda _event: None, "paused", target.name),
                    )
            self.assertTrue(part.is_file(), "a pause keeps the part file")
            self.assertTrue(checkpoint.is_file(), "a pause keeps the checkpoint")
            completed = json.loads(checkpoint.read_text("utf-8"))["completed"]
            self.assertTrue(completed)
            requests_before = len(FixtureHandler.request_log)
            resumed = host.multipart_download(
                f"{self.base}/file.bin",
                target,
                {},
                4,
                threading.Event(),
                host.Progress(lambda _event: None, "resumed", target.name),
            )
            later_ranges = [value for path, value in FixtureHandler.request_log[requests_before:] if path == "/file.bin"]
            for key in completed:
                self.assertNotIn(f"bytes={key}", later_ranges, "a resumed job never re-fetches a durable range")
            self.assertEqual(resumed.read_bytes(), FILE_BYTES)
            self.assertFalse(part.exists())
            self.assertFalse(checkpoint.exists())
            # The same output name is handed back to the resuming job.
            part.write_bytes(b"")
            checkpoint.write_text(json.dumps({"schemaVersion": 2}), "utf-8")
            self.assertEqual(host.unique_path(target.parent, "paused.bin", allow_checkpoint=True), target.with_name("paused (1).bin"))

    def test_hls_pause_keeps_whole_segments_and_resume_reuses_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "paused.ts"
            control = host.JobControl()
            original_report = host.Progress.report

            def pause_after_first_segment(progress, payload, *, force=False):
                result = original_report(progress, payload, force=force)
                if str(payload.get("message", "")).startswith("分片 1/"):
                    control.reason = "pause"
                    control.set()
                return result

            with mock.patch.object(host.Progress, "report", pause_after_first_segment):
                with self.assertRaises(host.Cancelled):
                    host.hls_fast_download(f"{self.base}/master.m3u8", target, {}, 1, control, host.Progress(lambda _event: None, "paused", target.name), None)
            marker = target.with_suffix(".ts.part.json")
            placeholder = target.with_suffix(".ts.part")
            self.assertTrue(marker.is_file(), "a pause writes the segment checkpoint")
            self.assertTrue(placeholder.is_file() and placeholder.stat().st_size == 0)
            saved = json.loads(marker.read_text("utf-8"))
            self.assertEqual(saved["schemaVersion"], 3)
            self.assertEqual(saved["kind"], "hls")
            self.assertNotIn("m3u8", json.dumps(saved), "the marker never carries the playlist URL")
            work_dir = root / saved["workDir"]
            self.assertTrue(work_dir.is_dir())
            staged = sorted(path.name for path in (work_dir / "media").iterdir())
            self.assertTrue(staged, "whole segments stay staged")
            self.assertFalse(any(name.endswith(".tmp") for name in staged), "no half-written object survives a pause")
            self.assertEqual(host.unique_path(root, "paused.ts", allow_checkpoint=True), target, "the resuming job gets the same name")
            # Startup cleanup keeps the referenced directory but drops orphans.
            orphan = root / "fluxcatch-hls-orphan"
            orphan.mkdir()
            host.cleanup_stale_workdirs(root)
            self.assertTrue(work_dir.is_dir())
            self.assertFalse(orphan.exists())
            requests_before = len(FixtureHandler.request_log)
            result = host.hls_fast_download(f"{self.base}/master.m3u8", target, {}, 1, threading.Event(), host.Progress(lambda _event: None, "resumed", target.name), None)
            later = [path for path, _value in FixtureHandler.request_log[requests_before:]]
            self.assertNotIn("/seg0.ts", later, "the first segment is reused, not re-fetched")
            self.assertEqual(result.read_bytes(), b"".join(SEGMENTS[f"/seg{i}.ts"] for i in range(3)))
            self.assertFalse(work_dir.exists())
            self.assertFalse(marker.exists())
            self.assertFalse(placeholder.exists())

    def test_expired_pause_markers_and_discard_remove_every_leftover(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            kept = root / "fluxcatch-dash-kept"
            kept.mkdir()
            (kept / "video-default").mkdir()
            target = root / "paused.mp4"
            host.write_segment_checkpoint(target, "https://media.example/manifest.mpd", kept, "dash")
            old = time.time() - host.STALE_PARTIAL_TTL_SECONDS - 10
            os.utime(target.with_suffix(".mp4.part.json"), (old, old))
            host.cleanup_stale_workdirs(root)
            self.assertFalse(kept.exists(), "an expired marker no longer protects its directory")
            self.assertFalse(target.with_suffix(".mp4.part.json").exists())
            self.assertFalse(target.with_suffix(".mp4.part").exists())

            kept.mkdir()
            host.write_segment_checkpoint(target, "https://media.example/manifest.mpd", kept, "dash")
            removed = host.discard_partial_download(root, "paused.mp4")["removed"]
            self.assertEqual(sorted(removed), ["checkpoint", "part", "workDir"])
            self.assertFalse(kept.exists())
            self.assertEqual(host.discard_partial_download(root, "../paused.mp4")["removed"], [])

    def test_job_slots_follow_the_concurrency_setting_and_announce_queueing(self):
        sent = []
        native = host.Host.__new__(host.Host)
        native.send = sent.append
        native.job_limit = host.DEFAULT_CONCURRENT_JOBS
        native.running_jobs = 0
        native.slots = threading.Condition()
        first = host.JobControl()
        native._acquire_job_slot(1, first, "job-1", "a.mp4")
        self.assertEqual(native.running_jobs, 1)
        second = host.JobControl()
        acquired = threading.Event()

        def wait_for_slot():
            native._acquire_job_slot(1, second, "job-2", "b.mp4")
            acquired.set()

        waiter = threading.Thread(target=wait_for_slot, daemon=True)
        waiter.start()
        self.assertFalse(acquired.wait(0.6), "the second job waits while the limit is one")
        self.assertTrue(any(event.get("status") == "queued" and event.get("jobId") == "job-2" for event in sent), "a waiting job tells Chrome it is queued")
        native._release_job_slot()
        self.assertTrue(acquired.wait(3.0), "releasing a slot admits the waiting job")
        self.assertEqual(native.running_jobs, 1)
        third = host.JobControl()
        third.set()
        with self.assertRaises(host.Cancelled):
            native._acquire_job_slot(1, third, "job-3", "c.mp4")
        native._release_job_slot()
        self.assertEqual(native.running_jobs, 0)

    def test_save_folder_config_precedence_validation_and_confinement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config_path = root / "config.json"
            chosen = root / "Movies" / "FluxCatch"
            previous = root / "Old"
            previous.mkdir()
            (previous / "kept.mp4").write_bytes(b"old")
            # No config: the default folder. A chosen folder wins over it; the
            # environment override (tests and harnesses) wins over both.
            self.assertEqual(host.load_host_config(config_path), {})
            host.save_host_config({"downloadDir": str(chosen), "knownDownloadDirs": [str(previous), "relative/path", str(root / "missing")]}, config_path)
            config = host.load_host_config(config_path)
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("FLUXCATCH_DOWNLOAD_DIR", None)
                self.assertEqual(host.resolve_download_dir(config), chosen.resolve())
                self.assertTrue(chosen.is_dir(), "a chosen folder is created on demand")
                self.assertEqual(host.resolve_download_dir({"downloadDir": "not/absolute"}), host.default_download_dir())
            with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": str(root / "env")}):
                self.assertEqual(host.resolve_download_dir(config), root / "env")
            self.assertEqual(host.known_download_dirs(config), [previous])
            with self.assertRaises(host.DownloadError):
                host.validate_download_dir("relative")
            with self.assertRaises(host.DownloadError):
                host.validate_download_dir(str(root / "fluxcatch-hls-work"))
            link = root / "link"
            link.symlink_to(previous)
            with self.assertRaises(host.DownloadError):
                host.validate_download_dir(str(link))

            native = host.Host.__new__(host.Host)
            native.targets_lock = threading.Lock()
            native.download_dir = chosen.resolve()
            native.known_download_dirs = [previous]
            native.config = {}
            inside = chosen / "new.mp4"
            inside.write_bytes(b"new")
            self.assertEqual(native.managed_path(str(inside)), inside.resolve())
            self.assertEqual(native.managed_path(str(previous / "kept.mp4")), (previous / "kept.mp4").resolve(), "files saved in an earlier folder stay openable")
            with self.assertRaises(host.DownloadError):
                native.managed_path(str(root / "elsewhere.mp4"))

            sent = []
            native.send = sent.append
            with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": str(root / "env")}), mock.patch.object(host, "default_download_dir", return_value=root / "Default"):
                native.handle_choose_folder({"type": "choose_folder", "requestId": "r1", "reset": True})
            self.assertTrue(sent[-1]["ok"], sent[-1])
            self.assertEqual(sent[-1]["downloadDir"], str((root / "Default").resolve()))
            self.assertEqual(native.download_dir, (root / "Default").resolve())
            self.assertIn(chosen.resolve(), native.known_download_dirs, "the previous folder is remembered")
            self.assertFalse((root / "nothing-written.json").exists())
            with mock.patch.object(host, "choose_folder_dialog", return_value=None):
                native.handle_choose_folder({"type": "choose_folder", "requestId": "r2"})
            self.assertFalse(sent[-1]["ok"])
            self.assertEqual(sent[-1]["error"], "cancelled")

    def test_host_pause_requests_flip_the_job_control_and_report_paused(self):
        sent = []
        native = host.Host.__new__(host.Host)
        native.jobs = {}
        native.jobs_lock = threading.Lock()
        native.targets_lock = threading.Lock()
        native.reserved_targets = set()
        native.write_lock = threading.Lock()
        native.send = sent.append
        with tempfile.TemporaryDirectory() as directory:
            native.download_dir = pathlib.Path(directory)
            control = host.JobControl()
            native.jobs["job-1"] = control
            native.handle({"type": "pause", "jobId": "job-1"})
            self.assertTrue(control.is_set())
            self.assertEqual(control.reason, "pause")
            native.run_job("job-1", {"type": "download", "url": f"{self.base}/file.bin", "filename": "paused.bin"}, control)
            self.assertEqual(sent[-1]["type"], "paused")
            self.assertEqual(sent[-1]["status"], "paused")
            self.assertEqual(sent[-1]["targetName"], "paused.bin")
            self.assertNotIn("job-1", native.jobs)
            native.jobs["job-2"] = host.JobControl()
            native.jobs["job-2"].reason = "pause"
            native.handle({"type": "cancel", "jobId": "job-2"})
            self.assertEqual(native.jobs["job-2"].reason, "cancel", "a cancel after a pause request discards state")
            native.handle({"type": "discard", "requestId": "r1", "filename": "nothing.bin"})
            self.assertEqual(sent[-1]["action"], "discard")
            self.assertTrue(sent[-1]["ok"])
        self.assertEqual(host.PAUSE_CAPABILITY, "resume-v1")


if __name__ == "__main__":
    unittest.main()


class ManifestFetchDeadlineTest(unittest.TestCase):
    """Slow-drip manifests must fail on a total wall-clock deadline."""

    def _run_fetch(self, handler):
        started = time.monotonic()
        server = LoopbackServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/pl.m3u8"
        token = host.set_current_network_policy(
            host.NetworkPolicy(allow_private_network_media=True)
        )
        try:
            with self.assertRaises(host.DownloadError) as caught:
                host.fetch_manifest(url, {"user-agent": "fluxcatch-test"})
        finally:
            host.reset_current_network_policy(token)
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        return time.monotonic() - started, str(caught.exception)

    def test_fully_stalled_manifest_fails_with_explicit_timeout(self):
        class HoldHandler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, _format, *_args):
                pass

            def do_GET(self):
                try:
                    self.connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n")
                    threading.Event().wait(120)
                except Exception:
                    pass

        elapsed, message = self._run_fetch(HoldHandler)
        self.assertIn("获取播放列表超时", message)
        self.assertLess(elapsed, 70.0)

    def test_slow_drip_manifest_cannot_evade_total_deadline(self):
        class DripHandler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, _format, *_args):
                pass

            def do_GET(self):
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                self.wfile.write(
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: application/vnd.apple.mpegurl\r\n"
                    b"Transfer-Encoding: chunked\r\n\r\n"
                )
                self.wfile.flush()
                try:
                    while True:
                        self.wfile.write(b"1\r\n#\r\n")
                        self.wfile.flush()
                        threading.Event().wait(4)
                except Exception:
                    pass

        elapsed, message = self._run_fetch(DripHandler)
        self.assertIn("获取播放列表超时", message)
        self.assertLess(elapsed, 70.0)


class FakeBodyResponse:
    """Minimal urllib-like response for single-stream download tests."""

    def __init__(self, chunks, status=200, headers=None):
        self.chunks = list(chunks)
        self.status = status
        self.headers = headers or {}
        self.closed = False

    def read(self, _size=-1):
        return self.chunks.pop(0) if self.chunks else b""

    def geturl(self):
        return "https://media.example.test/clip.mp4"

    def close(self):
        self.closed = True


class OutputAndFileActionTests(unittest.TestCase):
    """Publishing, history metadata and the Finder-facing file actions."""

    def _host(self, directory):
        capability = host.FfmpegCapabilities(path="/fixture/ffmpeg", version="8.1", hls_demuxer=True, dash_demuxer=True, libmp3lame=True)
        with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}), mock.patch.object(host, "probe_ffmpeg", return_value=capability), mock.patch.object(host, "probe_ytdlp", return_value=host.YtDlpCapabilities()):
            return host.Host()

    def test_commit_file_publishes_under_next_free_name_when_occupied(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "movie.mp4"
            target.write_bytes(b"older file the user dropped in")
            source = root / "movie.mp4.part"
            source.write_bytes(b"fresh transfer")
            published = host.commit_file(source, target)
            self.assertEqual(published, root / "movie (1).mp4")
            self.assertEqual(published.read_bytes(), b"fresh transfer")
            self.assertEqual(target.read_bytes(), b"older file the user dropped in", "an occupied name is never overwritten")
            self.assertFalse(source.exists())

    def test_cleanup_collects_stale_partials_but_keeps_fresh_and_finished_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            now = time.time()
            old = now - 9 * 86_400
            stale_part = root / "old.mp4.part"
            stale_checkpoint = root / "old.mp4.part.json"
            stale_staging = root / f".old.{'0' * 32}.part.mp4"
            fresh_part = root / "fresh.mp4.part"
            finished = root / "movie.mp4"
            work_dir = root / "fluxcatch-hls-crash"
            for path in (stale_part, stale_checkpoint, stale_staging, fresh_part, finished):
                path.write_bytes(b"x")
            work_dir.mkdir()
            for path in (stale_part, stale_checkpoint, stale_staging, finished):
                os.utime(path, (old, old))
            host.cleanup_stale_workdirs(root, now=now)
            self.assertFalse(stale_part.exists())
            self.assertFalse(stale_checkpoint.exists())
            self.assertFalse(stale_staging.exists())
            self.assertFalse(work_dir.exists())
            self.assertTrue(fresh_part.exists(), "a week-old resumable transfer keeps its checkpoint")
            self.assertTrue(finished.exists(), "published media is never touched")

    def test_single_download_rejects_truncated_close_delimited_bodies(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "clip.mp4"
            progress = host.Progress(lambda _event: None, "job", target.name)
            truncated = lambda *_args, **_kwargs: FakeBodyResponse([b"a" * 1000], headers={"Content-Type": "video/mp4"})  # noqa: E731
            with mock.patch.object(host, "request", side_effect=truncated), mock.patch.object(host, "_retry_wait", return_value=None):
                with self.assertRaisesRegex(host.DownloadError, "ended before Content-Length"):
                    host.single_download("https://media.example.test/clip.mp4", target, {}, threading.Event(), progress, expected_length=2000)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_suffix(".mp4.part").exists(), "no partial output is left behind")
            # A non-200 answer to a media GET (e.g. 204 or a 206 to a plain
            # request) is not media either.
            odd = lambda *_args, **_kwargs: FakeBodyResponse([b""], status=204, headers={"Content-Type": "video/mp4"})  # noqa: E731
            with mock.patch.object(host, "request", side_effect=odd), mock.patch.object(host, "_retry_wait", return_value=None):
                with self.assertRaisesRegex(host.DownloadError, "unexpected media response status"):
                    host.single_download("https://media.example.test/clip.mp4", target, {}, threading.Event(), progress)

    def test_completion_message_carries_media_facts_and_poster(self):
        with tempfile.TemporaryDirectory() as directory:
            native = self._host(directory)
            try:
                target = pathlib.Path(directory) / "lesson.mp4"
                target.write_bytes(b"0" * 4096)
                facts = {"duration": 83.4, "width": 1280, "height": 720, "container": "mov", "videoCodec": "h264", "audioCodec": "aac"}
                with mock.patch.object(host, "describe_media", return_value=facts) as describe, mock.patch.object(host, "make_thumbnail", return_value="data:image/jpeg;base64,AAAA") as poster:
                    message = native.completion_message("job-1", target, started=time.monotonic() - 1.5)
                self.assertEqual(message["type"], "complete")
                self.assertEqual(message["path"], str(target))
                self.assertEqual(message["size"], 4096)
                self.assertEqual(message["message"], host.COMPLETE_MESSAGE)
                self.assertEqual(message["media"], facts)
                self.assertEqual(message["thumbnail"], "data:image/jpeg;base64,AAAA")
                self.assertGreaterEqual(message["elapsedMs"], 1400)
                self.assertEqual(message["downloadDir"], str(native.download_dir))
                describe.assert_called_once_with(target, native.ffmpeg)
                poster.assert_called_once_with(target, native.ffmpeg, 83.4)
                with mock.patch.object(host, "describe_media", return_value={}), mock.patch.object(host, "make_thumbnail") as skipped:
                    audio = native.completion_message("job-2", target, started=time.monotonic(), extract_audio=True)
                self.assertIsNone(audio["thumbnail"])
                skipped.assert_not_called()
                # The ping advertises the folder and the action protocol.
                with mock.patch.object(native, "send") as send:
                    native.handle({"type": "ping", "requestId": "p"})
                pong = send.call_args.args[0]
                self.assertEqual(pong["downloadDir"], str(native.download_dir))
                self.assertEqual(pong["capabilities"]["fileActions"], "finder-v1")
            finally:
                native.close()

    def test_file_actions_are_confined_to_the_download_folder(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as elsewhere:
            native = self._host(directory)
            try:
                root = native.download_dir.resolve()
                inside = root / "keep.mp4"
                inside.write_bytes(b"media")
                partial = root / "half.mp4.part"
                partial.write_bytes(b"...")
                outside = pathlib.Path(elsewhere) / "secret.txt"
                outside.write_text("private")
                link = root / "link.mp4"
                link.symlink_to(outside)
                opened = []
                with mock.patch.object(host, "run_opener", side_effect=lambda args: opened.append(args)):
                    reveal = native.handle_file_action("reveal", {"requestId": "r1", "path": str(inside)})
                    self.assertTrue(reveal["ok"], reveal)
                    self.assertEqual(opened[-1], [host.OPEN_COMMAND, "-R", str(inside)])
                    opened_file = native.handle_file_action("open", {"requestId": "r2", "path": str(inside)})
                    self.assertTrue(opened_file["ok"])
                    self.assertEqual(opened[-1], [host.OPEN_COMMAND, str(inside)])
                    folder = native.handle_file_action("open_folder", {"requestId": "r3"})
                    self.assertTrue(folder["ok"])
                    self.assertEqual(opened[-1], [host.OPEN_COMMAND, str(native.download_dir)])
                    for bad in (str(outside), str(link), "relative/keep.mp4", str(root), str(partial), str(root / "missing.mp4"), 42):
                        result = native.handle_file_action("open", {"requestId": "x", "path": bad})
                        self.assertFalse(result["ok"], bad)
                    self.assertEqual(len(opened), 3, "no confined path ever reaches macOS")
                    stat = native.handle_file_action("stat", {"requestId": "s", "paths": [str(inside), str(outside), str(root / "gone.mp4")]})
                    self.assertTrue(stat["ok"])
                    self.assertEqual([item["exists"] for item in stat["items"]], [True, False, False])
                    self.assertEqual(stat["items"][0]["size"], 5)
                self.assertTrue(outside.exists())
                self.assertEqual(reveal["type"], "file_action_result")
                self.assertEqual(reveal["requestId"], "r1")
            finally:
                native.close()

    def test_trash_moves_the_file_into_the_user_trash_without_deleting_bytes(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as home:
            native = self._host(directory)
            try:
                first = native.download_dir / "clip.mp4"
                first.write_bytes(b"one")
                with mock.patch.dict(os.environ, {"HOME": home}):
                    result = native.handle_file_action("trash", {"requestId": "t1", "path": str(first)})
                    self.assertTrue(result["ok"], result)
                    self.assertFalse(first.exists())
                    trashed = pathlib.Path(home) / ".Trash" / "clip.mp4"
                    self.assertEqual(trashed.read_bytes(), b"one")
                    second = native.download_dir / "clip.mp4"
                    second.write_bytes(b"two")
                    again = native.handle_file_action("trash", {"requestId": "t2", "path": str(second)})
                    self.assertTrue(again["ok"], again)
                    names = sorted(path.name for path in (pathlib.Path(home) / ".Trash").iterdir())
                    self.assertEqual(len(names), 2, names)
                    self.assertEqual(trashed.read_bytes(), b"one", "an earlier trashed file is never overwritten")
                    outside = pathlib.Path(home) / "not-managed.mp4"
                    outside.write_bytes(b"keep")
                    refused = native.handle_file_action("trash", {"requestId": "t3", "path": str(outside)})
                    self.assertFalse(refused["ok"])
                    self.assertTrue(outside.exists())
            finally:
                native.close()


if __name__ == "__main__":
    unittest.main()


class PreloadedManifestTests(unittest.TestCase):
    """Playlists the extension fetched with the browser session (The Economist Insider)."""

    @classmethod
    def setUpClass(cls):
        cls.server = LoopbackServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        FixtureHandler.reset()
        self.network_token = host.set_current_network_policy(host.NetworkPolicy(allow_private_network_media=True))
        self.addCleanup(host.reset_current_network_policy, self.network_token)

    def test_preloaded_playlists_replace_only_their_own_fetch(self):
        master_url = f"{self.base}/video-api/playback/hls.m3u8?u=master-token"
        media_url = f"{self.base}/video-api/playback/hls.m3u8?u=media-token&t=m"
        audio_url = f"{self.base}/aes/../hls/audio.m3u8"
        with self.assertRaisesRegex(host.DownloadError, "not on the media origin"):
            host.preloaded_manifests({"https://other.example/x.m3u8": "#EXTM3U\n"}, master_url)
        with self.assertRaisesRegex(host.DownloadError, "not an HLS playlist"):
            host.preloaded_manifests({master_url: "<html>"}, master_url)
        with self.assertRaisesRegex(host.DownloadError, "Too many"):
            host.preloaded_manifests({f"{self.base}/{index}.m3u8": "#EXTM3U" for index in range(5)}, master_url)
        self.assertEqual(host.preloaded_manifests(None, master_url), {})
        preloaded = host.preloaded_manifests({master_url: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n" + media_url + "\n", media_url: "#EXTM3U\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n"}, master_url)
        self.assertEqual(sorted(preloaded), sorted([master_url, media_url]))
        token = host._PRELOADED_MANIFESTS.set(preloaded)
        try:
            fetched = host.fetch_manifest(master_url, {"Referer": f"{self.base}/watch"}, threading.Event())
            self.assertIn("#EXT-X-STREAM-INF", fetched.text)
            self.assertEqual(fetched.final_url, master_url)
            self.assertEqual(fetched.request_headers["referer"], f"{self.base}/watch")
            self.assertEqual([path for path, _range in FixtureHandler.request_log if "playback" in path], [], "a preloaded address is never fetched")
            playlist, text, master, selected = host.select_hls_media(master_url, {}, media_url, threading.Event())
            self.assertIsNotNone(master)
            self.assertEqual(selected["url"], media_url)
            self.assertEqual([segment.url for segment in playlist.segments], [f"{self.base}/video-api/playback/seg.ts"])
            with mock.patch.object(host, "_manifest_fetch_bounded", side_effect=AssertionError("network fetch for a preloaded address")):
                again = host.fetch_manifest(media_url, {}, threading.Event())
                self.assertIn("#EXTINF", again.text)
            # Anything the text names outside the preloaded set still goes to the network.
            live = host.fetch_manifest(f"{self.base}/aes/index.m3u8", {}, threading.Event())
            self.assertIn("#EXT-X-KEY", live.text)
        finally:
            host._PRELOADED_MANIFESTS.reset(token)
        self.assertEqual(host._PRELOADED_MANIFESTS.get(), {}, "the preload is scoped to the job")
        # The policy gate still applies to a preloaded address.
        public_only = host.set_current_network_policy(host.NetworkPolicy(allow_private_network_media=False))
        try:
            token = host._PRELOADED_MANIFESTS.set(preloaded)
            try:
                with self.assertRaises(host.NetworkPolicyError):
                    host.fetch_manifest(master_url, {}, threading.Event())
            finally:
                host._PRELOADED_MANIFESTS.reset(token)
        finally:
            host.reset_current_network_policy(public_only)


FAKE_YTDLP = r"""#!/usr/bin/env python3
import base64, json, os, socket, sys, time, urllib.parse
argv = sys.argv[1:]
log = os.environ.get("FAKE_YTDLP_LOG") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "argv.json")
with open(log, "w", encoding="utf-8") as handle:
    json.dump({"argv": argv, "env": dict(os.environ), "cwd": os.getcwd()}, handle)
if argv == ["--version"]:
    print("2026.08.19")
    sys.exit(0)
mode = os.environ.get("FAKE_YTDLP_MODE") or os.path.basename(os.path.dirname(os.path.abspath(__file__))).split("-")[-1]
url = argv[-1]
proxy = urllib.parse.urlsplit(argv[argv.index("--proxy") + 1])

def through_broker(path):
    target = urllib.parse.urlsplit(url)
    sock = socket.create_connection((proxy.hostname, proxy.port), 10)
    credential = base64.b64encode(f"{proxy.username}:{proxy.password}".encode()).decode()
    sock.sendall(f"CONNECT {target.hostname}:{target.port} HTTP/1.1\r\nHost: {target.hostname}:{target.port}\r\nProxy-Authorization: Basic {credential}\r\n\r\n".encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(4096)
        if not chunk:
            raise SystemExit("broker closed the CONNECT")
        head += chunk
    status = head.split(b"\r\n", 1)[0]
    if b" 200 " not in status:
        sys.stderr.write("broker refused: " + status.decode() + "\n")
        sys.exit(7)
    sock.sendall(f"GET {path} HTTP/1.1\r\nHost: {target.hostname}:{target.port}\r\nConnection: close\r\n\r\n".encode())
    body = b""
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        body += chunk
    sock.close()
    header, _, payload = body.partition(b"\r\n\r\n")
    return payload

if "-J" in argv:
    through_broker(urllib.parse.urlsplit(url).path)
    print(json.dumps({
        "title": "Fixture Clip",
        "duration": 95.4,
        "is_live": False,
        "formats": [
            {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "tbr": 129},
            {"format_id": "134", "ext": "mp4", "height": 360, "width": 640, "vcodec": "avc1.4d401e", "acodec": "none", "tbr": 400},
            {"format_id": "136", "ext": "mp4", "height": 720, "width": 1280, "vcodec": "avc1.4d401f", "acodec": "none", "tbr": 1500},
            {"format_id": "247", "ext": "webm", "height": 720, "width": 1280, "vcodec": "vp9", "acodec": "none", "tbr": 1200},
            {"format_id": "137", "ext": "mp4", "height": 1080, "width": 1920, "vcodec": "avc1.640028", "acodec": "none", "tbr": 2800},
            {"format_id": "22", "ext": "mp4", "height": 720, "width": 1280, "vcodec": "avc1.64001F", "acodec": "mp4a.40.2", "tbr": 1600, "url": "https://rr1.googlevideo.com/videoplayback?sig=SECRET"}
        ]
    }))
    sys.exit(0)
if mode == "fail":
    sys.stderr.write("ERROR: [youtube] fixture: Video unavailable. This video is private\n")
    sys.exit(1)
if mode == "hang":
    time.sleep(30)
    sys.exit(0)
payload = through_broker(urllib.parse.urlsplit(url).path)
template = argv[argv.index("-o") + 1]
print("FLUXCATCH\tdownloading\t512\t%d\tNA\t2048\tNA\tNA" % len(payload), flush=True)
time.sleep(0.35)
print("FLUXCATCH\tdownloading\t%d\t%d\tNA\t4096\t3\t8" % (len(payload) - 1, len(payload)), flush=True)
print("FLUXCATCH\tfinished\t%d\t%d\tNA\tNA\tNA\tNA" % (len(payload), len(payload)), flush=True)
print("FLUXCATCH_PP\tstarted\tMerger", flush=True)
ext = "mp3" if "-x" in argv else argv[argv.index("--merge-output-format") + 1]
with open(template.replace("%(ext)s", ext), "wb") as handle:
    handle.write(payload)
print("FLUXCATCH_PP\tfinished\tMerger", flush=True)
"""


class ExternalToolTests(unittest.TestCase):
    """The loopback broker and the yt-dlp adapter built on it."""

    @classmethod
    def setUpClass(cls):
        cls.server = LoopbackServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        FixtureHandler.reset()
        FixtureHandler.dynamic_routes = {"/clip.mp4": {"body": b"fixture clip bytes " * 2048, "mime": "video/mp4"}}
        self.addCleanup(setattr, FixtureHandler, "dynamic_routes", {})
        patcher = mock.patch.object(host, "EXTERNAL_TOOL_BROKER_PORTS", frozenset({80, 443, self.port}))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.policy = host.NetworkPolicy(allow_private_network_media=True)
        self.network_token = host.set_current_network_policy(self.policy)
        self.addCleanup(host.reset_current_network_policy, self.network_token)

    def write_fake_ytdlp(self, root, mode="ok"):
        directory = pathlib.Path(root) / f"fake-ytdlp-{mode}"
        directory.mkdir()
        script = directory / "yt-dlp"
        script.write_text(FAKE_YTDLP, "utf-8")
        script.chmod(0o700)
        return script, directory / "argv.json"

    @staticmethod
    def connect(broker, target, *, auth=True, method="CONNECT"):
        sock = socket.create_connection(("127.0.0.1", broker.port), 5)
        credential = base64.b64encode(f"{broker.username}:{broker.token}".encode()).decode()
        request = f"{method} {target} HTTP/1.1\r\nHost: {target}\r\n"
        if auth:
            request += f"Proxy-Authorization: Basic {credential}\r\n"
        sock.sendall((request + "\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(4096)
            if not chunk:
                break
            head += chunk
        return sock, head.split(b"\r\n", 1)[0].decode()

    def test_broker_requires_credentials_policy_and_connect(self):
        broker = host.ExternalToolBroker(self.policy)
        self.addCleanup(broker.close)
        self.assertRegex(broker.proxy_url, rf"^http://fluxcatch:[A-Za-z0-9_-]+@127\.0\.0\.1:{broker.port}$")
        sock, status = self.connect(broker, f"127.0.0.1:{self.port}", auth=False)
        sock.close()
        self.assertIn("407", status)
        sock, status = self.connect(broker, f"127.0.0.1:{self.port}", method="GET")
        sock.close()
        self.assertIn("405", status)
        sock, status = self.connect(broker, "127.0.0.1:9")
        sock.close()
        self.assertIn("403", status, "a port outside the allowlist is refused")
        sock, status = self.connect(broker, "169.254.169.254:443")
        sock.close()
        self.assertIn("403", status, "metadata addresses fail closed even with private media enabled")
        self.assertTrue(broker.rejections and "169.254.169.254" in broker.rejections[-1])
        public_only = host.ExternalToolBroker(host.NetworkPolicy(allow_private_network_media=False))
        self.addCleanup(public_only.close)
        sock, status = self.connect(public_only, f"127.0.0.1:{self.port}")
        sock.close()
        self.assertIn("403", status, "loopback stays blocked without the private-network opt-in")
        sock, status = self.connect(broker, f"127.0.0.1:{self.port}")
        self.assertIn("200", status)
        sock.sendall(f"GET /clip.mp4 HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nConnection: close\r\n\r\n".encode())
        body = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            body += chunk
        sock.close()
        self.assertIn(b"HTTP/1.1 200", body)
        self.assertTrue(body.endswith(b"fixture clip bytes "), "bytes relay through the tunnel unchanged")
        self.assertEqual(broker.tunnels, 1)
        self.assertIn((" /clip.mp4", ""), [(" " + path, rng) for path, rng in FixtureHandler.request_log])
        broker.close()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", broker.port), 1)

    def test_youtube_download_runs_ytdlp_through_the_broker_and_publishes_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script, log = self.write_fake_ytdlp(root)
            target = root / "Fixture Clip.mp4"
            events = []
            progress = host.Progress(events.append, "job", target.name)
            with mock.patch.dict(os.environ, {"https_proxy": "http://127.0.0.1:1", "FLUXCATCH_DISABLE_SYSTEM_PROXY": "1"}):
                result = host.youtube_download(
                    f"{self.base}/clip.mp4",
                    target,
                    "mp4",
                    False,
                    threading.Event(),
                    progress,
                    str(script),
                    ffmpeg="/fixture/ffmpeg",
                    max_height=720,
                    concurrent_fragments=3,
                    work_root=root,
                )
            self.assertEqual(result, target)
            self.assertEqual(result.read_bytes(), b"fixture clip bytes " * 2048)
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertEqual([entry.name for entry in root.iterdir() if entry.name.startswith(host.YTDLP_WORK_PREFIX)], [], "the work directory is removed")
            recorded = json.loads(log.read_text("utf-8"))
            argv = recorded["argv"]
            self.assertEqual(argv[-1], f"{self.base}/clip.mp4")
            self.assertEqual(argv[argv.index("--merge-output-format") + 1], "mp4")
            self.assertEqual(argv[argv.index("-f") + 1], "bv*[height<=720]+ba/b[height<=720]")
            self.assertEqual(argv[argv.index("--concurrent-fragments") + 1], "3")
            self.assertEqual(argv[argv.index("--ffmpeg-location") + 1], "/fixture/ffmpeg")
            self.assertIn("--ignore-config", argv)
            self.assertIn("--no-playlist", argv)
            self.assertNotIn("https_proxy", recorded["env"], "inherited proxy variables never reach the tool")
            self.assertTrue(os.path.realpath(recorded["cwd"]).startswith(os.path.realpath(str(root))))
            self.assertTrue(recorded["env"]["PATH"].startswith(str(script.parent.resolve())))
            statuses = [event.get("status") for event in events]
            self.assertIn("starting", statuses)
            self.assertIn("downloading", statuses)
            self.assertIn("remuxing", statuses)
            downloading = [event for event in events if event.get("status") == "downloading"]
            self.assertTrue(any("分片 3/8" in event.get("message", "") for event in downloading))
            self.assertTrue(all(event["total"] == len(b"fixture clip bytes " * 2048) for event in downloading))
            self.assertEqual(host.ytdlp_format_args("mp4", True), ["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "2"])
            self.assertEqual(host.ytdlp_format_args("webm", False)[1], "bv*+ba/b")
            self.assertEqual(host.ytdlp_format_args("flv", False)[-3], "mp4", "unknown containers fall back to MP4")

    def test_youtube_download_reports_tool_failures_and_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script, _log = self.write_fake_ytdlp(root, "fail")
            target = root / "broken.mp4"
            progress = host.Progress(lambda _event: None, "job", target.name)
            with self.assertRaisesRegex(host.DownloadError, r"yt-dlp failed \(1\): .*Video unavailable"):
                host.youtube_download(f"{self.base}/clip.mp4", target, "mp4", False, threading.Event(), progress, str(script), work_root=root)
            self.assertFalse(target.exists())
            self.assertEqual([entry.name for entry in root.iterdir() if entry.name.startswith(host.YTDLP_WORK_PREFIX)], [])

            script, _log = self.write_fake_ytdlp(root, "hang")
            cancel = threading.Event()
            timer = threading.Timer(0.6, cancel.set)
            timer.start()
            started = time.monotonic()
            with self.assertRaises(host.Cancelled):
                host.youtube_download(f"{self.base}/clip.mp4", root / "hung.mp4", "mp4", False, cancel, progress, str(script), work_root=root)
            timer.cancel()
            self.assertLess(time.monotonic() - started, 10, "cancellation terminates the tool's process group promptly")

    def test_youtube_inspect_and_host_message_summarize_the_quality_ladder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script, log = self.write_fake_ytdlp(root)
            summary = host.youtube_inspect(f"{self.base}/clip.mp4", str(script), "/fixture/ffmpeg")
            self.assertEqual(summary["title"], "Fixture Clip")
            self.assertEqual(summary["duration"], 95)
            self.assertFalse(summary["live"])
            self.assertFalse(summary["audioOnly"])
            self.assertEqual([variant["height"] for variant in summary["variants"]], [1080, 720, 360])
            self.assertEqual(summary["variants"][1]["bandwidth"], 1_600_000, "the best bitrate per height wins")
            self.assertNotIn("url", json.dumps(summary))
            self.assertNotIn("SECRET", json.dumps(summary))
            argv = json.loads(log.read_text("utf-8"))["argv"]
            self.assertIn("-J", argv)
            self.assertIn("--skip-download", argv)

            with self.assertRaisesRegex(host.DownloadError, "yt-dlp is not installed"):
                host.youtube_inspect(f"{self.base}/clip.mp4", None)
            self.assertEqual(host.summarize_ytdlp_info({"title": "Audio", "formats": [{"vcodec": "none", "acodec": "opus", "height": None}]})["audioOnly"], True)
            with self.assertRaises(host.DownloadError):
                host.summarize_ytdlp_info(None)

            with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": str(root), "FLUXCATCH_YTDLP": str(script)}):
                native = host.Host()
                try:
                    self.assertEqual(native.ytdlp, str(script.resolve()))
                    self.assertTrue(native.ytdlp_capabilities.available)
                    self.assertEqual(native.ytdlp_capabilities.version, "2026.08.19")
                    done = threading.Event()
                    replies = []

                    def capture(message):
                        replies.append(message)
                        done.set()

                    with mock.patch.object(native, "send", side_effect=capture):
                        native.handle({"type": "inspect_youtube", "requestId": "yt-1", "url": f"{self.base}/clip.mp4", "options": {"allowPrivateNetworkMedia": True}})
                        self.assertTrue(done.wait(20))
                    reply = replies[-1]
                    self.assertEqual(reply["type"], "inspect_youtube_result")
                    self.assertEqual(reply["requestId"], "yt-1")
                    self.assertTrue(reply["ok"])
                    self.assertEqual(reply["title"], "Fixture Clip")
                    self.assertEqual([variant["height"] for variant in reply["variants"]], [1080, 720, 360])

                    done.clear()
                    with mock.patch.object(native, "send", side_effect=capture):
                        native.handle({"type": "inspect_youtube", "requestId": "yt-2", "url": f"{self.base}/clip.mp4"})
                        self.assertTrue(done.wait(20))
                    self.assertFalse(replies[-1]["ok"], "without the private-network opt-in the loopback fixture is refused")
                    self.assertIn("yt-dlp failed (7)", replies[-1]["error"])
                finally:
                    native.close()
