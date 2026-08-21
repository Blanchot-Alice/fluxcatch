from __future__ import annotations

import http.server
import importlib.util
import io
import json
import os
import pathlib
import shutil
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

        if path in {"/file.bin", "/bad-range.bin", "/range-no-id.bin"}:
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
            headers={"Authorization": "Bearer secret", "Cookie": "a=b", "Referer": "https://page.example/", "Accept": "*/*"},
        )
        redirected = host.SafeRedirectHandler().redirect_request(request, None, 302, "Found", {}, "https://two.example/file")
        self.assertIsNotNone(redirected)
        lowered = {key.lower(): value for key, value in redirected.headers.items()}
        self.assertNotIn("authorization", lowered)
        self.assertNotIn("cookie", lowered)
        self.assertNotIn("referer", lowered)
        self.assertEqual(lowered["accept"], "*/*")

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

    def test_hls_separate_audio_is_revalidated_for_drm(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "output.mp4"
            with self.assertRaisesRegex(host.DownloadError, "audio is metadata-only"):
                host.hls_fast_download(
                    f"{self.base}/separate-master.m3u8",
                    target,
                    {},
                    2,
                    threading.Event(),
                    host.Progress(lambda _event: None, "job", target.name),
                    sys.executable,
                )

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
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": directory}), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
            native = host.Host()
            try:
                with mock.patch.object(native, "send") as send:
                    native.handle({"type": "ping", "requestId": "probe"})
                message = send.call_args.args[0]
                self.assertEqual(message["requestId"], "probe")
                self.assertEqual(message["capabilities"]["ffmpeg"], capability.as_dict())
                self.assertEqual(message["capabilities"]["dashPlanner"], "static-v1")
                self.assertEqual(message["capabilities"]["dashPair"], "direct-v1")
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
            unrelated = root / "keep-this-directory"
            unrelated.mkdir()
            capability = host.FfmpegCapabilities(path="/fixture/ffmpeg")
            with mock.patch.dict(os.environ, {"FLUXCATCH_DOWNLOAD_DIR": str(root)}), mock.patch.object(host, "probe_ffmpeg", return_value=capability):
                native = host.Host()
                try:
                    self.assertFalse(crash_dir.exists(), "startup removes legacy signed-query crash artifacts")
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
        self.assertIn("does not provide the DASH demuxer", str(error))
        self.assertIn("built-in static DASH planner", str(error))

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
                "url": f"{self.base}/file.bin",
                "length": len(FILE_BYTES),
                "identity": '"fixture-v1"',
                "completed": [f"{start}-{end}"],
            }), "utf-8")
            progress = host.Progress(lambda _event: None, "job", target.name)
            host.multipart_download(f"{self.base}/file.bin", target, {}, 4, threading.Event(), progress)
            ranges = [value for path, value in FixtureHandler.request_log if path == "/file.bin"]
            self.assertNotIn(f"bytes={start}-{end}", ranges)
            self.assertEqual(target.read_bytes(), FILE_BYTES)

    def test_multipart_rejects_mismatched_content_range(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(host, "_retry_wait", return_value=None):
            target = pathlib.Path(directory) / "bad.bin"
            progress = host.Progress(lambda _event: None, "job", target.name)
            with self.assertRaisesRegex(host.DownloadError, "mismatched byte range"):
                host.multipart_download(f"{self.base}/bad-range.bin", target, {}, 2, threading.Event(), progress)
            self.assertFalse(target.exists())

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

    def test_hls_live_duration_and_audio_extraction_reach_ffmpeg(self):
        live = host.HlsPlaylist(url=f"{self.base}/live.m3u8", live=True, segments=[host.HlsSegment(f"{self.base}/seg0.ts")])
        target = pathlib.Path("capture.mp4")
        progress = host.Progress(lambda _event: None, "job", target.name)
        with mock.patch.object(host, "select_hls_media", return_value=(live, "", None, None)), mock.patch.object(host, "ffmpeg_download", return_value=target) as download:
            host.hls_fast_download(live.url, target, {}, 1, threading.Event(), progress, "/ffmpeg", live_duration=37)
            self.assertEqual(download.call_args.kwargs["duration"], 37)

        vod = host.HlsPlaylist(
            url=f"{self.base}/vod.m3u8",
            live=False,
            segments=[host.HlsSegment(f"{self.base}/seg0.ts", 80.5), host.HlsSegment(f"{self.base}/seg1.ts", 104.5)],
        )
        with mock.patch.object(host, "select_hls_media", return_value=(vod, "", None, None)), mock.patch.object(host, "ffmpeg_download", return_value=target) as download:
            host.hls_fast_download(vod.url, target.with_suffix(".mp3"), {}, 1, threading.Event(), progress, "/ffmpeg", extract_audio=True)
            self.assertEqual(download.call_count, 1)
            self.assertTrue(download.call_args.kwargs["extract_audio"])
            self.assertEqual(download.call_args.kwargs["expected_duration"], 185.0)

        master = host.HlsPlaylist(
            url=f"{self.base}/master.m3u8",
            audio_tracks=[{"GROUP-ID": "audio", "DEFAULT": "YES", "url": f"{self.base}/audio.m3u8"}],
        )
        selected = {"url": f"{self.base}/media.m3u8", "audio_group": "audio"}
        audio = host.HlsPlaylist(url=f"{self.base}/audio.m3u8", live=True, segments=[host.HlsSegment(f"{self.base}/seg0.ts")])
        with mock.patch.object(host, "select_hls_media", side_effect=[(live, "", master, selected), (audio, "", None, None)]), mock.patch.object(host, "ffmpeg_download", return_value=target) as download:
            host.hls_fast_download(master.url, target.with_suffix(".mp3"), {}, 1, threading.Event(), progress, "/ffmpeg", live_duration=22, extract_audio=True)
            self.assertEqual(download.call_args.args[0], f"{self.base}/audio.m3u8")
            self.assertTrue(download.call_args.kwargs["extract_audio"])
            self.assertEqual(download.call_args.kwargs["duration"], 22)
            self.assertEqual(download.call_args.kwargs["expected_duration"], 22.0)

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

    def test_hls_audio_extraction_is_one_ffmpeg_network_pass(self):
        target = pathlib.Path("capture.mp3")
        progress = host.Progress(lambda _event: None, "job", target.name)
        with mock.patch.object(host, "run_ffmpeg", return_value=target) as run:
            result = host.ffmpeg_download(
                "https://media.example/vod.m3u8",
                target,
                {"Cookie": "session=fixture", "User-Agent": "fixture"},
                threading.Event(),
                progress,
                "/fixture/ffmpeg",
                extract_audio=True,
                expected_duration=185,
            )
        self.assertEqual(result, target)
        args = run.call_args.args[0]
        self.assertEqual([args[index + 1] for index, value in enumerate(args[:-1]) if value == "-i"], ["https://media.example/vod.m3u8"])
        self.assertIn("Cookie: session=fixture\r\n", args)
        self.assertIn("-vn", args)
        self.assertIn("libmp3lame", args)
        self.assertEqual(run.call_args.kwargs["expected_duration"], 185)
        self.assertEqual(run.call_args.kwargs["activity"], "正在提取音频")
        self.assertFalse(run.call_args.kwargs["report_output_speed"])

    def test_ffmpeg_network_args_are_bounded_and_staging_is_atomic(self):
        network = host.ffmpeg_network_args({"Cookie": "a=b", "User-Agent": "UA", "X-Unsafe": "no"})
        whitelist = network[network.index("-protocol_whitelist") + 1].split(",")
        self.assertNotIn("file", whitelist)
        self.assertIn("http", whitelist)
        self.assertIn("Cookie: a=b\r\n", network)

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
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
            result = host.run_ffmpeg([sys.executable, str(script), str(target)], target, threading.Event(), progress)
            self.assertEqual(result.read_bytes(), b"finished")
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob(".*.part.mp4")), [])

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
            subprocess.run(["bash", str(install)], env=environment, check=True, capture_output=True, text=True)
            manifest_path = pathlib.Path(home) / "Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.blanchot_alice.fluxcatch.json"
            manifest = json.loads(manifest_path.read_text("utf-8"))
            self.assertEqual(manifest["name"], "io.github.blanchot_alice.fluxcatch")
            launcher = pathlib.Path(manifest["path"])
            launcher_text = launcher.read_text("utf-8")
            installed_host = pathlib.Path(home) / "Library/Application Support/FluxCatch/native-host/host.py"
            self.assertTrue(launcher.is_absolute())
            self.assertTrue(os.access(launcher, os.X_OK))
            self.assertTrue(installed_host.is_file())
            self.assertEqual(installed_host.read_bytes(), HOST_PATH.read_bytes())
            self.assertEqual(installed_host.stat().st_mode & 0o777, 0o700)
            self.assertIn(str(pathlib.Path(sys.executable).resolve()), launcher_text)
            self.assertIn(str(installed_host.resolve()), launcher_text)
            self.assertNotIn(str(HOST_PATH.resolve()), launcher_text)
            ffmpeg = shutil.which("ffmpeg")
            if ffmpeg:
                self.assertIn(f"FLUXCATCH_FFMPEG={pathlib.Path(ffmpeg).resolve()}", launcher_text)
            self.assertNotIn("/usr/bin/env python3", launcher_text)

            subprocess.run(["bash", str(uninstall)], env=environment, check=True, capture_output=True, text=True)
            self.assertFalse(manifest_path.exists())
            self.assertFalse(launcher.exists())
            self.assertFalse(installed_host.exists())


if __name__ == "__main__":
    unittest.main()
