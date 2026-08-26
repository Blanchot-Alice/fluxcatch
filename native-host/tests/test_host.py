from __future__ import annotations

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
                self.assertFalse(message["capabilities"]["ytdlp"]["available"])
                self.assertTrue(message["capabilities"]["ytdlp"]["installed"])
                self.assertTrue(message["capabilities"]["ytdlp"]["networkDisabled"])
                self.assertIsNone(native.ytdlp)
                self.assertEqual(message["capabilities"]["dashPlanner"], "static-v1")
                self.assertEqual(message["capabilities"]["dashPair"], "direct-v1")
                self.assertEqual(message["capabilities"]["externalNetworkProcesses"], "disabled")
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
                    live=False,
                    encrypted=True,
                    protection="aes128",
                    segments=[host.HlsSegment(f"{self.base}/seg0.ts")],
                ),
                "AES-128 audio HLS",
            ),
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
            (host.HlsPlaylist(url=f"{self.base}/aes.m3u8", live=False, encrypted=True, protection="aes128", segments=[host.HlsSegment(f"{self.base}/seg0.ts")]), "AES-128 HLS"),
            (host.HlsPlaylist(url=f"{self.base}/discontinuous.m3u8", live=False, discontinuity=True, segments=[host.HlsSegment(f"{self.base}/seg0.ts")]), "Discontinuous HLS"),
        ]
        for playlist, message in unsupported:
            with self.subTest(message=message), mock.patch.object(host, "select_hls_media", return_value=(playlist, "", None, None)), mock.patch.object(host, "run_ffmpeg") as run:
                with self.assertRaisesRegex(host.DownloadError, f"{message}.*0.2.5"):
                    host.hls_fast_download(playlist.url, target, {}, 1, threading.Event(), progress, "/ffmpeg")
            run.assert_not_called()

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
            with self.assertRaisesRegex(host.DownloadError, "yt-dlp 直接联网.*pinned broker"):
                host.youtube_download(
                    "https://video.example/watch?v=fixture",
                    target,
                    "mp4",
                    False,
                    threading.Event(),
                    progress,
                    "/fixture/yt-dlp",
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
            with self.assertRaises(host.DownloadError):
                host.commit_file(source, target)
            self.assertEqual(target.read_bytes(), b"old")
            self.assertEqual(source.read_bytes(), b"new")

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


if __name__ == "__main__":
    unittest.main()
