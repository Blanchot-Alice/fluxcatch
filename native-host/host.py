#!/usr/bin/env python3
"""Havre native-messaging host.

Only JSON control messages traverse Native Messaging. Media bytes are fetched
and written by this process, avoiding Chrome's message-size and MV3 lifetime
limits. The host accepts HTTP(S) URLs observed by the extension and never runs
shell commands supplied by a page.
"""

from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import contextvars
import hashlib
import hmac
import http.client
import ipaddress
import json
import math
import os
import re
import selectors
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

_NATIVE_HOST_ROOT = str(Path(__file__).resolve().parent)
if _NATIVE_HOST_ROOT not in sys.path:
    sys.path.insert(0, _NATIVE_HOST_ROOT)

from havre_network_policy import (  # noqa: E402 - local host package
    NetworkPolicy,
    NetworkPolicyError,
    current_network_policy,
    redact_text,
    redact_url,
    reset_current_network_policy,
    set_current_network_policy,
)

VERSION = "0.3.0"
NATIVE_PROTOCOL_VERSION = 1
CAPABILITY_PROFILE_VERSION = 1
MAX_MESSAGE = 1024 * 1024
# Completion/file-action surface shared with the extension's download history.
COMPLETE_MESSAGE = "已保存到 Havre 文件夹"
HISTORY_THUMBNAIL_MAX_BYTES = 48_000
FILE_ACTION_TIMEOUT_SECONDS = 20.0
MEDIA_PROBE_TIMEOUT_SECONDS = 15.0
STALE_PARTIAL_TTL_SECONDS = 7 * 24 * 3600
OPEN_COMMAND = "/usr/bin/open"
OSASCRIPT_COMMAND = "/usr/bin/osascript"
LEGACY_ENV_PREFIX = "FLUXCATCH_"


def env_setting(name: str) -> str | None:
    """HAVRE_<name>, or the 0.2.5 FLUXCATCH_<name> for one release (design
    review v3.3 §2.2, A11), so a launcher written by the old installer still
    finds its FFmpeg until the user reinstalls."""
    value = os.environ.get(f"HAVRE_{name}")
    if value is None:
        value = os.environ.get(f"{LEGACY_ENV_PREFIX}{name}")
    return value


CONFIG_PATH = Path(env_setting("CONFIG") or (Path.home() / "Library" / "Application Support" / "Havre" / "config.json"))
# 0.2.5 kept its config under the old product name (v3.3 A2).
LEGACY_CONFIG_PATH = Path.home() / "Library" / "Application Support" / "FluxCatch" / "config.json"
MAX_KNOWN_DOWNLOAD_DIRS = 8
CHOOSE_FOLDER_TIMEOUT_SECONDS = 300
CHOOSE_FOLDER_PROMPT = "选择 Havre 的保存位置"
FILE_ACTIONS = frozenset({"reveal", "open", "open_folder", "trash", "stat"})
MAX_FILE_STAT_PATHS = 300
MAX_MANIFEST = 4 * 1024 * 1024
# Bounded manifest fetch: a stalled playlist connection gets one retry and
# then fails the job with a diagnosable timeout instead of hanging forever.
MANIFEST_FETCH_TIMEOUT_SECONDS = 20
ALLOWED_HEADERS = {"accept", "authorization", "cookie", "origin", "referer", "user-agent"}
USER_AGENT = f"Mozilla/5.0 Havre/{VERSION}"
SENSITIVE_REDIRECT_HEADERS = {"authorization", "cookie", "origin", "referer"}
CONDITIONAL_REDIRECT_HEADERS = {
    "if-range",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
}
FFMPEG_PROBE_TIMEOUT = 8
MAX_HLS_LINES = 20_000
MAX_HLS_VARIANTS = 512
MAX_HLS_MEDIA_TRACKS = 512
MAX_HLS_SEGMENTS = 10_000
MAX_HLS_KEYS = 256
MAX_MANIFEST_CHILDREN = 20_000
MAX_MANIFEST_URL_CHARS = 4 * 1024 * 1024
MAX_DASH_XML_ELEMENTS = 50_000
MAX_DASH_ADAPTATION_SETS = 128
MAX_DASH_REPRESENTATIONS = 256
MAX_DASH_SEGMENTS = 10_000
MAX_DASH_RESOURCES = 20_000
MAX_NATIVE_ADMITTED_JOBS = 16
DEFAULT_CONCURRENT_JOBS = 3
MAX_CONCURRENT_JOBS = 6
QUEUED_MESSAGE = "排队中，等待其他下载完成"
FFMPEG_MAX_THREADS = 4
FFMPEG_MAX_OUTPUT_BYTES = 512 * 1024 * 1024 * 1024
FFMPEG_MAX_WALL_SECONDS = 6 * 60 * 60
# External tools (yt-dlp) reach the network only through the loopback
# ExternalToolBroker; see that class for the policy it applies.
EXTERNAL_TOOL_BROKER_CAPABILITY = "broker-v1"
EXTERNAL_TOOL_MAX_WALL_SECONDS = 6 * 60 * 60
EXTERNAL_TOOL_INSPECT_TIMEOUT_SECONDS = 90
EXTERNAL_TOOL_MAX_INSPECT_BYTES = 24 * 1024 * 1024
EXTERNAL_TOOL_MAX_TUNNELS = 64
EXTERNAL_TOOL_BROKER_PORTS = frozenset({80, 443})
EXTERNAL_TOOL_TUNNEL_IDLE_SECONDS = 300
YTDLP_WORK_PREFIX = ".havre-ytdlp-"
YTDLP_MAX_HEIGHT = 8640
DASH_PAIR_WORK_PREFIX = ".havre-dash-pair-"
# Work directories 0.2.5 left in the download folder keep their names (v3.3
# A10): the stale sweep, the folder confinement and the pause-marker check
# recognise them for one release, so a job paused before the rename resumes.
LEGACY_TEMP_WORK_PREFIXES = (
    ".fluxcatch-dash-pair-",
    "fluxcatch-hls-",
    "fluxcatch-dash-",
    ".fluxcatch-convert-",
    ".fluxcatch-ytdlp-",
)
TEMP_WORK_PREFIXES = (
    DASH_PAIR_WORK_PREFIX,
    "havre-hls-",
    "havre-dash-",
    ".havre-convert-",
    YTDLP_WORK_PREFIX,
    *LEGACY_TEMP_WORK_PREFIXES,
)
DASH_PAIR_EXPIRY_SAFETY_SECONDS = 30.0


class JobControl(threading.Event):
    """Stop signal for one job. ``reason`` tells the transfer code whether the
    user cancelled (discard partial state) or paused (keep the checkpoint and
    the staged segments so a later job with the same output name resumes)."""

    def __init__(self) -> None:
        super().__init__()
        self.reason = "cancel"


def is_pause(cancel: threading.Event | None) -> bool:
    return getattr(cancel, "reason", "cancel") == "pause"


SEGMENT_CHECKPOINT_VERSION = 3
PAUSE_CAPABILITY = "resume-v1"
PAUSED_MESSAGE = "已暂停，可随时继续"


class Cancelled(Exception):
    pass


class DownloadError(Exception):
    pass


class HtmlMediaResponseError(DownloadError):
    """A media transfer was answered with an HTML page.

    Signed CDN URLs that expire, fail an IP binding, or trip hotlink
    protection are commonly redirected to the site's own page. Without this
    guard that page is written out as the media file and the job looks
    successful while the output cannot be opened.
    """


HTML_MEDIA_MESSAGE = "服务器返回了网页而非媒体文件（地址可能已过期或未通过校验），请刷新页面重新检测后再试"

HTML_MEDIA_TYPES = frozenset({"text/html", "application/xhtml+xml"})


def ensure_media_response_type(mime: str) -> None:
    if (mime or "").split(";", 1)[0].strip().lower() in HTML_MEDIA_TYPES:
        raise HtmlMediaResponseError(HTML_MEDIA_MESSAGE)


def looks_like_html_body(block: bytes) -> bool:
    head = bytes(block[:64]).lstrip()
    return head[:9].lower() == b"<!doctype" or head[:5].lower() == b"<html"


def staged_media_extension(url: str) -> str:
    """Suffix for a staged HLS segment copy; ffmpeg's hls demuxer gates staged
    local playlists by segment file extension, so copies keep their real one."""
    try:
        suffix = pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).suffix.lower()
    except Exception:
        return ".ts"
    return suffix if 1 <= len(suffix) <= 6 else ".ts"


def staged_segment_name(index: int, url: str) -> str:
    return f"{index:08d}{staged_media_extension(url)}"


STAGED_INIT_NAME = "-0000001.ts"


class NetworkPolicyDownloadError(DownloadError):
    """The requested target is outside the job's explicit network scope."""


class UnsupportedDashError(DownloadError):
    """The MPD is valid, but outside the deliberately small built-in planner."""


@dataclass
class FfmpegCapabilities:
    path: str = ""
    version: str = ""
    hls_demuxer: bool = False
    dash_demuxer: bool = False
    libmp3lame: bool = False
    probe_error: str = ""

    @property
    def available(self) -> bool:
        return bool(self.path)

    def as_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "localProcessing": self.available,
            "networkInput": False,
            "networkDisabled": True,
            "path": self.path,
            "version": self.version,
            "demuxers": {"hls": self.hls_demuxer, "dash": self.dash_demuxer},
            "encoders": {"libmp3lame": self.libmp3lame},
            "probeError": self.probe_error,
        }


def _ffmpeg_listing_names(text: str, capability: str) -> set[str]:
    """Parse ``ffmpeg -demuxers``/``-encoders`` without substring matches."""
    names: set[str] = set()
    marker = "D" if capability == "demuxer" else "A"
    for line in text.splitlines():
        match = re.match(r"^\s*([A-Z.]{1,8})\s+([^\s]+)", line)
        if not match or marker not in match.group(1):
            continue
        names.update(name.strip() for name in match.group(2).split(",") if name.strip())
    return names


def probe_ffmpeg(path: str | None = None) -> FfmpegCapabilities:
    """Probe the exact executable used by jobs once during host startup."""
    executable = path or shutil.which("ffmpeg")
    if not executable:
        return FfmpegCapabilities(probe_error="FFmpeg executable was not found on PATH")
    executable = str(Path(executable).expanduser().resolve())
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        return FfmpegCapabilities(probe_error=f"Configured FFmpeg executable is not runnable: {executable}")
    capability = FfmpegCapabilities(path=executable)
    try:
        version_result = subprocess.run(
            [executable, "-version"],
            capture_output=True,
            text=True,
            timeout=FFMPEG_PROBE_TIMEOUT,
            check=False,
        )
        version_text = "\n".join(part for part in (version_result.stdout, version_result.stderr) if part)
        first_line = next((line.strip() for line in version_text.splitlines() if line.strip()), "")
        capability.version = first_line.removeprefix("ffmpeg version ").split(" Copyright", 1)[0].strip()
        if version_result.returncode != 0:
            raise DownloadError(first_line or f"version probe exited {version_result.returncode}")

        demuxer_result = subprocess.run(
            [executable, "-hide_banner", "-demuxers"],
            capture_output=True,
            text=True,
            timeout=FFMPEG_PROBE_TIMEOUT,
            check=False,
        )
        demuxer_text = "\n".join(part for part in (demuxer_result.stdout, demuxer_result.stderr) if part)
        if demuxer_result.returncode != 0:
            raise DownloadError(f"demuxer probe exited {demuxer_result.returncode}")
        demuxers = _ffmpeg_listing_names(demuxer_text, "demuxer")
        capability.hls_demuxer = "hls" in demuxers or "applehttp" in demuxers
        capability.dash_demuxer = "dash" in demuxers

        encoder_result = subprocess.run(
            [executable, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=FFMPEG_PROBE_TIMEOUT,
            check=False,
        )
        encoder_text = "\n".join(part for part in (encoder_result.stdout, encoder_result.stderr) if part)
        if encoder_result.returncode != 0:
            raise DownloadError(f"encoder probe exited {encoder_result.returncode}")
        capability.libmp3lame = "libmp3lame" in _ffmpeg_listing_names(encoder_text, "encoder")
    except (OSError, subprocess.SubprocessError, DownloadError) as error:
        capability.probe_error = str(error)
    return capability


@dataclass
class YtDlpCapabilities:
    path: str = ""
    version: str = ""
    probe_error: str = ""

    @property
    def installed(self) -> bool:
        return bool(self.path)

    @property
    def available(self) -> bool:
        # yt-dlp is usable once an executable answered the version probe. Its
        # connections never leave the machine directly: every job hands it the
        # loopback ExternalToolBroker, which resolves, policy-checks and pins
        # each CONNECT target exactly like the native HTTP client.
        return self.installed and bool(self.version) and not self.probe_error

    def as_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "installed": self.installed,
            "networkDisabled": not self.available,
            "broker": EXTERNAL_TOOL_BROKER_CAPABILITY,
            "path": self.path,
            "version": self.version,
            "probeError": self.probe_error,
        }


def probe_ytdlp(path: str | None = None) -> YtDlpCapabilities:
    """Report whether a usable yt-dlp is installed on this Mac.

    Havre does not bundle yt-dlp: YouTube changes faster than Havre
    releases, and a bundled copy would pin users to a stale extractor. The
    engine looks for an installed copy instead. HAVRE_YTDLP pins an
    explicit executable; otherwise PATH plus the Homebrew/pip install
    locations are probed on every ping, so installing or upgrading yt-dlp
    takes effect at the next "Retry" without reinstalling the engine.
    """
    candidates: list[str] = []
    if path:
        candidates.append(path)
    candidates.extend(["yt-dlp", "ytdlp"])
    candidates.extend([
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
        str(Path.home() / ".local/bin/yt-dlp"),
        str(Path.home() / "bin/yt-dlp"),
    ])
    executable = ""
    for candidate in candidates:
        found = shutil.which(candidate) if os.path.sep not in candidate else None
        if not found:
            resolved = str(Path(candidate).expanduser())
            if Path(resolved).is_file() and os.access(resolved, os.X_OK):
                found = resolved
        if found:
            executable = str(Path(found).resolve())
            break
    if not executable:
        return YtDlpCapabilities(probe_error="yt-dlp was not found; install it with Homebrew or pip")
    capability = YtDlpCapabilities(path=executable)
    try:
        version_result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=FFMPEG_PROBE_TIMEOUT,
            check=False,
        )
        version_text = (version_result.stdout or "").strip()
        first_line = next((line.strip() for line in version_text.splitlines() if line.strip()), "")
        if version_result.returncode != 0 or not first_line:
            raise DownloadError(first_line or f"version probe exited {version_result.returncode}")
        capability.version = first_line
    except (OSError, subprocess.SubprocessError, DownloadError) as error:
        capability.probe_error = str(error)
    return capability


def valid_url(value: Any) -> str:
    url = str(value or "")
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in url):
        raise DownloadError("URL contains control characters")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise DownloadError("Only credential-free HTTP(S) URLs are accepted")
    if len(url) > 16_384:
        raise DownloadError("URL is too long")
    return url


def clean_headers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, str] = {}
    total = 0
    for raw_key, raw_value in value.items():
        key = str(raw_key).strip().lower()
        text = str(raw_value)
        if key not in ALLOWED_HEADERS or "\r" in text or "\n" in text:
            continue
        text = text[:16_384]
        total += len(key) + len(text)
        if total > 64 * 1024:
            break
        result[key] = text
    result.setdefault("user-agent", USER_AGENT)
    return result


def safe_filename(value: Any, fallback: str = "media") -> str:
    name = str(value or fallback).strip()
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name or name in {".", ".."}:
        name = fallback
    stem, ext = os.path.splitext(name)
    if re.fullmatch(r"CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]", stem, re.I):
        name = f"_{name}"
    # Most filesystems cap one path component at 255 bytes, not characters.
    # Leave room for conflict suffixes and Unicode normalization expansion.
    if len(name.encode("utf-8")) > 200:
        stem, ext = os.path.splitext(name)
        encoded_ext = ext.encode("utf-8")[:32]
        ext = encoded_ext.decode("utf-8", "ignore")
        budget = max(1, 200 - len(ext.encode("utf-8")))
        stem = stem.encode("utf-8")[:budget].decode("utf-8", "ignore").rstrip(" .") or fallback
        name = f"{stem}{ext}"
    return name


def dash_pair_expires_at(value: Any) -> float:
    """Normalize an optional Unix timestamp supplied as seconds or JS ms."""
    if value is None or value == "":
        return 0.0
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise DownloadError("DASH pair expiresAt is invalid") from error
    if not math.isfinite(result) or result <= 0:
        raise DownloadError("DASH pair expiresAt is invalid")
    if result > 10_000_000_000:
        result /= 1000.0
    return result


def ensure_dash_pair_fresh(expires_at: float, phase: str) -> None:
    if not expires_at:
        return
    remaining = expires_at - time.time()
    if remaining <= 0:
        raise DownloadError(f"DASH {phase}前签名链接已过期，请刷新页面后重试")
    if remaining <= DASH_PAIR_EXPIRY_SAFETY_SECONDS:
        raise DownloadError(f"DASH {phase}前签名链接即将过期，请刷新页面后重试")


_STAGING_FILE_NAME = re.compile(r"^\..+\.[0-9a-f]{32}\.part(?:\.[A-Za-z0-9]{1,8})?$")


def is_stale_partial_name(name: str) -> bool:
    """Names the host itself creates for unfinished output in the download folder."""
    return name.endswith((".part", ".part.json")) or bool(_STAGING_FILE_NAME.match(name))


def cleanup_stale_workdirs(directory: Path, *, now: float | None = None) -> None:
    """Remove private crash remnants for every native temporary-work class.

    Work directories are always safe to drop at startup because no job is
    running yet. Partial files are kept for a week so a resumable direct
    download can still pick up its checkpoint, then collected so the user's
    folder does not silently accumulate ``.part`` leftovers after a crash.
    """
    try:
        entries = list(directory.iterdir())
    except OSError:
        return
    clock = time.time() if now is None else now
    keep_dirs = _paused_work_dirs(entries, clock)
    for entry in entries:
        try:
            metadata = entry.lstat()
        except OSError:
            continue
        if stat.S_ISLNK(metadata.st_mode):
            continue
        if hasattr(metadata, "st_uid") and hasattr(os, "getuid") and metadata.st_uid != os.getuid():
            continue
        if entry.name.startswith(TEMP_WORK_PREFIXES):
            # Staged segments of a paused job stay until their pause marker
            # expires with the same one-week budget as direct checkpoints.
            if stat.S_ISDIR(metadata.st_mode) and entry.name not in keep_dirs:
                shutil.rmtree(entry, ignore_errors=True)
            continue
        if (
            stat.S_ISREG(metadata.st_mode)
            and entry.name.endswith(".part.json")
            and clock - metadata.st_mtime >= STALE_PARTIAL_TTL_SECONDS
            and load_segment_checkpoint(entry) is not None
        ):
            placeholder = entry.with_name(entry.name[: -len(".json")])
            with contextlib.suppress(OSError):
                entry.unlink()
            with contextlib.suppress(OSError):
                if placeholder.is_file() and not placeholder.is_symlink() and placeholder.stat().st_size == 0:
                    placeholder.unlink()
            continue
        if not stat.S_ISREG(metadata.st_mode) or not is_stale_partial_name(entry.name):
            continue
        if clock - metadata.st_mtime < STALE_PARTIAL_TTL_SECONDS:
            continue
        with contextlib.suppress(OSError):
            entry.unlink()


def _paused_work_dirs(entries: list[Path], clock: float) -> set[str]:
    """Staged-segment directories that a fresh pause marker still references."""
    keep: set[str] = set()
    for entry in entries:
        if not entry.name.endswith(".part.json"):
            continue
        try:
            metadata = entry.lstat()
        except OSError:
            continue
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            continue
        if clock - metadata.st_mtime >= STALE_PARTIAL_TTL_SECONDS:
            continue
        marker = load_segment_checkpoint(entry)
        if marker:
            keep.add(marker["workDir"])
    return keep


def cleanup_dash_pair_workdirs(directory: Path) -> None:
    """Backward-compatible entry point for older callers and installations."""
    cleanup_stale_workdirs(directory)


def unique_path(
    directory: Path,
    filename: str,
    *,
    allow_checkpoint: bool = False,
    reserved: set[Path] | None = None,
) -> Path:
    """Select a non-existing output path.

    A validated multipart checkpoint may deliberately reuse the base name.
    ``reserved`` is owned by :class:`Host` and closes the in-process TOCTOU
    window between selection and creation.
    """

    def available(candidate: Path) -> bool:
        if reserved is not None and candidate in reserved:
            return False
        if candidate.exists() or candidate.is_symlink():
            return False
        part = candidate.with_suffix(candidate.suffix + ".part")
        if not part.exists() and not part.is_symlink():
            return True
        checkpoint = candidate.with_suffix(candidate.suffix + ".part.json")
        return (
            allow_checkpoint
            and part.is_file()
            and not part.is_symlink()
            and checkpoint.is_file()
            and not checkpoint.is_symlink()
        )

    target = directory / safe_filename(filename)
    if available(target):
        return target
    stem, suffix = target.stem, target.suffix
    for number in range(1, 10_000):
        candidate = directory / f"{stem} ({number}){suffix}"
        if available(candidate):
            return candidate
    raise DownloadError("Could not allocate an output filename")


def _same_origin(first: str, second: str) -> bool:
    def origin(url: str) -> tuple[str, str, int | None]:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme.lower() == "https" else 80
        return parsed.scheme.lower(), (parsed.hostname or "").lower(), port

    try:
        return origin(first) == origin(second)
    except ValueError:
        return False


def scope_subresource_headers(parent_url: str, child_urls: Iterable[str], headers: dict[str, str]) -> dict[str, str]:
    """Never send page credentials to an origin introduced by a manifest."""
    cleaned = clean_headers(headers)
    if all(_same_origin(parent_url, child_url) for child_url in child_urls):
        return cleaned
    return {key: value for key, value in cleaned.items() if key not in SENSITIVE_REDIRECT_HEADERS}


def dash_pair_headers(
    video_url: str,
    audio_url: str,
    common_headers: Any,
    video_headers: Any = None,
    audio_headers: Any = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """Build two isolated header scopes for direct DASH video/audio tracks.

    A captured Cookie is unnecessary for the signed direct-resource URLs used
    by this mode and is deliberately excluded. Explicit per-track headers are
    never mixed. When an older sender supplies only the video/common scope, a
    same-origin audio URL may reuse it; a cross-origin audio URL receives only
    non-sensitive headers.
    """

    def cleaned(value: Any) -> dict[str, str]:
        result = clean_headers(value)
        result.pop("cookie", None)
        return result

    fallback = cleaned(common_headers)
    video = cleaned(video_headers) if isinstance(video_headers, dict) else fallback
    if isinstance(audio_headers, dict):
        audio = cleaned(audio_headers)
    else:
        audio = scope_subresource_headers(video_url, [audio_url], video)
        audio.pop("cookie", None)
    return video, audio


_ACTIVE_AUTHORIZED_TARGET: contextvars.ContextVar[Any | None] = contextvars.ContextVar(
    "havre_active_authorized_target",
    default=None,
)
_ACTIVE_REQUEST_HEADERS: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
    "havre_active_request_headers",
    default=None,
)
_ACTIVE_VIA_SYSTEM_PROXY: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "havre_active_via_system_proxy",
    default=False,
)


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Re-authorize every redirect and isolate captured credentials."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001 - urllib hook
        policy = current_network_policy()
        source = _ACTIVE_AUTHORIZED_TARGET.get()
        if source is None or source.url != req.full_url:
            source = policy.authorize(req.full_url, purpose="redirect source")
        _validate_connected_response(fp, policy, source)
        source_scheme = urllib.parse.urlsplit(req.full_url).scheme.lower()
        target_scheme = urllib.parse.urlsplit(newurl).scheme.lower()
        if source_scheme == "https" and target_scheme != "https":
            raise NetworkPolicyError("HTTPS redirects may not downgrade transport security")
        redirect_target = policy.authorize(newurl, purpose="redirect target")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and not _same_origin(req.full_url, newurl):
            for key in list(redirected.headers):
                if key.lower() in SENSITIVE_REDIRECT_HEADERS | CONDITIONAL_REDIRECT_HEADERS:
                    redirected.remove_header(key)
            effective_headers = _ACTIVE_REQUEST_HEADERS.get()
            if effective_headers is not None:
                # Header authority is monotonic within a redirect chain.  In
                # particular, A -> B -> A must not restore credentials merely
                # because the final origin matches the first one again.
                _ACTIVE_REQUEST_HEADERS.set({
                    key: value
                    for key, value in effective_headers.items()
                    if key not in SENSITIVE_REDIRECT_HEADERS
                })
        if redirected is not None:
            if redirected.full_url != redirect_target.url:
                redirect_target = policy.authorize(redirected.full_url, purpose="redirect target")
            _ACTIVE_AUTHORIZED_TARGET.set(redirect_target)
        return redirected


def _create_pinned_connection(
    requested_address: tuple[str, int],
    timeout: float | object = socket._GLOBAL_DEFAULT_TIMEOUT,
    source_address: tuple[str, int] | None = None,
):
    """Connect only to an IP already authorized for the active request.

    Passing a numeric address to ``socket.create_connection`` prevents a
    second attacker-controlled DNS lookup between policy evaluation and the
    TCP handshake.  HTTPS still uses the original hostname for SNI below.
    """
    target = _ACTIVE_AUTHORIZED_TARGET.get()
    if target is None:
        raise OSError("No authorized network target is active")
    if _ACTIVE_VIA_SYSTEM_PROXY.get():
        # The dial terminates at the locally trusted system proxy (its address
        # was already gated by _target_bypasses_proxy), and authorization plus
        # DNS resolution ran before opener dispatch. Peer pinning cannot apply
        # across the CONNECT tunnel; TLS still fully verifies the origin
        # certificate chain against the authorized hostname.
        return socket.create_connection(requested_address, timeout, source_address)
    requested_host = str(requested_address[0]).strip("[]").rstrip(".").lower()
    if requested_host != target.hostname or int(requested_address[1]) != target.port:
        raise OSError("HTTP connection target did not match the authorized network target")
    policy = current_network_policy()
    for address in sorted(target.addresses):
        connection = None
        try:
            connection = socket.create_connection(
                (address, target.port),
                timeout,
                source_address,
            )
            policy.validate_peer(connection.getpeername()[0], target)
            return connection
        except (OSError, NetworkPolicyError):
            if connection is not None:
                connection.close()
    raise OSError(f"Could not connect to authorized network target {target.hostname}")


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = _create_pinned_connection


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = _create_pinned_connection


class PinnedHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):  # noqa: ANN001 - urllib hook
        return self.do_open(PinnedHTTPConnection, req)


class PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):  # noqa: ANN001 - urllib hook
        return self.do_open(PinnedHTTPSConnection, req, context=self._context)


_PROXY_HANDLER_CHAIN: tuple[Any, ...] = (
    SafeRedirectHandler(),
    PinnedHTTPHandler(),
    PinnedHTTPSHandler(),
)


def _system_proxies() -> dict[str, str]:
    """Best-effort HTTP(S) proxies from the OS network configuration."""
    if env_setting("DISABLE_SYSTEM_PROXY") == "1":
        return {}
    try:
        discovered = urllib.request.getproxies()
    except Exception:  # noqa: BLE001 - proxy discovery must never be fatal
        return {}
    return {scheme: url for scheme, url in discovered.items() if scheme in {"http", "https"}}


def _target_bypasses_proxy(host: str | None) -> bool:
    """Loopback, private and local targets always connect directly."""
    if not host:
        return True
    lowered = host.strip("[]").lower()
    if lowered == "localhost" or lowered.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(lowered)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


HTTP_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    *_PROXY_HANDLER_CHAIN,
)
# The OS proxy configuration is re-read per request (with a short cache) so
# toggling a system proxy, switching Clash profiles, or turning it off entirely
# takes effect within seconds — never requiring a Chrome restart. Without this
# the opener captured at startup kept dialing a dead local proxy port.
_SYSTEM_PROXY_REFRESH_SECONDS = 5.0
_system_proxy_lock = threading.Lock()
_system_proxy_cache: dict[str, Any] = {"at": None, "opener": None}


def _system_proxy_opener() -> urllib.request.OpenerDirector | None:
    now = time.monotonic()
    cached_at = _system_proxy_cache["at"]
    if cached_at is not None and now - cached_at < _SYSTEM_PROXY_REFRESH_SECONDS:
        return _system_proxy_cache["opener"]
    with _system_proxy_lock:
        cached_at = _system_proxy_cache["at"]
        if cached_at is not None and time.monotonic() - cached_at < _SYSTEM_PROXY_REFRESH_SECONDS:
            return _system_proxy_cache["opener"]
        proxies = _system_proxies()
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler(proxies),
            *_PROXY_HANDLER_CHAIN,
        ) if proxies else None
        _system_proxy_cache["at"] = time.monotonic()
        _system_proxy_cache["opener"] = opener
        return opener


def reset_system_proxy_cache() -> None:
    """Test hook: forget the cached opener so the next request re-reads the OS."""
    with _system_proxy_lock:
        _system_proxy_cache["at"] = None
        _system_proxy_cache["opener"] = None


def _response_peer_address(response: Any) -> str | None:
    """Best-effort extraction of urllib's connected peer for DNS pinning."""
    candidates = [
        # ``urllib`` wraps non-2xx responses in ``HTTPError``. Its ``fp`` is an
        # ``HTTPResponse``, whose own ``fp`` owns the buffered socket. Some
        # media CDNs reject HEAD while accepting Range GET; retain peer
        # validation for that expected error response so the caller can fall
        # back to the GET probe instead of misclassifying it as a policy error.
        getattr(getattr(getattr(getattr(response, "fp", None), "fp", None), "raw", None), "_sock", None),
        getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None),
        getattr(getattr(response, "fp", None), "_sock", None),
        getattr(getattr(response, "raw", None), "_sock", None),
        getattr(response, "_sock", None),
    ]
    for candidate in candidates:
        if candidate is None or not hasattr(candidate, "getpeername"):
            continue
        try:
            peer = candidate.getpeername()
        except OSError:
            continue
        if isinstance(peer, tuple) and peer:
            return str(peer[0])
    return None


def _validate_connected_response(response: Any, policy: NetworkPolicy, target: Any) -> None:
    if _ACTIVE_VIA_SYSTEM_PROXY.get():
        # The system proxy terminates the TCP connection locally (CONNECT
        # tunnel), so raw peer pinning cannot apply across it. TLS chain and
        # hostname identity stay fully verified by the pinned TLS handler.
        return
    peer = _response_peer_address(response)
    if peer is None:
        raise NetworkPolicyError(f"Could not verify the connected peer for {target.hostname}")
    policy.validate_peer(peer, target)


def request(url: str, headers: dict[str, str], *, method: str = "GET", timeout: float = 30, extra: dict[str, str] | None = None):
    reusable_headers = clean_headers(headers)
    merged = {**reusable_headers, **(extra or {})}
    safe_url = valid_url(url)
    policy = current_network_policy()
    response = None
    target_token = None
    headers_token = None
    proxy_token = None
    try:
        initial_target = policy.authorize(safe_url, purpose="HTTP request")
        target_token = _ACTIVE_AUTHORIZED_TARGET.set(initial_target)
        headers_token = _ACTIVE_REQUEST_HEADERS.set(dict(reusable_headers))
        req = urllib.request.Request(safe_url, headers=merged, method=method)
        system_proxy_opener = _system_proxy_opener()
        use_system_proxy = system_proxy_opener is not None and not _target_bypasses_proxy(
            urllib.parse.urlsplit(safe_url).hostname
        )
        opener = system_proxy_opener if use_system_proxy else HTTP_OPENER
        proxy_token = _ACTIVE_VIA_SYSTEM_PROXY.set(use_system_proxy)
        response = opener.open(req, timeout=timeout)
        final_url = valid_url(response.geturl())
        final_target = _ACTIVE_AUTHORIZED_TARGET.get()
        if final_target is None or final_target.url != final_url:
            raise NetworkPolicyError("HTTP response target did not match the authorized request")
        _validate_connected_response(response, policy, final_target)
        # Keep only reusable, allow-listed request headers.  Per-request
        # controls such as Range must not flow from a manifest into children.
        response._havre_request_headers = dict(_ACTIVE_REQUEST_HEADERS.get() or {})
        return response
    except NetworkPolicyError as error:
        if response is not None:
            response.close()
        raise NetworkPolicyDownloadError(redact_text(error)) from error
    except urllib.error.HTTPError as error:
        try:
            error_target = _ACTIVE_AUTHORIZED_TARGET.get()
            if error_target is None or error_target.url != valid_url(error.geturl()):
                raise NetworkPolicyError("HTTP error target did not match the authorized request")
            _validate_connected_response(error, policy, error_target)
        except NetworkPolicyError as policy_error:
            error.close()
            raise NetworkPolicyDownloadError(redact_text(policy_error)) from policy_error
        code = error.code
        error.close()
        raise DownloadError(f"HTTP {code} for {redact_url(safe_url)}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        reason = getattr(error, "reason", error)
        raise DownloadError(f"Network request failed for {redact_url(safe_url)}: {redact_text(reason)}") from error
    finally:
        if headers_token is not None:
            _ACTIVE_REQUEST_HEADERS.reset(headers_token)
        if target_token is not None:
            _ACTIVE_AUTHORIZED_TARGET.reset(target_token)
        if proxy_token is not None:
            _ACTIVE_VIA_SYSTEM_PROXY.reset(proxy_token)


def authorize_network_urls(values: Iterable[str], *, purpose: str) -> None:
    """Validate bounded manifest children, resolving each network origin once."""
    try:
        policy = current_network_policy()
        seen_origins: set[tuple[str, str, int]] = set()
        total = 0
        url_chars = 0
        for value in values:
            total += 1
            if total > MAX_MANIFEST_CHILDREN:
                raise NetworkPolicyError("Manifest exceeds the child resource limit")
            safe = valid_url(value)
            url_chars += len(safe)
            if url_chars > MAX_MANIFEST_URL_CHARS:
                raise NetworkPolicyError("Manifest child URLs exceed the configured limit")
            parsed = urllib.parse.urlsplit(safe)
            port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
            origin = (parsed.scheme.lower(), (parsed.hostname or "").lower(), port)
            if origin in seen_origins:
                continue
            seen_origins.add(origin)
            policy.authorize(safe, purpose=purpose)
    except NetworkPolicyError as error:
        raise NetworkPolicyDownloadError(redact_text(error)) from error


def _submit_with_context(pool: concurrent.futures.Executor, function: Callable[..., Any], *args: Any):
    """Propagate the per-job NetworkPolicy into bounded worker pools."""
    context = contextvars.copy_context()
    return pool.submit(context.run, function, *args)


def _bounded_executor_results(
    pool: concurrent.futures.Executor,
    function: Callable[..., Any],
    arguments: Iterable[tuple[Any, ...]],
    *,
    max_pending: int,
) -> Iterable[Any]:
    """Yield results while keeping only a fixed-size Future admission window."""
    iterator = iter(arguments)
    pending: set[concurrent.futures.Future[Any]] = set()
    limit = max(1, max_pending)

    def fill() -> None:
        while len(pending) < limit:
            try:
                args = next(iterator)
            except StopIteration:
                return
            pending.add(_submit_with_context(pool, function, *args))

    fill()
    try:
        while pending:
            completed, pending_now = concurrent.futures.wait(
                pending,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
            pending = set(pending_now)
            for future in completed:
                yield future.result()
            fill()
    except Exception:
        for future in pending:
            future.cancel()
        raise


def read_limited(response, maximum: int) -> bytes:
    data = response.read(maximum + 1)
    if len(data) > maximum:
        raise DownloadError("Response exceeds the configured limit")
    return data


def _content_length(headers: Any) -> int:
    raw = headers.get("Content-Length") or ""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 0
    return value if value >= 0 else 0


def parse_content_range(value: str) -> tuple[int, int, int | None] | None:
    match = re.fullmatch(r"\s*bytes\s+(\d+)-(\d+)/(\d+|\*)\s*", value or "", re.I)
    if not match:
        return None
    start, end = int(match.group(1)), int(match.group(2))
    total = None if match.group(3) == "*" else int(match.group(3))
    if end < start or (total is not None and (total <= end or total <= 0)):
        return None
    return start, end, total


def validate_range_response(response: Any, start: int, end: int, total: int | None = None) -> None:
    parsed = parse_content_range(response.headers.get("Content-Range") or "")
    if response.status != 206 or parsed is None:
        raise DownloadError("Server stopped honoring range requests")
    actual_start, actual_end, actual_total = parsed
    if actual_start != start or actual_end != end or (total is not None and actual_total != total):
        raise DownloadError("Server returned a mismatched byte range")
    expected = end - start + 1
    content_length = _content_length(response.headers)
    if content_length and content_length != expected:
        raise DownloadError("Range Content-Length mismatch")


def _open_private(path: Path, *, truncate: bool = False) -> int:
    flags = os.O_CREAT | os.O_RDWR
    if truncate:
        flags |= os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise DownloadError("Temporary output is not a regular file")
        os.fchmod(fd, 0o600)
        return fd
    except Exception:
        os.close(fd)
        raise


def _write_all(fd: int, data: bytes, offset: int, lock: threading.Lock) -> None:
    view = memoryview(data)
    written = 0
    while written < len(view):
        if hasattr(os, "pwrite"):
            amount = os.pwrite(fd, view[written:], offset + written)
        else:
            with lock:
                os.lseek(fd, offset + written, os.SEEK_SET)
                amount = os.write(fd, view[written:])
        if amount <= 0:
            raise DownloadError("Temporary file write ended early")
        written += amount


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def commit_file(source: Path, target: Path) -> Path:
    """Publish a completed file without overwriting a late-arriving target.

    If the reserved name became occupied while the transfer ran (a second job,
    the user dropping a file in, Finder), the output is published under the
    next free name instead of discarding the finished bytes. Callers always
    use the returned path.
    """
    if target.exists() or target.is_symlink():
        target = unique_path(target.parent, target.name)
    try:
        os.link(source, target, follow_symlinks=False)
    except FileExistsError:
        target = unique_path(target.parent, target.name)
        try:
            os.link(source, target, follow_symlinks=False)
        except OSError as error:
            raise DownloadError("Output filename became occupied") from error
    except (NotImplementedError, OSError) as error:
        # Source and target are created in the same directory, so a hard-link
        # failure is unexpected and falling back to replacing could lose data.
        raise DownloadError(f"Could not publish output safely: {error}") from error
    source.unlink()
    return target


def default_download_dir() -> Path:
    """~/Downloads/Havre for a new install. An install that saved into
    ~/Downloads/FluxCatch and never chose a folder keeps using it, so nothing
    moves under the user (v3.3 A15)."""
    home = Path.home()
    current = home / "Downloads" / "Havre"
    legacy = home / "Downloads" / "FluxCatch"
    if legacy.is_dir() and not legacy.is_symlink() and not current.exists():
        return legacy
    return current


def load_host_config(path: Path = CONFIG_PATH, legacy_path: Path | None = None) -> dict[str, Any]:
    """The host's own small config: the chosen save folder and the folders
    that were chosen before (so files saved there stay openable). A config
    written by 0.2.5 under the old product name is copied over once when
    the new file is missing; the old file stays for the old uninstaller
    (v3.3 A2)."""
    if legacy_path is None and path == CONFIG_PATH:
        legacy_path = LEGACY_CONFIG_PATH
    if legacy_path is not None and not path.exists() and legacy_path.is_file() and not legacy_path.is_symlink():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy_path, path)
        except OSError:
            pass
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024:
            return {}
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError, UnicodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_host_config(config: dict[str, Any], path: Path = CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, config)


def validate_download_dir(value: Any) -> Path:
    """A save folder must be an absolute, existing or creatable, writable
    directory that is not a symlink and not one of the engine's work dirs."""
    raw = value if isinstance(value, str) else ""
    if not raw or len(raw) > 2048 or "\x00" in raw:
        raise DownloadError("Folder path is invalid")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        raise DownloadError("Folder path must be absolute")
    if candidate.is_symlink():
        raise DownloadError("Symlinked folders are not accepted")
    if candidate.name.startswith(TEMP_WORK_PREFIXES):
        raise DownloadError("Folder path is reserved")
    if candidate.exists() and not candidate.is_dir():
        raise DownloadError("Folder path is not a directory")
    candidate.mkdir(parents=True, exist_ok=True)
    if not os.access(candidate, os.W_OK | os.X_OK):
        raise DownloadError("Folder is not writable")
    return candidate.resolve()


def resolve_download_dir(config: dict[str, Any] | None = None) -> Path:
    """Precedence: HAVRE_DOWNLOAD_DIR (tests, harnesses) > the folder the
    user chose > ~/Downloads/Havre."""
    configured = env_setting("DOWNLOAD_DIR")
    if configured:
        directory = Path(configured).expanduser()
        directory.mkdir(parents=True, exist_ok=True)
        return directory
    chosen = (config or {}).get("downloadDir")
    if isinstance(chosen, str) and chosen:
        try:
            return validate_download_dir(chosen)
        except DownloadError:
            pass
    directory = default_download_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def known_download_dirs(config: dict[str, Any] | None) -> list[Path]:
    dirs: list[Path] = []
    for value in (config or {}).get("knownDownloadDirs") or []:
        if not isinstance(value, str) or not value.startswith("/"):
            continue
        path = Path(value)
        if path.is_dir() and not path.is_symlink() and path not in dirs:
            dirs.append(path)
    return dirs[:MAX_KNOWN_DOWNLOAD_DIRS]


def choose_folder_dialog(current: Path) -> Path | None:
    """macOS folder picker through AppleScript; None when the user cancels."""
    script = (
        'POSIX path of (choose folder with prompt "%s" default location (POSIX file "%s"))'
        % (CHOOSE_FOLDER_PROMPT, str(current).replace("\\", "\\\\").replace('"', '\\"'))
    )
    try:
        completed = subprocess.run(
            [OSASCRIPT_COMMAND, "-e", script],
            capture_output=True,
            text=True,
            timeout=CHOOSE_FOLDER_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise DownloadError("Folder dialog failed") from error
    if completed.returncode != 0:
        if "-128" in (completed.stderr or ""):
            return None
        raise DownloadError("Folder dialog failed")
    chosen = (completed.stdout or "").strip()
    return Path(chosen) if chosen else None


def move_to_trash(path: Path) -> Path:
    """Move a published file into the user's Trash; bytes are never deleted."""
    trash = Path.home() / ".Trash"
    try:
        trash.mkdir(mode=0o700, exist_ok=True)
    except OSError as error:
        raise DownloadError("Trash folder is unavailable") from error
    destination = trash / path.name
    counter = 1
    while destination.exists() or destination.is_symlink():
        destination = trash / f"{path.stem} {time.strftime('%H.%M.%S')}-{counter}{path.suffix}"
        counter += 1
        if counter > 10_000:
            raise DownloadError("Could not allocate a Trash filename")
    try:
        os.rename(path, destination)
    except OSError:
        shutil.move(str(path), str(destination))
    return destination


def run_opener(args: list[str]) -> None:
    """Hand a managed path to macOS; the argument list is never page-derived."""
    try:
        completed = subprocess.run(args, capture_output=True, timeout=FILE_ACTION_TIMEOUT_SECONDS, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise DownloadError("Could not hand the file to macOS") from error
    if completed.returncode != 0:
        raise DownloadError("macOS could not open the file")


def _retry_wait(cancel: threading.Event, delay: float, abort: threading.Event | None = None) -> None:
    deadline = time.monotonic() + delay
    while True:
        if cancel.is_set():
            raise Cancelled()
        if abort is not None and abort.is_set():
            raise DownloadError("Download aborted after another transfer failed")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        cancel.wait(min(0.1, remaining))


@dataclass
class Probe:
    length: int = 0
    range_supported: bool = False
    etag: str = ""
    last_modified: str = ""
    mime: str = ""
    final_url: str = ""


def probe_direct(url: str, headers: dict[str, str]) -> Probe:
    head = None
    try:
        head = request(url, headers, method="HEAD", timeout=20)
        info = Probe(
            length=_content_length(head.headers),
            range_supported="bytes" in (head.headers.get("Accept-Ranges") or "").lower(),
            etag=head.headers.get("ETag") or "",
            last_modified=head.headers.get("Last-Modified") or "",
            mime=(head.headers.get("Content-Type") or "").split(";", 1)[0].lower(),
            final_url=head.geturl(),
        )
    except NetworkPolicyDownloadError:
        raise
    except (DownloadError, urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        info = Probe()
    finally:
        if head is not None:
            head.close()

    # Verify Range instead of trusting Accept-Ranges. This also recovers length
    # when a server rejects HEAD.
    response = None
    try:
        response = request(url, headers, timeout=20, extra={"Range": "bytes=0-0"})
        parsed_range = parse_content_range(response.headers.get("Content-Range") or "")
        info.range_supported = response.status == 206 and parsed_range is not None and parsed_range[:2] == (0, 0) and parsed_range[2] is not None
        if info.range_supported and parsed_range is not None:
            info.length = parsed_range[2] or 0
        elif not info.length:
            info.length = _content_length(response.headers)
        info.etag = response.headers.get("ETag") or info.etag
        info.last_modified = response.headers.get("Last-Modified") or info.last_modified
        if not info.mime:
            info.mime = (response.headers.get("Content-Type") or "").split(";", 1)[0].lower()
        info.final_url = response.geturl()
        response.read(1)
    except NetworkPolicyDownloadError:
        raise
    except (DownloadError, urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        info.range_supported = False
    finally:
        if response is not None:
            response.close()
    return info


class Progress:
    def __init__(self, emit: Callable[[dict[str, Any]], None], job_id: str, filename: str, total: int = 0):
        self.emit = emit
        self.job_id = job_id
        self.filename = filename
        self.total = total
        self.done = 0
        self.started = time.monotonic()
        self.last_emit = 0.0
        self.lock = threading.Lock()

    def add(self, amount: int, *, force: bool = False, message: str = "") -> None:
        with self.lock:
            self.done += amount
            now = time.monotonic()
            if not force and now - self.last_emit < 0.25:
                return
            self.last_emit = now
            elapsed = max(0.001, now - self.started)
            self.emit({
                "type": "progress",
                "jobId": self.job_id,
                "filename": self.filename,
                "status": "downloading",
                "bytes": self.done,
                "total": self.total,
                "progress": min(1.0, self.done / self.total) if self.total else 0,
                "speed": int(self.done / elapsed),
                "message": message,
            })

    def report(self, payload: dict[str, Any], *, force: bool = False) -> bool:
        """Emit externally computed progress through the same global throttle."""
        with self.lock:
            now = time.monotonic()
            if not force and now - self.last_emit < 0.25:
                return False
            self.last_emit = now
            event = {
                "type": "progress",
                "jobId": self.job_id,
                "filename": self.filename,
                **payload,
            }
        self.emit(event)
        return True

    def status(self, status: str, message: str = "", **extra: Any) -> None:
        self.emit({"type": "progress", "jobId": self.job_id, "filename": self.filename, "status": status, "progress": min(1.0, self.done / self.total) if self.total else 0, "message": message, **extra})


class _DashPairProgress:
    """Aggregate two direct transfers into a stable 0–90% job phase."""

    def __init__(self, progress: Progress, weights: dict[str, float] | None = None) -> None:
        self.progress = progress
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.last_emit = 0.0
        self.totals = {"video": 0, "audio": 0}
        self.dones = {"video": 0, "audio": 0}
        self.weights = weights or {"video": 0.45, "audio": 0.45}

    def track(self, kind: str) -> "_DashPairTrackProgress":
        return _DashPairTrackProgress(self, kind)

    def get_total(self, kind: str) -> int:
        with self.lock:
            return self.totals[kind]

    def set_total(self, kind: str, value: Any) -> None:
        with self.lock:
            try:
                total = max(0, int(value))
            except (TypeError, ValueError, OverflowError):
                total = 0
            self.totals[kind] = total

    def get_done(self, kind: str) -> int:
        with self.lock:
            return self.dones[kind]

    def set_done(self, kind: str, value: Any) -> None:
        with self.lock:
            try:
                done = max(0, int(value))
            except (TypeError, ValueError, OverflowError):
                done = 0
            self.dones[kind] = done

    def add(self, kind: str, amount: int, *, force: bool = False) -> None:
        with self.lock:
            self.dones[kind] = max(0, self.dones[kind] + int(amount))
            self._emit_locked(kind, force)

    def complete(self, kind: str, size: int) -> None:
        with self.lock:
            final_size = max(0, int(size))
            self.totals[kind] = max(self.totals[kind], final_size, self.dones[kind])
            self.dones[kind] = self.totals[kind]
            self._emit_locked(kind, True)

    def _emit_locked(self, active_kind: str, force: bool) -> None:
        now = time.monotonic()
        if not force and now - self.last_emit < 0.25:
            return
        self.last_emit = now
        total_done = sum(self.dones.values())
        total_size = sum(self.totals.values())
        fraction = 0.0
        for kind in ("video", "audio"):
            track_total = self.totals[kind]
            if track_total > 0:
                fraction += self.weights.get(kind, 0.0) * min(1.0, self.dones[kind] / track_total)
        self.progress.done = total_done
        self.progress.total = total_size
        elapsed = max(0.001, now - self.started)
        label = "视频轨" if active_kind == "video" else "音频轨"
        self.progress.emit({
            "type": "progress",
            "jobId": self.progress.job_id,
            "filename": self.progress.filename,
            "status": "downloading",
            "bytes": total_done,
            "total": total_size,
            "progress": min(0.9, fraction),
            "speed": int(total_done / elapsed),
            "message": f"正在下载{label}",
        })


class _DashPairTrackProgress:
    """The small Progress interface consumed by multipart_download."""

    def __init__(self, aggregate: _DashPairProgress, kind: str) -> None:
        self.aggregate = aggregate
        self.kind = kind

    @property
    def total(self) -> int:
        return self.aggregate.get_total(self.kind)

    @total.setter
    def total(self, value: Any) -> None:
        self.aggregate.set_total(self.kind, value)

    @property
    def done(self) -> int:
        return self.aggregate.get_done(self.kind)

    @done.setter
    def done(self, value: Any) -> None:
        self.aggregate.set_done(self.kind, value)

    def add(self, amount: int, *, force: bool = False, message: str = "") -> None:
        del message
        self.aggregate.add(self.kind, amount, force=force)


class _ScaledFfmpegProgress:
    """Keep a local copy/remux phase within the final 90–99% of the job."""

    def __init__(self, progress: Progress) -> None:
        self.progress = progress
        self.job_id = progress.job_id
        self.filename = progress.filename

    def emit(self, event: dict[str, Any]) -> None:
        mapped = dict(event)
        try:
            fraction = max(0.0, min(1.0, float(mapped.get("progress", 0))))
        except (TypeError, ValueError, OverflowError):
            fraction = 0.0
        mapped["progress"] = 0.9 + 0.09 * fraction
        mapped["status"] = "remuxing"
        self.progress.emit(mapped)


def range_chunks(length: int, workers: int) -> list[tuple[int, int]]:
    if length <= 0:
        return []
    target = 8 * 1024 * 1024 if length < 512 * 1024 * 1024 else 32 * 1024 * 1024
    count = max(workers, min(workers * 8, math.ceil(length / target)))
    size = math.ceil(length / count)
    return [(start, min(length - 1, start + size - 1)) for start in range(0, length, size)]


def range_identity(info: Probe) -> str:
    etag = info.etag.strip()
    if etag and not etag.lower().startswith("w/"):
        return etag
    return info.last_modified.strip()


def _checkpoint_header(value: str) -> str:
    """Normalize an in-memory validator before deriving its disk identity."""
    return re.sub(r"[\x00-\x1f\x7f]", "", str(value or ""))[:512]


def _checkpoint_validator_sha256(value: str) -> str:
    normalized = _checkpoint_header(value)
    if not normalized:
        return ""
    return f"sha256:{hashlib.sha256(normalized.encode('utf-8', 'strict')).hexdigest()}"


def checkpoint_entity(info: Probe) -> dict[str, str]:
    """Persist validator identities without writing opaque header values."""
    return {
        "etag": _checkpoint_validator_sha256(info.etag),
        "lastModified": _checkpoint_validator_sha256(info.last_modified),
    }


def checkpoint_url_sha256(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8", "strict")).hexdigest()


def checkpoint_payload(url: str, info: Probe, completed: Iterable[str]) -> dict[str, Any]:
    """Checkpoint v2 contains identity hashes, never a recoverable URL."""
    return {
        "schemaVersion": 2,
        "urlSha256": checkpoint_url_sha256(url),
        "length": info.length,
        "entity": checkpoint_entity(info),
        "completed": sorted(completed),
    }


def load_checkpoint_v2(path: Path) -> dict[str, Any] | None:
    """Load only schema v2 without following symlinks; erase legacy secrets."""
    if not path.exists() and not path.is_symlink():
        return None
    fd = -1
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_MESSAGE:
            raise ValueError("invalid checkpoint file")
        with os.fdopen(fd, "r", encoding="utf-8", closefd=True) as stream:
            fd = -1
            saved = json.load(stream)
        if not isinstance(saved, dict) or saved.get("schemaVersion") != 2:
            raise ValueError("legacy checkpoint")
        return saved
    except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError):
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        return None
    finally:
        if fd >= 0:
            os.close(fd)


def segment_checkpoint_paths(target: Path) -> tuple[Path, Path]:
    return target.with_suffix(target.suffix + ".part"), target.with_suffix(target.suffix + ".part.json")


def load_segment_checkpoint(path: Path) -> dict[str, Any] | None:
    """Pause marker of a staged-segment (HLS/DASH) job: schema 3 only."""
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
            return None
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(raw, dict) or raw.get("schemaVersion") != SEGMENT_CHECKPOINT_VERSION:
        return None
    work_dir = raw.get("workDir")
    url_hash = raw.get("urlSha256")
    kind = raw.get("kind")
    if not isinstance(work_dir, str) or "/" in work_dir or not work_dir.startswith(TEMP_WORK_PREFIXES):
        return None
    if not isinstance(url_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", url_hash):
        return None
    if kind not in {"hls", "dash"}:
        return None
    return {"workDir": work_dir, "urlSha256": url_hash, "kind": kind}


def write_segment_checkpoint(target: Path, url: str, work_dir: Path, kind: str) -> None:
    """Pause marker for staged-segment downloads. It names the private work
    directory and carries a digest of the playlist URL, never the URL, the
    headers or the playlist itself. The empty ``.part`` placeholder lets
    :func:`unique_path` hand the same output name to the resuming job."""
    part, checkpoint = segment_checkpoint_paths(target)
    atomic_write_json(checkpoint, {
        "schemaVersion": SEGMENT_CHECKPOINT_VERSION,
        "kind": kind,
        "workDir": work_dir.name,
        "urlSha256": checkpoint_url_sha256(url),
        "pausedAt": int(time.time()),
    })
    if not part.exists() and not part.is_symlink():
        os.close(_open_private(part, truncate=True))


def resume_segment_work_dir(target: Path, url: str, prefix: str, kind: str) -> Path:
    """Reuse the staged-segment directory of a paused job with the same output
    name and URL; otherwise start a fresh private directory. The pause marker
    is consumed either way (the next pause writes a new one)."""
    part, checkpoint = segment_checkpoint_paths(target)
    marker = load_segment_checkpoint(checkpoint)
    reusable: Path | None = None
    if marker and marker["kind"] == kind and hmac.compare_digest(marker["urlSha256"], checkpoint_url_sha256(url)):
        candidate = target.parent / marker["workDir"]
        if candidate.is_dir() and not candidate.is_symlink():
            reusable = candidate
    with contextlib.suppress(OSError):
        checkpoint.unlink(missing_ok=True)
    with contextlib.suppress(OSError):
        if part.is_file() and not part.is_symlink() and part.stat().st_size == 0:
            part.unlink(missing_ok=True)
    if reusable is not None:
        return reusable
    return Path(tempfile.mkdtemp(prefix=prefix, dir=str(target.parent)))


def staged_file_complete(dest: Path, expected: int = 0) -> bool:
    """A staged object is reusable only when it was renamed into place whole."""
    try:
        if dest.is_symlink() or not dest.is_file():
            return False
        size = dest.stat().st_size
    except OSError:
        return False
    return size > 0 and (not expected or size == expected)


def discard_partial_download(directory: Path, filename: str) -> dict[str, Any]:
    """Remove what a paused job left behind for one output name: the part
    file, its checkpoint and the staged-segment directory the marker names."""
    target = directory / safe_filename(filename)
    part, checkpoint = segment_checkpoint_paths(target)
    removed: list[str] = []
    marker = load_segment_checkpoint(checkpoint)
    if marker:
        work_dir = directory / marker["workDir"]
        if work_dir.is_dir() and not work_dir.is_symlink():
            shutil.rmtree(work_dir, ignore_errors=True)
            removed.append("workDir")
    for path, label in ((checkpoint, "checkpoint"), (part, "part")):
        if path.is_symlink() or not path.exists():
            continue
        with contextlib.suppress(OSError):
            path.unlink()
            removed.append(label)
    return {"removed": removed}


def multipart_download(
    url: str,
    target: Path,
    headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    *,
    allow_resume: bool = True,
) -> Path:
    checkpoint = target.with_suffix(target.suffix + ".part.json")
    part = target.with_suffix(target.suffix + ".part")

    def discard_cancelled_state() -> None:
        # A pause keeps a validated part + checkpoint pair for the next job
        # with this output name; without a checkpoint nothing is resumable.
        if is_pause(cancel) and checkpoint.is_file() and not checkpoint.is_symlink() and part.is_file():
            return
        for path in (part, checkpoint):
            with contextlib.suppress(OSError):
                path.unlink(missing_ok=True)

    if cancel.is_set():
        discard_cancelled_state()
        raise Cancelled()
    saved_checkpoint = load_checkpoint_v2(checkpoint)
    if not allow_resume and (checkpoint.exists() or checkpoint.is_symlink()):
        checkpoint.unlink(missing_ok=True)
        saved_checkpoint = None
    info = probe_direct(url, headers)
    # A hotlinked, expired, or IP-bound URL is often redirected to the site's
    # own page; refuse it here instead of saving the page as media.
    ensure_media_response_type(info.mime)
    if not info.range_supported or info.length <= 1:
        try:
            result = single_download(
                url, target, headers, cancel, progress,
                expected_length=info.length if info.length > 1 else 0,
            )
        except Cancelled:
            discard_cancelled_state()
            raise
        checkpoint.unlink(missing_ok=True)
        return result

    target.parent.mkdir(parents=True, exist_ok=True)
    chunks = range_chunks(info.length, max(1, min(24, workers)))
    valid_chunk_keys = {f"{start}-{end}" for start, end in chunks}
    completed: set[str] = set()
    checkpoint_lock = threading.Lock()
    abort = threading.Event()
    expected_identity = range_identity(info)
    expected_url_hash = checkpoint_url_sha256(url)
    expected_entity = checkpoint_entity(info)
    # Signed direct DASH URLs can contain short-lived access tokens. Their
    # pair work directories are intentionally non-resumable so no full query
    # string is ever written to a checkpoint that could survive a crash.
    resumable = allow_resume and bool(expected_identity)

    checkpoint_valid = False
    if resumable and saved_checkpoint is not None and part.is_file() and not part.is_symlink():
        try:
            saved = saved_checkpoint
            saved_completed = saved.get("completed")
            if (
                saved.get("schemaVersion") == 2
                and isinstance(saved.get("urlSha256"), str)
                and hmac.compare_digest(saved["urlSha256"], expected_url_hash)
                and saved.get("length") == info.length
                and saved.get("entity") == expected_entity
                and part.stat().st_size == info.length
                and isinstance(saved_completed, list)
                and all(isinstance(item, str) and item in valid_chunk_keys for item in saved_completed)
            ):
                checkpoint_valid = True
                completed = set(saved_completed)
                progress.done = sum(end - start + 1 for start, end in chunks if f"{start}-{end}" in completed)
        except (OSError, ValueError, TypeError):
            completed = set()
    if not checkpoint_valid and (checkpoint.exists() or checkpoint.is_symlink()):
        checkpoint.unlink(missing_ok=True)

    fd = _open_private(part)
    os.ftruncate(fd, info.length)
    write_lock = threading.Lock()

    def save_checkpoint() -> None:
        atomic_write_json(checkpoint, checkpoint_payload(url, info, completed))

    def fetch_chunk(item: tuple[int, int]) -> None:
        start, end = item
        key = f"{start}-{end}"
        if key in completed:
            return
        if cancel.is_set():
            raise Cancelled()
        if abort.is_set():
            raise DownloadError("Multipart download aborted")
        last_error: Exception | None = None
        for attempt in range(4):
            response = None
            attempt_bytes = 0
            try:
                extra = {"Range": f"bytes={start}-{end}"}
                if expected_identity:
                    extra["If-Range"] = expected_identity
                response = request(url, headers, timeout=45, extra=extra)
                validate_range_response(response, start, end, info.length)
                expected = end - start + 1
                position = start
                remaining = expected
                while remaining:
                    if cancel.is_set():
                        raise Cancelled()
                    if abort.is_set():
                        raise DownloadError("Multipart download aborted")
                    block = response.read(min(1024 * 1024, remaining))
                    if not block:
                        raise DownloadError("Range response ended early")
                    _write_all(fd, block, position, write_lock)
                    position += len(block)
                    remaining -= len(block)
                    attempt_bytes += len(block)
                    progress.add(len(block))
                with checkpoint_lock:
                    # Make the completed bytes durable before advertising the
                    # chunk in a crash-recovery checkpoint.
                    if resumable:
                        os.fsync(fd)
                    completed.add(key)
                    if resumable:
                        save_checkpoint()
                return
            except Cancelled:
                raise
            except NetworkPolicyDownloadError:
                abort.set()
                raise
            except Exception as error:  # noqa: BLE001 - retry network failures
                last_error = error
                if attempt_bytes:
                    progress.add(-attempt_bytes)
                if attempt < 3:
                    _retry_wait(cancel, min(4.0, 0.35 * (2**attempt)), abort)
            finally:
                if response is not None:
                    response.close()
        raise DownloadError(f"Range {key} failed: {last_error}")

    cancelled = False
    try:
        progress.total = info.length
        progress.add(0, force=True)
        if resumable:
            with checkpoint_lock:
                save_checkpoint()
        else:
            checkpoint.unlink(missing_ok=True)
        pending = [chunk for chunk in chunks if f"{chunk[0]}-{chunk[1]}" not in completed]
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(24, workers)))
        futures = [_submit_with_context(pool, fetch_chunk, chunk) for chunk in pending]
        try:
            for future in concurrent.futures.as_completed(futures):
                future.result()
        except Exception:
            abort.set()
            for future in futures:
                future.cancel()
            raise
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
        os.fsync(fd)
    except Cancelled:
        cancelled = True
        raise
    except Exception as error:
        if cancel.is_set():
            cancelled = True
            raise Cancelled() from error
        if not resumable:
            part.unlink(missing_ok=True)
            checkpoint.unlink(missing_ok=True)
        raise
    finally:
        os.close(fd)
        if cancelled:
            discard_cancelled_state()

    if cancel.is_set():
        discard_cancelled_state()
        raise Cancelled()
    if part.stat().st_size != info.length:
        raise DownloadError("Final file length mismatch")
    target = commit_file(part, target)
    checkpoint.unlink(missing_ok=True)
    progress.done = info.length
    progress.add(0, force=True)
    return target


def single_download(
    url: str,
    target: Path,
    headers: dict[str, str],
    cancel: threading.Event,
    progress: Progress,
    *,
    expected_length: int = 0,
) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    last_error: Exception | None = None
    for attempt in range(4):
        if cancel.is_set():
            part.unlink(missing_ok=True)
            raise Cancelled()
        response = None
        attempt_bytes = 0
        try:
            response = request(url, headers, timeout=60)
            if response.status != 200:
                raise DownloadError(f"unexpected media response status {response.status}")
            ensure_media_response_type(response.headers.get("Content-Type") or "")
            # A close-delimited body (no Content-Length) can end early without
            # any error; the probe's length is the only truth we have then.
            progress.total = _content_length(response.headers) or max(0, int(expected_length or 0))
            fd = _open_private(part, truncate=True)
            try:
                with os.fdopen(fd, "wb", closefd=True) as stream:
                    first = True
                    while True:
                        if cancel.is_set():
                            raise Cancelled()
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        # Some servers answer media requests with an
                        # untyped page; catch it before any byte is kept.
                        if first:
                            first = False
                            if looks_like_html_body(block):
                                raise HtmlMediaResponseError(HTML_MEDIA_MESSAGE)
                        stream.write(block)
                        attempt_bytes += len(block)
                        progress.add(len(block))
                    if progress.total and attempt_bytes != progress.total:
                        raise DownloadError("Response ended before Content-Length")
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception:
                # os.fdopen owns fd after construction.
                raise
            if cancel.is_set():
                raise Cancelled()
            target = commit_file(part, target)
            progress.add(0, force=True)
            return target
        except Cancelled:
            part.unlink(missing_ok=True)
            raise
        except NetworkPolicyDownloadError:
            part.unlink(missing_ok=True)
            raise
        except HtmlMediaResponseError:
            # Retrying or keeping bytes cannot fix a page answered in place
            # of the media object; fail fast with nothing left behind.
            part.unlink(missing_ok=True)
            raise
        except Exception as error:  # noqa: BLE001 - restart non-range transfers
            last_error = error
            part.unlink(missing_ok=True)
            if attempt_bytes:
                progress.add(-attempt_bytes)
            if attempt < 3:
                _retry_wait(cancel, min(4.0, 0.35 * (2**attempt)))
        finally:
            if response is not None:
                response.close()
    raise DownloadError(f"Download failed after retries: {last_error}")


def parse_attrs(source: str) -> dict[str, str]:
    result: dict[str, str] = {}
    pattern = re.compile(r'([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)', re.I)
    for match in pattern.finditer(source):
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1]
        result[match.group(1).upper()] = value
    return result


@dataclass
class HlsSegment:
    url: str
    duration: float = 0
    byte_range: str = ""


@dataclass
class HlsPlaylist:
    url: str
    request_headers: dict[str, str] = field(default_factory=dict)
    variants: list[dict[str, Any]] = field(default_factory=list)
    audio_tracks: list[dict[str, Any]] = field(default_factory=list)
    key_urls: list[str] = field(default_factory=list)
    segments: list[HlsSegment] = field(default_factory=list)
    init_map: str = ""
    init_map_range: str = ""
    encrypted: bool = False
    live: bool = True
    discontinuity: bool = False
    separate_audio: bool = False
    protection: str = "clear"


@dataclass(frozen=True)
class ManifestFetchResult:
    text: str
    final_url: str
    request_headers: dict[str, str]


def is_manifest_fetch_timeout(error: BaseException) -> bool:
    """True when a manifest request died from a connection/read timeout."""
    seen: set[int] = set()
    candidates: list[BaseException | None] = [error]
    reason = getattr(error, "reason", None)
    if isinstance(reason, BaseException):
        candidates.append(reason)
    while candidates:
        current = candidates.pop(0)
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, TimeoutError):  # socket.timeout aliases this on 3.10+
            return True
        if isinstance(current, OSError) and "timed out" in str(current).lower():
            return True
        cause = current.__cause__
        if isinstance(cause, BaseException):
            candidates.append(cause)
    return False


class ManifestFetchDeadlineExceeded(TimeoutError):
    """Raised when one manifest attempt outlives its whole-operation budget."""


def _manifest_fetch_bounded(
    url: str,
    headers: dict[str, str],
    cancel: threading.Event,
) -> ManifestFetchResult:
    """Run a single manifest attempt under a hard wall-clock deadline.

    A per-socket timeout cannot interrupt reads against servers that drip
    bytes slowly enough to reset every idle window, so a watchdog closes
    the live response once the total budget expires.
    """
    policy = current_network_policy()
    finished = threading.Event()
    aborted = threading.Event()
    holder: dict[str, Any] = {}

    def worker() -> None:
        token = set_current_network_policy(policy)
        try:
            if cancel.is_set():
                raise Cancelled()
            try:
                response = request(url, headers, timeout=MANIFEST_FETCH_TIMEOUT_SECONDS)
                holder["response"] = response
                holder["value"] = ManifestFetchResult(
                    text=read_limited(response, MAX_MANIFEST).decode("utf-8-sig", "replace"),
                    final_url=valid_url(response.geturl()),
                    request_headers=dict(getattr(response, "_havre_request_headers", {})),
                )
            finally:
                streamed = holder.get("response")
                if streamed is not None:
                    try:
                        streamed.close()
                    except Exception:  # noqa: BLE001 - double close must not mask results
                        pass
        except BaseException as error:  # noqa: BLE001 - relayed to the caller below
            if aborted.is_set():
                # Closing the response under a blocked reader surfaces as an
                # arbitrary error (often AttributeError on the cleared fp);
                # normalize it to the deadline failure callers expect.
                host_name = urllib.parse.urlsplit(url).hostname or urllib.parse.urlsplit(url).netloc or "unknown"
                deadline_error = ManifestFetchDeadlineExceeded(
                    f"获取播放列表超时({MANIFEST_FETCH_TIMEOUT_SECONDS}s): {host_name}"
                )
                deadline_error.__cause__ = error
                holder["error"] = deadline_error
            else:
                holder["error"] = error
        finally:
            reset_current_network_policy(token)
            finished.set()

    reader = threading.Thread(target=worker, daemon=True, name="havre-manifest-fetch")
    reader.start()
    host_name = urllib.parse.urlsplit(url).hostname or urllib.parse.urlsplit(url).netloc or "unknown"
    if not finished.wait(MANIFEST_FETCH_TIMEOUT_SECONDS):
        stalled = holder.get("response")
        if stalled is not None:
            aborted.set()
            try:
                stalled.close()
            except Exception:  # noqa: BLE001 - best-effort abort of the blocked read
                pass
        if not finished.wait(5.0):
            raise ManifestFetchDeadlineExceeded(
                f"获取播放列表超时({MANIFEST_FETCH_TIMEOUT_SECONDS}s): {host_name}"
            ) from None
    error = holder.get("error")
    if error is not None:
        raise error
    value = holder.get("value")
    if isinstance(value, ManifestFetchResult):
        return value
    raise DownloadError("Manifest download failed without a result")


# Playlists the extension fetched with the browser's own session for a site
# that proxies them behind its login (The Economist Insider). The engine uses
# the text in place of its own fetch for exactly those addresses; every child
# the text names still goes through the pinned client and the network policy.
_PRELOADED_MANIFESTS: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar(
    "havre_preloaded_manifests",
    default={},
)
MAX_PRELOADED_MANIFESTS = 4
MAX_PRELOADED_MANIFEST_BYTES = 1_500_000


def preloaded_manifests(value: Any, job_url: str) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        return {}
    if len(value) > MAX_PRELOADED_MANIFESTS:
        raise DownloadError("Too many preloaded playlists")
    result: dict[str, str] = {}
    for raw_url, text in value.items():
        url = valid_url(raw_url)
        if not _same_origin(url, job_url):
            raise DownloadError("Preloaded playlist is not on the media origin")
        if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_PRELOADED_MANIFEST_BYTES:
            raise DownloadError("Preloaded playlist exceeds the size limit")
        if not text.lstrip("\ufeff").lstrip().startswith("#EXTM3U"):
            raise DownloadError("Preloaded playlist is not an HLS playlist")
        result[url] = text
    return result


def fetch_manifest(
    url: str,
    headers: dict[str, str],
    cancel: threading.Event | None = None,
) -> ManifestFetchResult:
    preloaded = _PRELOADED_MANIFESTS.get()
    if url in preloaded:
        # The address still passes the policy gate so a preloaded text cannot
        # stand in for a target the engine would refuse to contact.
        current_network_policy().authorize(url, purpose="preloaded playlist")
        return ManifestFetchResult(text=preloaded[url], final_url=url, request_headers=clean_headers(headers))
    cancel = cancel or threading.Event()
    last_error: Exception | None = None
    timeout_streak = 0
    for attempt in range(6):
        if cancel.is_set():
            raise Cancelled()
        try:
            return _manifest_fetch_bounded(url, headers, cancel)
        except Cancelled:
            raise
        except NetworkPolicyDownloadError:
            raise
        except Exception as error:  # noqa: BLE001 - retry manifest network failures
            last_error = error
            if is_manifest_fetch_timeout(error):
                # One bounded immediate retry; a second stall surfaces a clear
                # user-facing timeout instead of a raw socket traceback.
                timeout_streak += 1
                if timeout_streak >= 2:
                    host_name = urllib.parse.urlsplit(url).hostname or urllib.parse.urlsplit(url).netloc or "unknown"
                    raise DownloadError(
                        f"获取播放列表超时({MANIFEST_FETCH_TIMEOUT_SECONDS}s): {host_name}"
                    ) from error
                continue
            timeout_streak = 0
            if attempt < 5:
                _retry_wait(cancel, min(8.0, 0.5 * (2**attempt)))
    raise DownloadError(f"Manifest download failed after retries: {last_error}")


def normalize_hls_range(value: str, url: str, previous_range_end: dict[str, int]) -> str:
    parts = value.strip().split("@", 1)
    try:
        amount = int(parts[0])
        offset = int(parts[1]) if len(parts) == 2 else previous_range_end.get(url, 0)
    except ValueError as error:
        raise DownloadError("Invalid HLS byte range") from error
    if amount <= 0 or offset < 0 or amount > (1 << 63) - 1 or offset > (1 << 63) - amount:
        raise DownloadError("Invalid HLS byte range")
    previous_range_end[url] = offset + amount
    return f"{amount}@{offset}"


def parse_hls(text: str, url: str) -> HlsPlaylist:
    if len(text) > MAX_MANIFEST:
        raise DownloadError("HLS playlist exceeds the text limit")
    raw_lines = text.splitlines()
    if len(raw_lines) > MAX_HLS_LINES:
        raise DownloadError("HLS playlist exceeds the line limit")
    lines = [line.strip() for line in raw_lines if line.strip()]
    if not lines or lines[0] != "#EXTM3U":
        raise DownloadError("Invalid HLS playlist")
    playlist = HlsPlaylist(url=url)
    pending_variant: dict[str, str] | None = None
    pending_duration = 0.0
    pending_range = ""
    previous_range_end: dict[str, int] = {}
    referenced_url_chars = 0

    def reference(value: str) -> str:
        nonlocal referenced_url_chars
        absolute = valid_url(urllib.parse.urljoin(url, value))
        referenced_url_chars += len(absolute)
        if referenced_url_chars > MAX_MANIFEST_URL_CHARS:
            raise DownloadError("HLS playlist child URLs exceed the configured limit")
        return absolute

    for line in lines[1:]:
        if line.startswith("#EXT-X-STREAM-INF:"):
            pending_variant = parse_attrs(line.split(":", 1)[1])
        elif line.startswith("#EXT-X-MEDIA:"):
            attrs = parse_attrs(line.split(":", 1)[1])
            if attrs.get("TYPE") == "AUDIO" and attrs.get("URI"):
                playlist.separate_audio = True
                audio_url = reference(attrs["URI"])
                playlist.audio_tracks.append({**attrs, "url": audio_url})
                if len(playlist.audio_tracks) > MAX_HLS_MEDIA_TRACKS:
                    raise DownloadError("HLS playlist exceeds the media-track limit")
        elif line.startswith("#EXTINF:"):
            with contextlib.suppress(ValueError):
                pending_duration = float(line[8:].split(",", 1)[0])
        elif line.startswith("#EXT-X-BYTERANGE:"):
            pending_range = line.split(":", 1)[1]
        elif line.startswith("#EXT-X-MAP:"):
            attrs = parse_attrs(line.split(":", 1)[1])
            if attrs.get("URI"):
                playlist.init_map = reference(attrs["URI"])
                raw_range = attrs.get("BYTERANGE", "")
                playlist.init_map_range = normalize_hls_range(raw_range, playlist.init_map, previous_range_end) if raw_range else ""
        elif line.startswith("#EXT-X-KEY:"):
            attrs = parse_attrs(line.split(":", 1)[1])
            method = attrs.get("METHOD", "NONE")
            if method != "NONE":
                playlist.encrypted = True
                key_format = attrs.get("KEYFORMAT", "identity").lower()
                observed = "aes128" if method == "AES-128" and key_format == "identity" else "drm"
                # Protection is playlist-wide. Once a SAMPLE-AES/DRM period is
                # observed, a later clear or AES-128 key must not downgrade it.
                if observed == "drm" or playlist.protection != "drm":
                    playlist.protection = observed
                if observed == "aes128" and attrs.get("URI"):
                    key_url = reference(attrs["URI"])
                    playlist.key_urls.append(key_url)
                    if len(playlist.key_urls) > MAX_HLS_KEYS:
                        raise DownloadError("HLS playlist exceeds the key-reference limit")
        elif line == "#EXT-X-DISCONTINUITY":
            playlist.discontinuity = True
        elif line == "#EXT-X-ENDLIST":
            playlist.live = False
        elif not line.startswith("#"):
            absolute = reference(line)
            if pending_variant is not None:
                resolution = pending_variant.get("RESOLUTION", "0x0").split("x")
                playlist.variants.append({
                    "url": absolute,
                    "bandwidth": int(pending_variant.get("BANDWIDTH") or pending_variant.get("AVERAGE-BANDWIDTH") or 0),
                    "height": int(resolution[1]) if len(resolution) == 2 and resolution[1].isdigit() else 0,
                    "codecs": pending_variant.get("CODECS", ""),
                    "audio_group": pending_variant.get("AUDIO", ""),
                })
                if len(playlist.variants) > MAX_HLS_VARIANTS:
                    raise DownloadError("HLS playlist exceeds the variant limit")
                pending_variant = None
            else:
                normalized_range = pending_range
                if pending_range:
                    normalized_range = normalize_hls_range(pending_range, absolute, previous_range_end)
                playlist.segments.append(HlsSegment(absolute, pending_duration, normalized_range))
                if len(playlist.segments) > MAX_HLS_SEGMENTS:
                    raise DownloadError("HLS playlist exceeds the segment limit")
                pending_duration = 0.0
                pending_range = ""
    return playlist


def _parse_dash_root(text: str) -> ET.Element:
    if len(text) > MAX_MANIFEST:
        raise DownloadError("DASH MPD exceeds the text limit")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise DownloadError("Invalid DASH MPD") from error
    if root.tag.rsplit("}", 1)[-1] != "MPD":
        raise DownloadError("Invalid DASH MPD")
    if sum(1 for _element in root.iter()) > MAX_DASH_XML_ELEMENTS:
        raise UnsupportedDashError("DASH MPD exceeds the XML element limit")
    return root


def dash_is_protected(text: str) -> bool:
    root = _parse_dash_root(text)
    return any(element.tag.rsplit("}", 1)[-1] == "ContentProtection" for element in root.iter())


def _xml_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _xml_children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _xml_name(child) == name]


def _xml_child(element: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in element if _xml_name(child) == name), None)


def _iso_duration_seconds(value: str) -> float:
    match = re.fullmatch(
        r"P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?",
        value or "",
        re.I,
    )
    if not match or not any(group is not None for group in match.groups()):
        raise UnsupportedDashError(f"unsupported ISO-8601 duration: {value!r}")
    days, hours, minutes, seconds = (float(group or 0) for group in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def _positive_int(value: Any, name: str, default: int | None = None) -> int:
    if value in {None, ""} and default is not None:
        return default
    try:
        number = int(str(value))
    except (TypeError, ValueError) as error:
        raise UnsupportedDashError(f"invalid DASH {name}") from error
    if number <= 0:
        raise UnsupportedDashError(f"invalid DASH {name}")
    return number


def _nonnegative_int(value: Any, name: str, default: int = 0) -> int:
    if value in {None, ""}:
        return default
    try:
        number = int(str(value))
    except (TypeError, ValueError) as error:
        raise UnsupportedDashError(f"invalid DASH {name}") from error
    if number < 0:
        raise UnsupportedDashError(f"invalid DASH {name}")
    return number


def _dash_base(parent_url: str, element: ET.Element) -> str:
    base = _xml_child(element, "BaseURL")
    if base is None or not (base.text or "").strip():
        return parent_url
    url = urllib.parse.urljoin(parent_url, (base.text or "").strip())
    return valid_url(url)


def _dash_descriptor(
    period: ET.Element,
    adaptation: ET.Element,
    representation: ET.Element,
) -> tuple[str, dict[str, str], ET.Element | None, ET.Element | None, list[ET.Element]] | None:
    ancestors = (period, adaptation, representation)
    mode = ""
    for element in reversed(ancestors):
        if _xml_child(element, "SegmentTemplate") is not None:
            mode = "SegmentTemplate"
            break
        if _xml_child(element, "SegmentList") is not None:
            mode = "SegmentList"
            break
    if not mode:
        return None
    nodes = [node for element in ancestors if (node := _xml_child(element, mode)) is not None]
    attrs: dict[str, str] = {}
    timeline: ET.Element | None = None
    initialization: ET.Element | None = None
    segment_urls: list[ET.Element] = []
    for node in nodes:
        attrs.update(node.attrib)
        child_timeline = _xml_child(node, "SegmentTimeline")
        if child_timeline is not None:
            timeline = child_timeline
        child_initialization = _xml_child(node, "Initialization")
        if child_initialization is not None:
            initialization = child_initialization
        urls = _xml_children(node, "SegmentURL")
        if urls:
            segment_urls = urls
    return mode, attrs, timeline, initialization, segment_urls


_DASH_TEMPLATE_TOKEN = re.compile(r"\$(RepresentationID|Bandwidth|Number|Time)(?:%0([1-9]\d?)d)?\$")


def _dash_template_value(template: str, representation_id: str, bandwidth: int, number: int, time_value: int) -> str:
    sentinel = "\x00HAVRE-DOLLAR\x00"
    source = template.replace("$$", sentinel)

    def replace(match: re.Match[str]) -> str:
        name, width_text = match.groups()
        if name == "RepresentationID":
            if width_text:
                raise UnsupportedDashError("RepresentationID cannot use numeric formatting")
            return representation_id
        value = {"Bandwidth": bandwidth, "Number": number, "Time": time_value}[name]
        return f"{value:0{int(width_text)}d}" if width_text else str(value)

    result = _DASH_TEMPLATE_TOKEN.sub(replace, source)
    if re.search(r"\$[^$]+\$", result):
        raise UnsupportedDashError(f"unsupported DASH template token in {template!r}")
    return result.replace(sentinel, "$")


def _dash_timeline_points(timeline: ET.Element, timescale: int, duration_seconds: float) -> list[int]:
    entries = _xml_children(timeline, "S")
    if not entries:
        raise UnsupportedDashError("empty DASH SegmentTimeline")
    points: list[int] = []
    current = 0
    period_end = math.ceil(duration_seconds * timescale) if duration_seconds > 0 else 0
    for index, item in enumerate(entries):
        duration = _positive_int(item.get("d"), "SegmentTimeline duration")
        current = _nonnegative_int(item.get("t"), "SegmentTimeline time", current)
        try:
            repeat = int(item.get("r", "0"))
        except ValueError as error:
            raise UnsupportedDashError("invalid DASH SegmentTimeline repeat") from error
        if repeat < -1:
            raise UnsupportedDashError("invalid DASH SegmentTimeline repeat")
        if repeat == -1:
            next_time = 0
            if index + 1 < len(entries) and entries[index + 1].get("t") not in {None, ""}:
                next_time = _nonnegative_int(entries[index + 1].get("t"), "SegmentTimeline time")
            boundary = next_time or period_end
            if boundary <= current:
                raise UnsupportedDashError("open-ended DASH SegmentTimeline requires a period duration or following t")
            count = math.ceil((boundary - current) / duration)
        else:
            count = repeat + 1
        if count <= 0 or len(points) + count > MAX_DASH_SEGMENTS:
            raise UnsupportedDashError("DASH SegmentTimeline exceeds the segment limit")
        points.extend(current + offset * duration for offset in range(count))
        current += count * duration
    return points


def _dash_range(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d+)-(\d+)", (value or "").strip())
    if not match:
        raise UnsupportedDashError("invalid DASH byte range")
    start, end = int(match.group(1)), int(match.group(2))
    if end < start or end > (1 << 63) - 1:
        raise UnsupportedDashError("invalid DASH byte range")
    return start, end


@dataclass(frozen=True)
class DashResource:
    url: str
    byte_range: str = ""


@dataclass
class DashTrack:
    kind: str
    representation_id: str
    bandwidth: int
    resources: list[DashResource]
    width: int = 0
    height: int = 0


def _dash_representation_track(
    manifest_url: str,
    root: ET.Element,
    period: ET.Element,
    adaptation: ET.Element,
    representation: ET.Element,
) -> DashTrack:
    root_base = _dash_base(manifest_url, root)
    period_base = _dash_base(root_base, period)
    adaptation_base = _dash_base(period_base, adaptation)
    representation_base = _dash_base(adaptation_base, representation)
    representation_id = representation.get("id", "")
    bandwidth = _nonnegative_int(representation.get("bandwidth"), "bandwidth")
    mime = (representation.get("mimeType") or adaptation.get("mimeType") or "").lower()
    kind = (adaptation.get("contentType") or mime.split("/", 1)[0]).lower()
    if kind not in {"audio", "video"}:
        raise UnsupportedDashError(f"unsupported DASH representation type: {kind or 'unknown'}")

    descriptor = _dash_descriptor(period, adaptation, representation)
    resources: list[DashResource] = []
    resource_url_chars = 0

    def append_resource(resource: DashResource) -> None:
        nonlocal resource_url_chars
        resource_url_chars += len(resource.url)
        if resource_url_chars > MAX_MANIFEST_URL_CHARS:
            raise UnsupportedDashError("DASH representation child URLs exceed the configured limit")
        if len(resources) >= MAX_DASH_SEGMENTS + 1:
            raise UnsupportedDashError("DASH representation exceeds the resource limit")
        resources.append(resource)

    if descriptor is None:
        # ISO-BMFF on-demand profiles may point a Representation directly at a
        # complete media file. Only accept a Representation-local BaseURL so a
        # directory inherited from the MPD is not mistaken for a media object.
        direct_base = _xml_child(representation, "BaseURL")
        if direct_base is None or not (direct_base.text or "").strip():
            raise UnsupportedDashError("representation has no SegmentTemplate, SegmentList, or media BaseURL")
        append_resource(DashResource(representation_base))
    else:
        mode, attrs, timeline, initialization, segment_urls = descriptor
        if mode == "SegmentTemplate":
            media_template = attrs.get("media", "")
            if not media_template:
                raise UnsupportedDashError("DASH SegmentTemplate has no media template")
            timescale = _positive_int(attrs.get("timescale"), "timescale", 1)
            start_number = _positive_int(attrs.get("startNumber"), "startNumber", 1)
            period_duration_text = period.get("duration") or root.get("mediaPresentationDuration") or ""
            period_duration = _iso_duration_seconds(period_duration_text) if period_duration_text else 0.0
            if timeline is not None:
                time_points = _dash_timeline_points(timeline, timescale, period_duration)
            else:
                segment_duration = _positive_int(attrs.get("duration"), "segment duration")
                if period_duration <= 0:
                    raise UnsupportedDashError("duration-based DASH template requires a period duration")
                count = math.ceil(period_duration * timescale / segment_duration)
                if count <= 0 or count > MAX_DASH_SEGMENTS:
                    raise UnsupportedDashError("DASH template exceeds the segment limit")
                time_points = [index * segment_duration for index in range(count)]
            if attrs.get("initialization"):
                init_value = _dash_template_value(attrs["initialization"], representation_id, bandwidth, start_number, time_points[0])
                append_resource(DashResource(valid_url(urllib.parse.urljoin(representation_base, init_value))))
            for offset, time_value in enumerate(time_points):
                media_value = _dash_template_value(media_template, representation_id, bandwidth, start_number + offset, time_value)
                append_resource(DashResource(valid_url(urllib.parse.urljoin(representation_base, media_value))))
        else:
            if initialization is not None:
                source = initialization.get("sourceURL", "")
                init_url = valid_url(urllib.parse.urljoin(representation_base, source)) if source else representation_base
                range_value = initialization.get("range", "")
                if range_value:
                    _dash_range(range_value)
                append_resource(DashResource(init_url, range_value))
            if not segment_urls:
                raise UnsupportedDashError("DASH SegmentList has no SegmentURL entries")
            if len(segment_urls) > MAX_DASH_SEGMENTS:
                raise UnsupportedDashError("DASH SegmentList exceeds the segment limit")
            for item in segment_urls:
                source = item.get("media", "")
                media_url = valid_url(urllib.parse.urljoin(representation_base, source)) if source else representation_base
                range_value = item.get("mediaRange", "")
                if range_value:
                    _dash_range(range_value)
                append_resource(DashResource(media_url, range_value))
    if not resources:
        raise UnsupportedDashError("DASH representation has no downloadable resources")
    return DashTrack(
        kind=kind,
        representation_id=representation_id,
        bandwidth=bandwidth,
        width=_nonnegative_int(representation.get("width"), "width"),
        height=_nonnegative_int(representation.get("height"), "height"),
        resources=resources,
    )


def plan_static_dash(
    text: str,
    manifest_url: str,
    *,
    selected_representation_index: int | None = None,
) -> list[DashTrack]:
    root = _parse_dash_root(text)
    if any(_xml_name(element) == "ContentProtection" for element in root.iter()):
        raise DownloadError("Protected DASH is metadata-only")
    if (root.get("type") or "static").lower() != "static":
        raise UnsupportedDashError("built-in DASH planner supports static MPDs only")
    for element in root.iter():
        if any(key.rsplit("}", 1)[-1].lower() == "href" for key in element.attrib):
            raise UnsupportedDashError("external DASH xlink resources are not supported")
    periods = _xml_children(root, "Period")
    if len(periods) != 1:
        raise UnsupportedDashError("built-in DASH planner requires exactly one Period")
    period = periods[0]
    adaptations = _xml_children(period, "AdaptationSet")
    if len(adaptations) > MAX_DASH_ADAPTATION_SETS:
        raise UnsupportedDashError("DASH MPD exceeds the AdaptationSet limit")
    candidates: dict[str, list[tuple[ET.Element, ET.Element, int]]] = {"video": [], "audio": []}
    errors: dict[str, list[str]] = {"video": [], "audio": [], "unknown": []}
    declared_kinds: set[str] = set()
    representation_count = 0
    for adaptation in adaptations:
        representations = _xml_children(adaptation, "Representation")
        representation_count += len(representations)
        if representation_count > MAX_DASH_REPRESENTATIONS:
            raise UnsupportedDashError("DASH MPD exceeds the Representation limit")
        for local_index, representation in enumerate(representations):
            current_index = representation_count - len(representations) + local_index
            mime = (representation.get("mimeType") or adaptation.get("mimeType") or "").lower()
            declared_kind = (adaptation.get("contentType") or mime.split("/", 1)[0]).lower()
            if declared_kind in {"video", "audio"}:
                declared_kinds.add(declared_kind)
                candidates[declared_kind].append((adaptation, representation, current_index))
            else:
                errors["unknown"].append(f"unsupported DASH representation type: {declared_kind or 'unknown'}")

    def score(kind: str, representation: ET.Element) -> tuple[int, ...]:
        def value(name: str) -> int:
            try:
                result = int(representation.get(name, "0"))
            except ValueError:
                return -1
            return result if result >= 0 else -1

        if kind == "video":
            return value("height"), value("width"), value("bandwidth")
        return (value("bandwidth"),)

    selected: list[DashTrack] = []
    for kind in ("video", "audio"):
        if kind not in declared_kinds:
            continue
        ordered = sorted(candidates[kind], key=lambda item: score(kind, item[1]), reverse=True)
        if kind == "video" and selected_representation_index is not None:
            requested = [item for item in ordered if item[2] == selected_representation_index]
            if not requested:
                raise UnsupportedDashError("selected DASH video Representation is no longer present")
            ordered = requested
        selected_track: DashTrack | None = None
        for adaptation, representation, _representation_index in ordered:
            try:
                selected_track = _dash_representation_track(
                    manifest_url,
                    root,
                    period,
                    adaptation,
                    representation,
                )
                break
            except UnsupportedDashError as error:
                errors[kind].append(str(error))
        if selected_track is None:
            detail = errors[kind][0] if errors[kind] else f"no usable {kind} Representation was found"
            raise UnsupportedDashError(f"{kind} track is unsupported: {detail}")
        selected.append(selected_track)
    if not selected:
        all_errors = errors["unknown"] + errors["video"] + errors["audio"]
        detail = all_errors[0] if all_errors else "no audio/video Representations were found"
        raise UnsupportedDashError(detail)
    if sum(len(track.resources) for track in selected) > MAX_DASH_RESOURCES:
        raise UnsupportedDashError("DASH MPD exceeds the total resource limit")
    return selected


def _dash_demuxer_error(capabilities: FfmpegCapabilities, detail: str) -> DownloadError:
    identity = capabilities.path or "FFmpeg"
    if capabilities.version:
        identity = f"{identity} (version {capabilities.version})"
    return DownloadError(
        f"The pinned built-in static DASH planner could not handle this MPD: {detail}. "
        f"Direct network access by {identity} is disabled; this structure needs pinned broker support"
    )


def _fetch_dash_resource(
    resource: DashResource,
    destination: Path,
    headers: dict[str, str],
    cancel: threading.Event,
    abort: threading.Event,
    progress: Progress,
    state: dict[str, int],
    state_lock: threading.Lock,
) -> Path:
    last_error: Exception | None = None
    staging = destination.with_name(destination.name + ".tmp")
    expected_known = 0
    if resource.byte_range:
        known_start, known_end = _dash_range(resource.byte_range)
        expected_known = known_end - known_start + 1
    if staged_file_complete(destination, expected_known):
        with state_lock:
            state["bytes"] += destination.stat().st_size
            state["completed"] += 1
            elapsed = max(0.001, time.monotonic() - progress.started)
            progress.report({
                "status": "downloading",
                "bytes": state["bytes"],
                "total": 0,
                "progress": state["completed"] / max(1, state["resources"]),
                "speed": int(state["bytes"] / elapsed),
                "message": f"DASH 分片 {state['completed']}/{state['resources']}",
            }, force=state["completed"] >= state["resources"])
        return destination
    for attempt in range(4):
        if cancel.is_set():
            raise Cancelled()
        if abort.is_set():
            raise DownloadError("DASH download aborted")
        response = None
        attempt_bytes = 0
        try:
            extra: dict[str, str] = {}
            expected = 0
            if resource.byte_range:
                start, end = _dash_range(resource.byte_range)
                expected = end - start + 1
                extra["Range"] = f"bytes={start}-{end}"
            response = request(resource.url, headers, timeout=45, extra=extra)
            if resource.byte_range:
                validate_range_response(response, start, end)
            elif response.status != 200:
                raise DownloadError("Unexpected DASH segment response status")
            fd = _open_private(staging, truncate=True)
            with os.fdopen(fd, "wb", closefd=True) as output:
                while True:
                    if cancel.is_set():
                        raise Cancelled()
                    if abort.is_set():
                        raise DownloadError("DASH download aborted")
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
                    attempt_bytes += len(block)
                    with state_lock:
                        state["bytes"] += len(block)
                if expected and attempt_bytes != expected:
                    raise DownloadError("DASH byte-range response ended early")
                output.flush()
                os.fsync(output.fileno())
            os.replace(staging, destination)
            with state_lock:
                state["completed"] += 1
                elapsed = max(0.001, time.monotonic() - progress.started)
                progress.report({
                    "status": "downloading",
                    "bytes": state["bytes"],
                    "total": 0,
                    "progress": state["completed"] / max(1, state["resources"]),
                    "speed": int(state["bytes"] / elapsed),
                    "message": f"DASH 分片 {state['completed']}/{state['resources']}",
                }, force=state["completed"] >= state["resources"])
            return destination
        except Cancelled:
            staging.unlink(missing_ok=True)
            raise
        except NetworkPolicyDownloadError:
            staging.unlink(missing_ok=True)
            abort.set()
            raise
        except Exception as error:  # noqa: BLE001 - retry transport failures
            last_error = error
            staging.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            if attempt_bytes:
                with state_lock:
                    state["bytes"] = max(0, state["bytes"] - attempt_bytes)
            if attempt < 3:
                _retry_wait(cancel, min(4.0, 0.35 * (2**attempt)), abort)
        finally:
            if response is not None:
                response.close()
    raise DownloadError(f"DASH resource failed: {last_error}")


def _download_dash_track(
    track: DashTrack,
    work_dir: Path,
    headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    state: dict[str, int],
    state_lock: threading.Lock,
) -> Path:
    abort = threading.Event()
    track_dir = work_dir / f"{track.kind}-{safe_filename(track.representation_id or 'default')}"
    track_dir.mkdir(mode=0o700, exist_ok=True)
    worker_count = max(1, min(24, workers))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=worker_count)
    paths: list[Path] = []
    try:
        arguments = (
            (
                resource,
                track_dir / f"{index:08d}.part",
                headers,
                cancel,
                abort,
                progress,
                state,
                state_lock,
            )
            for index, resource in enumerate(track.resources)
        )
        paths.extend(_bounded_executor_results(
            pool,
            _fetch_dash_resource,
            arguments,
            max_pending=worker_count * 2,
        ))
    except Exception:
        abort.set()
        raise
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    paths.sort()
    joined = work_dir / f"{track.kind}.mp4"
    fd = _open_private(joined, truncate=True)
    with os.fdopen(fd, "wb", closefd=True) as output:
        for path in paths:
            with path.open("rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
        output.flush()
        os.fsync(output.fileno())
    return joined


def dash_static_download(
    manifest_url: str,
    manifest: str,
    target: Path,
    headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str,
    *,
    extract_audio: bool = False,
    selected_representation_index: int | None = None,
) -> Path:
    tracks = plan_static_dash(
        manifest,
        manifest_url,
        selected_representation_index=selected_representation_index,
    )
    authorize_network_urls(
        (resource.url for track in tracks for resource in track.resources),
        purpose="DASH manifest child",
    )
    resource_headers = scope_subresource_headers(
        manifest_url,
        (resource.url for track in tracks for resource in track.resources),
        headers,
    )
    video = next((track for track in tracks if track.kind == "video"), None)
    audio = next((track for track in tracks if track.kind == "audio"), None)
    if extract_audio and audio is None:
        raise UnsupportedDashError("the selected DASH MPD has no audio Representation")
    if extract_audio:
        tracks = [audio]
    work_dir = resume_segment_work_dir(target, manifest_url, "havre-dash-", "dash")
    state = {"bytes": 0, "completed": 0, "resources": sum(len(track.resources) for track in tracks)}
    state_lock = threading.Lock()
    keep_work_dir = False
    try:
        local: dict[str, Path] = {}
        for track in tracks:
            local[track.kind] = _download_dash_track(track, work_dir, resource_headers, workers, cancel, progress, state, state_lock)
        progress.status("remuxing", "正在合并 DASH 音视频")
        if extract_audio:
            args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(local["audio"]), "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-progress", "pipe:1", "-nostats", str(target)]
        elif "video" in local and "audio" in local:
            args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(local["video"]), "-i", str(local["audio"]), "-map", "0:v:0?", "-map", "1:a:0?", *output_codecs(target), "-progress", "pipe:1", "-nostats", str(target)]
        else:
            source = local.get("video") or local["audio"]
            args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(source), "-map", "0:v:0?", "-map", "0:a:0?", *output_codecs(target), "-progress", "pipe:1", "-nostats", str(target)]
        return run_ffmpeg(args, target, cancel, progress)
    except Cancelled:
        if is_pause(cancel):
            keep_work_dir = True
            write_segment_checkpoint(target, manifest_url, work_dir, "dash")
        raise
    finally:
        if not keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)


def select_hls_media(
    url: str,
    headers: dict[str, str],
    variant_url: str | None = None,
    cancel: threading.Event | None = None,
) -> tuple[HlsPlaylist, str, HlsPlaylist | None, dict[str, Any] | None]:
    fetched = fetch_manifest(url, headers, cancel)
    text = fetched.text
    playlist = parse_hls(text, fetched.final_url)
    playlist.request_headers = fetched.request_headers
    master: HlsPlaylist | None = None
    selected: dict[str, Any] | None = None
    if variant_url and not playlist.variants:
        raise DownloadError("The selected HLS variant is no longer present; refresh the page and choose again")
    if playlist.variants:
        master = playlist
        selected = next((item for item in playlist.variants if variant_url and item["url"] == variant_url), None)
        if variant_url and selected is None:
            raise DownloadError("The selected HLS variant is no longer present; refresh the page and choose again")
        selected = selected or max(playlist.variants, key=lambda item: (item["height"], item["bandwidth"]))
        fetched = fetch_manifest(
            selected["url"],
            scope_subresource_headers(master.url, [selected["url"]], master.request_headers),
            cancel,
        )
        text = fetched.text
        playlist = parse_hls(text, fetched.final_url)
        playlist.request_headers = fetched.request_headers
    return playlist, text, master, selected


def hls_media_duration(playlist: HlsPlaylist) -> float:
    """Return a trustworthy finite VOD duration from EXTINF values."""
    if playlist.live:
        return 0.0
    return sum(
        segment.duration
        for segment in playlist.segments
        if math.isfinite(segment.duration) and segment.duration > 0
    )


def authorize_hls_playlist(playlist: HlsPlaylist, *, purpose: str = "HLS manifest child") -> None:
    children = [
        *(item["url"] for item in playlist.variants),
        *(item["url"] for item in playlist.audio_tracks),
        *(segment.url for segment in playlist.segments),
        *playlist.key_urls,
    ]
    if playlist.init_map:
        children.append(playlist.init_map)
    authorize_network_urls(children, purpose=purpose)


def select_hls_audio_rendition(master: HlsPlaylist, selected: dict[str, Any] | None) -> dict[str, Any] | None:
    """Select the preferred external audio rendition for a video variant."""
    if not selected or not selected.get("audio_group"):
        return None
    group = selected["audio_group"]
    tracks = [track for track in master.audio_tracks if track.get("GROUP-ID") == group]
    if not tracks:
        raise DownloadError("Selected HLS variant references a missing external audio group")
    return max(
        tracks,
        key=lambda track: (
            str(track.get("DEFAULT", "")).upper() == "YES",
            str(track.get("AUTOSELECT", "")).upper() == "YES",
        ),
    )


def validate_hls_static_media(
    playlist: HlsPlaylist,
    *,
    label: str = "",
    require_segments: bool = True,
) -> None:
    """Fail closed for media playlists that the pinned static path cannot join."""
    scope = f"{label} HLS" if label else "HLS"
    if playlist.protection == "drm":
        raise DownloadError(f"DRM/SAMPLE-AES {scope} is metadata-only")
    # AES-128 playlists pass: segments stage raw and FFmpeg's local HLS
    # demuxer decrypts them against a rewritten local playlist.
    if playlist.live:
        raise DownloadError(f"Live {scope} recording is not supported in Havre {VERSION}")
    if playlist.discontinuity:
        raise DownloadError(f"Discontinuous {scope} is not supported in Havre {VERSION}")
    if playlist.separate_audio:
        raise DownloadError(f"Nested separate-audio {scope} is not supported")
    if require_segments and not playlist.segments:
        raise DownloadError(f"{scope} playlist has no downloadable static VOD segments")


def hls_fast_download(
    url: str,
    target: Path,
    headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str | None,
    variant_url: str | None = None,
    live_duration: int = 0,
    extract_audio: bool = False,
    audio_url: str | None = None,
) -> Path:
    if cancel.is_set():
        raise Cancelled()
    progress.status("starting", "正在获取播放列表")
    playlist, playlist_text, master, selected = select_hls_media(url, headers, variant_url, cancel)
    authorize_hls_playlist(playlist)
    if master:
        authorize_hls_playlist(master)

    if master and master.protection == "drm":
        raise DownloadError("DRM/SAMPLE-AES HLS is metadata-only")

    audio_rendition = select_hls_audio_rendition(master, selected) if master else None
    # Rendition-style players never expose a master playlist. The extension
    # probes the sibling media playlists and passes the best audio one here.
    explicit_audio_url = valid_url(audio_url) if audio_url else None
    wants_separate_audio = audio_rendition is not None or explicit_audio_url is not None
    # The selected video media is fetched first. Validate it before following
    # an alternate rendition so a protected/complex playlist cannot cause
    # extra network activity before the static-mode decision is made.
    validate_hls_static_media(
        playlist,
        require_segments=not (extract_audio and wants_separate_audio),
    )
    if wants_separate_audio and not ffmpeg:
        raise DownloadError("Separate-audio HLS requires FFmpeg")
    if extract_audio and not ffmpeg:
        raise DownloadError("HLS audio extraction requires FFmpeg")

    audio_playlist: HlsPlaylist | None = None
    audio_master: HlsPlaylist | None = None
    audio_selected: dict[str, Any] | None = None
    if audio_rendition:
        resolved_audio_url = audio_rendition["url"]
        audio_playlist, audio_playlist_text, audio_master, audio_selected = select_hls_media(
            resolved_audio_url,
            scope_subresource_headers(master.url, [resolved_audio_url], master.request_headers),
            cancel=cancel,
        )
        authorize_hls_playlist(audio_playlist, purpose="HLS audio manifest child")
        if audio_master:
            authorize_hls_playlist(audio_master, purpose="HLS audio master child")
            if audio_master.protection == "drm":
                raise DownloadError("DRM/SAMPLE-AES audio HLS is metadata-only")
            if select_hls_audio_rendition(audio_master, audio_selected):
                raise DownloadError("Nested separate-audio HLS is not supported")
    elif explicit_audio_url:
        audio_playlist, audio_playlist_text, audio_master, audio_selected = select_hls_media(
            explicit_audio_url,
            headers,
            cancel=cancel,
        )
        authorize_hls_playlist(audio_playlist, purpose="HLS audio manifest child")
        if audio_master:
            authorize_hls_playlist(audio_master, purpose="HLS audio master child")
            if audio_master.protection == "drm":
                raise DownloadError("DRM/SAMPLE-AES audio HLS is metadata-only")
            if select_hls_audio_rendition(audio_master, audio_selected):
                raise DownloadError("Nested separate-audio HLS is not supported")

    if audio_playlist:
        validate_hls_static_media(audio_playlist, label="audio")

    planned_playlists: list[tuple[str, HlsPlaylist, str]]
    if extract_audio and audio_playlist:
        planned_playlists = [("audio", audio_playlist, audio_playlist_text)]
    elif audio_playlist:
        planned_playlists = [("video", playlist, playlist_text), ("audio", audio_playlist, audio_playlist_text)]
    else:
        planned_playlists = [("media", playlist, playlist_text)]
    # AES-128 segments are staged raw and decrypted by FFmpeg's local HLS
    # demuxer against a rewritten local playlist; no network access past the
    # pinned client, and no plaintext without FFmpeg present.
    if any(current.encrypted and current.protection == "aes128" for _label, current, _text in planned_playlists) and not ffmpeg:
        raise DownloadError("AES-128 HLS requires FFmpeg")

    temp_dir = resume_segment_work_dir(target, url, "havre-hls-", "hls")
    total_segments = sum(
        len(current.segments) + (1 if current.init_map else 0)
        for _label, current, _text in planned_playlists
    )
    progress.total = 0
    completed = 0
    downloaded_bytes = 0
    completed_lock = threading.Lock()
    abort = threading.Event()

    def fetch_file(label: str, current: HlsPlaylist, index: int, segment: HlsSegment, dest_name: str | None = None) -> Path:
        nonlocal completed, downloaded_bytes
        if cancel.is_set():
            raise Cancelled()
        if abort.is_set():
            raise DownloadError("HLS download aborted")
        dest = temp_dir / label / (dest_name or f"{index:08d}.part")
        staging = dest.with_name(dest.name + ".tmp")
        extra: dict[str, str] = {}
        expected_size = 0
        if segment.byte_range:
            amount_offset = segment.byte_range.split("@", 1)
            if len(amount_offset) == 2:
                amount, offset = map(int, amount_offset)
                expected_size = amount
                extra["Range"] = f"bytes={offset}-{offset + amount - 1}"
        # Objects renamed into place by an earlier, paused attempt are complete.
        if staged_file_complete(dest, expected_size):
            with completed_lock:
                completed += 1
                downloaded_bytes += dest.stat().st_size
                elapsed = max(0.001, time.monotonic() - progress.started)
                progress.report({"status": "downloading", "bytes": downloaded_bytes, "total": 0, "progress": completed / total_segments, "speed": int(downloaded_bytes / elapsed), "message": f"分片 {completed}/{total_segments}"}, force=completed >= total_segments)
            return dest
        last_error: Exception | None = None
        for attempt in range(6):
            response = None
            attempt_bytes = 0
            try:
                response = request(
                    segment.url,
                    scope_subresource_headers(current.url, [segment.url], current.request_headers),
                    timeout=45,
                    extra=extra,
                )
                if segment.byte_range:
                    amount, offset = map(int, segment.byte_range.split("@", 1))
                    validate_range_response(response, offset, offset + amount - 1)
                elif response.status != 200:
                    raise DownloadError("Unexpected HLS segment response status")
                fd = _open_private(staging, truncate=True)
                with os.fdopen(fd, "wb", closefd=True) as output:
                    while True:
                        if cancel.is_set():
                            raise Cancelled()
                        if abort.is_set():
                            raise DownloadError("HLS download aborted")
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        output.write(block)
                        attempt_bytes += len(block)
                        with completed_lock:
                            downloaded_bytes += len(block)
                    if segment.byte_range and attempt_bytes != int(segment.byte_range.split("@", 1)[0]):
                        raise DownloadError("HLS byte-range response ended early")
                    output.flush()
                    os.fsync(output.fileno())
                # Only a whole object becomes reusable staging state.
                os.replace(staging, dest)
                with completed_lock:
                    completed += 1
                    elapsed = max(0.001, time.monotonic() - progress.started)
                    progress.report({"status": "downloading", "bytes": downloaded_bytes, "total": 0, "progress": completed / total_segments, "speed": int(downloaded_bytes / elapsed), "message": f"分片 {completed}/{total_segments}"}, force=completed >= total_segments)
                return dest
            except Cancelled:
                staging.unlink(missing_ok=True)
                raise
            except NetworkPolicyDownloadError:
                staging.unlink(missing_ok=True)
                abort.set()
                raise
            except Exception as error:  # noqa: BLE001
                last_error = error
                if attempt_bytes:
                    with completed_lock:
                        downloaded_bytes = max(0, downloaded_bytes - attempt_bytes)
                staging.unlink(missing_ok=True)
                dest.unlink(missing_ok=True)
                if attempt < 5:
                    _retry_wait(cancel, min(8.0, 0.5 * (2**attempt)), abort)
            finally:
                if response is not None:
                    response.close()
        raise DownloadError(f"HLS {label} segment {index} failed: {last_error}")

    def fetch_hls_key(current: HlsPlaylist, key_url: str, dest: Path) -> None:
        last_error: Exception | None = None
        for attempt in range(5):
            response = None
            try:
                response = request(
                    key_url,
                    scope_subresource_headers(current.url, [key_url], current.request_headers),
                    timeout=30,
                )
                key_bytes = response.read(32)
                if len(key_bytes) != 16:
                    raise DownloadError(f"HLS key response has {len(key_bytes)} bytes, expected 16")
                fd = _open_private(dest, truncate=True)
                with os.fdopen(fd, "wb", closefd=True) as output:
                    output.write(key_bytes)
                    output.flush()
                    os.fsync(output.fileno())
                return
            except Cancelled:
                raise
            except NetworkPolicyDownloadError:
                raise
            except Exception as error:  # noqa: BLE001 - retry transient key fetches
                last_error = error
                dest.unlink(missing_ok=True)
                if attempt < 4:
                    _retry_wait(cancel, min(8.0, 0.5 * (2**attempt)))
            finally:
                if response is not None:
                    response.close()
        raise DownloadError(f"HLS key fetch failed: {last_error}")

    def rewrite_playlist_local(current: HlsPlaylist, text: str, key_files: dict[str, str]) -> str:
        init_name = STAGED_INIT_NAME if current.init_map else None
        segment_names = [staged_segment_name(index, segment.url) for index, segment in enumerate(current.segments)]
        rewritten: list[str] = []
        segment_cursor = 0
        for line in text.splitlines():
            if line.startswith("#EXT-X-KEY:"):
                attrs = parse_attrs(line.split(":", 1)[1])
                key_uri = attrs.get("URI", "")
                # The raw playlist may carry a relative key URI; the staged
                # map is keyed by the resolved absolute URL.
                local_name = None
                try:
                    local_name = key_files.get(str(urllib.parse.urljoin(current.url, key_uri)))
                except Exception:
                    local_name = None
                if key_uri and local_name:
                    line = re.sub(r'URI="[^"]*"', f'URI="{local_name}"', line)
            elif line.startswith("#EXT-X-MAP:") and init_name:
                line = re.sub(r'URI="[^"]*"', f'URI="{init_name}"', line)
            elif line and not line.startswith("#"):
                if segment_cursor < len(segment_names):
                    line = segment_names[segment_cursor]
                    segment_cursor += 1
            rewritten.append(line)
        return "\n".join(rewritten) + "\n"

    def stage_playlist(label: str, current: HlsPlaylist, text: str) -> Path:
        track_dir = temp_dir / label
        track_dir.mkdir(mode=0o700, exist_ok=True)
        init_file: Path | None = None
        if current.init_map:
            init_file = fetch_file(
                label,
                current,
                -1,
                HlsSegment(current.init_map, byte_range=current.init_map_range),
                dest_name=STAGED_INIT_NAME,
            )
        worker_count = max(1, min(24, workers))
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=worker_count)
        files: list[Path] = []
        try:
            arguments = (
                (label, current, index, segment, staged_segment_name(index, segment.url))
                for index, segment in enumerate(current.segments)
            )
            files.extend(_bounded_executor_results(
                pool,
                fetch_file,
                arguments,
                max_pending=worker_count * 2,
            ))
        except Exception:
            abort.set()
            raise
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
        files.sort()
        if cancel.is_set():
            raise Cancelled()
        if current.encrypted and current.protection == "aes128":
            # Stage the raw (still encrypted) objects plus the key material and
            # hand FFmpeg a local playlist; decryption happens inside the local
            # HLS demuxer with no further network access.
            key_files: dict[str, str] = {}
            for key_index, key_url in enumerate(dict.fromkeys(current.key_urls)):
                key_name = f"key{key_index}.bin"
                fetch_hls_key(current, key_url, track_dir / key_name)
                key_files[key_url] = key_name
            index_file = temp_dir / label / "index.m3u8"
            fd = _open_private(index_file, truncate=True)
            with os.fdopen(fd, "w", closefd=True) as output:
                output.write(rewrite_playlist_local(current, text, key_files))
                output.flush()
                os.fsync(output.fileno())
            return index_file
        joined = temp_dir / f"joined-{label}{'.mp4' if init_file else '.ts'}"
        fd = _open_private(joined, truncate=True)
        with os.fdopen(fd, "wb", closefd=True) as output:
            if init_file:
                with init_file.open("rb") as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
            for path in files:
                with path.open("rb") as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        return joined

    keep_work_dir = False
    try:
        local = {
            label: stage_playlist(label, current, text)
            for label, current, text in planned_playlists
        }
        def input_args(path: Path) -> list[str]:
            # Staged AES playlists reference locally renamed objects; the hls
            # demuxer needs the permissive extension flag to open them. The
            # crypto protocol whitelist is granted per-input by
            # local_only_ffmpeg_args for staged .m3u8 files only.
            return (["-allowed_extensions", "ALL"] if path.suffix == ".m3u8" else []) + ["-i", str(path)]

        if extract_audio:
            assert ffmpeg is not None
            source_playlist = audio_playlist or playlist
            source = local["audio"] if audio_playlist else local["media"]
            progress.status("remuxing", "正在从本地媒体提取音频")
            args = [
                ffmpeg,
                "-hide_banner",
                "-nostdin",
                "-y",
                *input_args(source),
                "-vn",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "2",
                "-progress",
                "pipe:1",
                "-nostats",
                str(target),
            ]
            return run_ffmpeg(
                args,
                target,
                cancel,
                progress,
                expected_duration=hls_media_duration(source_playlist),
                activity="正在从本地媒体提取音频",
                report_output_speed=False,
            )
        if audio_playlist:
            assert ffmpeg is not None
            progress.status("remuxing", "正在无损合并 HLS 音视频")
            args = [
                ffmpeg,
                "-hide_banner",
                "-nostdin",
                "-y",
                *input_args(local["video"]),
                *input_args(local["audio"]),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                *output_codecs(target),
                "-progress",
                "pipe:1",
                "-nostats",
                str(target),
            ]
            return run_ffmpeg(
                args,
                target,
                cancel,
                progress,
                expected_duration=hls_media_duration(playlist),
                activity="正在无损合并 HLS 音视频",
            )
        joined = local["media"]
        if ffmpeg:
            progress.status("remuxing", "正在无损封装")
            if joined.suffix == ".m3u8":
                args = [
                    ffmpeg,
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    *input_args(joined),
                    "-map",
                    "0:v:0?",
                    "-map",
                    "0:a:0?",
                    *output_codecs(target),
                    "-progress",
                    "pipe:1",
                    "-nostats",
                    str(target),
                ]
                return run_ffmpeg(
                    args,
                    target,
                    cancel,
                    progress,
                    expected_duration=hls_media_duration(playlist),
                )
            return ffmpeg_remux(joined, target, cancel, progress, ffmpeg)
        if target.suffix.lower() != joined.suffix:
            target = unique_path(target.parent, f"{target.stem}{joined.suffix}")
        joined.chmod(0o600)
        return commit_file(joined, target)
    except Cancelled:
        if is_pause(cancel):
            # Keep every whole segment; the next job with this name reuses them.
            keep_work_dir = True
            write_segment_checkpoint(target, url, temp_dir, "hls")
        raise
    finally:
        if not keep_work_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


def external_network_process_error(tool: str) -> DownloadError:
    return DownloadError(
        f"{tool} 直接联网已由安全策略关闭；请使用内置受控下载路径。"
        "此媒体结构需要后续 pinned broker 支持"
    )


def ffmpeg_download(
    url: str,
    target: Path,
    headers: dict[str, str],
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str,
    *,
    duration: int = 0,
    extract_audio: bool = False,
    expected_duration: float = 0,
) -> Path:
    del url, target, headers, cancel, progress, ffmpeg, duration, extract_audio, expected_duration
    raise external_network_process_error("FFmpeg")


def ffmpeg_remux(source: Path, target: Path, cancel: threading.Event, progress: Progress, ffmpeg: str) -> Path:
    args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(source), "-map", "0:v:0?", "-map", "0:a:0?", *output_codecs(target), "-progress", "pipe:1", "-nostats", str(target)]
    # The source is a finished local file, so its duration is known up front
    # and the conversion phase can report a real 0–100% instead of nothing.
    duration = float(describe_media(source, ffmpeg).get("duration") or 0)
    return run_ffmpeg(args, target, cancel, progress, expected_duration=duration, activity="正在转换格式")


def ffmpeg_download_pair(
    video_url: str,
    audio_url: str,
    target: Path,
    headers: dict[str, str],
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str,
    *,
    duration: int = 0,
) -> Path:
    del video_url, audio_url, target, headers, cancel, progress, ffmpeg, duration
    raise external_network_process_error("FFmpeg")


def dash_pair_download(
    video_url: str,
    audio_url: str,
    target: Path,
    video_headers: dict[str, str],
    audio_headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str,
    *,
    expected_duration: float = 0,
    expires_at: float = 0,
) -> Path:
    """Download two complete direct DASH tracks, then mux them locally."""
    video_url = valid_url(video_url)
    audio_url = valid_url(audio_url)
    if video_url == audio_url:
        raise DownloadError("DASH pair video and audio URLs must be different")
    if target.suffix.lower() != ".mp4":
        raise DownloadError("DASH pair output must use the MP4 container")
    if not ffmpeg:
        raise DownloadError("DASH pair download requires FFmpeg")
    if cancel.is_set():
        raise Cancelled()

    work_dir = Path(tempfile.mkdtemp(prefix=DASH_PAIR_WORK_PREFIX, dir=str(target.parent)))
    video_path = work_dir / "video.m4s"
    audio_path = work_dir / "audio.m4s"
    aggregate = _DashPairProgress(progress)
    try:
        # Check both signatures immediately before starting either request. The
        # two complete tracks then transfer in parallel, so a long video cannot
        # consume the audio URL's remaining signed lifetime first.
        ensure_dash_pair_fresh(expires_at, "视频轨启动")
        ensure_dash_pair_fresh(expires_at, "音频轨启动")
        per_track_workers = max(1, min(12, workers))

        def fetch_track(kind: str, source: str, local: Path, scoped_headers: dict[str, str]) -> Path:
            try:
                multipart_download(
                    source,
                    local,
                    scoped_headers,
                    per_track_workers,
                    cancel,
                    aggregate.track(kind),
                    allow_resume=False,
                )
                aggregate.complete(kind, local.stat().st_size)
                return local
            except Cancelled:
                raise
            except Exception as error:  # noqa: BLE001 - identify the failing track
                label = "video" if kind == "video" else "audio"
                raise DownloadError(f"DASH {label} track download failed: {error}") from error

        pool = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="havre-dash-pair")
        futures = [
            _submit_with_context(pool, fetch_track, "video", video_url, video_path, video_headers),
            _submit_with_context(pool, fetch_track, "audio", audio_url, audio_path, audio_headers),
        ]
        first_error: Exception | None = None
        try:
            for future in concurrent.futures.as_completed(futures):
                try:
                    future.result()
                except Exception as error:  # retain the first actionable track failure
                    if first_error is None:
                        first_error = error
                    cancel.set()
                    for pending in futures:
                        pending.cancel()
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
        if first_error is not None:
            raise first_error

        if cancel.is_set():
            raise Cancelled()
        progress.emit({
            "type": "progress",
            "jobId": progress.job_id,
            "filename": progress.filename,
            "status": "remuxing",
            "bytes": progress.done,
            "total": progress.total,
            "progress": 0.9,
            "speed": 0,
            "message": "正在无损合并 DASH 音视频",
        })
        args = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(video_path),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            str(target),
        ]
        try:
            return run_ffmpeg(
                args,
                target,
                cancel,
                _ScaledFfmpegProgress(progress),
                expected_duration=expected_duration,
                activity="正在无损合并 DASH 音视频",
            )
        except Cancelled:
            raise
        except Exception as error:  # noqa: BLE001 - make the merge phase explicit
            raise DownloadError(f"DASH audio/video merge failed: {error}") from error
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def dash_pair_audio_download(
    audio_url: str,
    target: Path,
    audio_headers: dict[str, str],
    workers: int,
    cancel: threading.Event,
    progress: Progress,
    ffmpeg: str,
    *,
    expected_duration: float = 0,
    expires_at: float = 0,
) -> Path:
    """Download only a direct DASH audio track and encode it as MP3."""
    audio_url = valid_url(audio_url)
    if target.suffix.lower() != ".mp3":
        raise DownloadError("DASH pair audio extraction must use an MP3 output")
    if not ffmpeg:
        raise DownloadError("DASH pair audio extraction requires FFmpeg")
    if cancel.is_set():
        raise Cancelled()

    work_dir = Path(tempfile.mkdtemp(prefix=DASH_PAIR_WORK_PREFIX, dir=str(target.parent)))
    audio_path = work_dir / "audio.m4s"
    aggregate = _DashPairProgress(progress, {"video": 0.0, "audio": 0.9})
    try:
        ensure_dash_pair_fresh(expires_at, "音频轨启动")
        try:
            multipart_download(
                audio_url,
                audio_path,
                audio_headers,
                workers,
                cancel,
                aggregate.track("audio"),
                allow_resume=False,
            )
            aggregate.complete("audio", audio_path.stat().st_size)
        except Cancelled:
            raise
        except Exception as error:  # noqa: BLE001 - identify the failing track
            raise DownloadError(f"DASH audio track download failed: {error}") from error

        if cancel.is_set():
            raise Cancelled()
        progress.emit({
            "type": "progress",
            "jobId": progress.job_id,
            "filename": progress.filename,
            "status": "remuxing",
            "bytes": progress.done,
            "total": progress.total,
            "progress": 0.9,
            "speed": 0,
            "message": "正在提取音频",
        })
        args = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(audio_path),
            "-vn",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            "-progress",
            "pipe:1",
            "-nostats",
            str(target),
        ]
        try:
            return run_ffmpeg(
                args,
                target,
                cancel,
                _ScaledFfmpegProgress(progress),
                expected_duration=expected_duration,
                activity="正在提取音频",
                report_output_speed=False,
            )
        except Cancelled:
            raise
        except Exception as error:  # noqa: BLE001 - make the conversion phase explicit
            raise DownloadError(f"DASH audio extraction failed: {error}") from error
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def output_codecs(target: Path) -> list[str]:
    if target.suffix.lower() == ".webm":
        return ["-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-c:a", "libopus", "-b:a", "160k"]
    return ["-c", "copy"]


def bounded_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(minimum, min(maximum, number))


def bounded_float(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    if not math.isfinite(number):
        return default
    return max(minimum, min(maximum, number))


def _ffmpeg_clock(value: str) -> float:
    parts = value.strip().split(":")
    if len(parts) != 3:
        return 0.0
    try:
        hours, minutes, seconds = float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return 0.0
    result = hours * 3600 + minutes * 60 + seconds
    return result if math.isfinite(result) and result >= 0 else 0.0


def _media_time(value: float) -> str:
    total = max(0, int(value))
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def local_only_ffmpeg_args(args: list[str]) -> list[str]:
    """Pin every FFmpeg input to an existing local file.

    FFmpeg demuxers may otherwise follow URLs embedded in a downloaded file.
    A per-input protocol whitelist makes that fail closed even when content is
    mislabeled as a regular media file. The progress channel is process stdout,
    not an FFmpeg input protocol, so only ``file`` is permitted here.
    """
    result: list[str] = []
    index = 0
    while index < len(args):
        value = args[index]
        if value != "-i":
            result.append(value)
            index += 1
            continue
        if index + 1 >= len(args):
            raise DownloadError("Internal FFmpeg input argument is missing")
        source = args[index + 1]
        source_path = Path(source)
        if not source_path.is_absolute() or source_path.is_symlink() or not source_path.is_file():
            raise DownloadError("FFmpeg input must be an existing local regular file")
        # Staged AES playlists open their locally staged encrypted segments
        # through the crypto protocol; it only ever wraps local files, so the
        # no-network guarantee holds. Everything else stays file-only.
        whitelist = "file,crypto" if source_path.suffix == ".m3u8" else "file"
        result.extend(["-protocol_whitelist", whitelist, "-i", str(source_path)])
        index += 2
    return result


def resource_limited_ffmpeg_args(args: list[str]) -> list[str]:
    """Apply small deterministic CPU limits without enabling new protocols."""
    if len(args) < 2:
        raise DownloadError("Internal FFmpeg argument list is incomplete")
    return [
        *args[:-1],
        "-threads",
        str(FFMPEG_MAX_THREADS),
        "-filter_threads",
        str(max(1, FFMPEG_MAX_THREADS // 2)),
        "-filter_complex_threads",
        str(max(1, FFMPEG_MAX_THREADS // 2)),
        args[-1],
    ]


def run_ffmpeg(
    args: list[str],
    target: Path,
    cancel: threading.Event,
    progress: Progress,
    *,
    expected_duration: float = 0,
    activity: str = "正在处理媒体",
    report_output_speed: bool = True,
) -> Path:
    if not args or args[-1] != str(target):
        raise DownloadError("Internal FFmpeg output argument mismatch")
    if target.exists() or target.is_symlink():
        raise DownloadError("Output filename became occupied")
    staging = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.part{target.suffix}")
    process_args = resource_limited_ffmpeg_args(
        local_only_ffmpeg_args([*args[:-1], str(staging)])
    )
    error_log = tempfile.TemporaryFile(mode="w+b")
    proc: subprocess.Popen[bytes] | None = None
    selector = selectors.DefaultSelector()
    stdout_buffer = bytearray()
    total_size = 0
    out_time = 0.0
    media_rate = 0.0
    saw_out_time_us = False
    started = time.monotonic()
    last_emit = 0.0
    success = False

    def emit_ffmpeg_progress(phase: str) -> None:
        nonlocal last_emit
        now = time.monotonic()
        if phase != "end" and now - last_emit < 0.25:
            return
        last_emit = now
        elapsed = max(0.001, now - started)
        effective_rate = media_rate if media_rate > 0 else out_time / elapsed
        known_duration = expected_duration if math.isfinite(expected_duration) and expected_duration > 0 else 0.0
        fraction = min(1.0 if phase == "end" else 0.99, out_time / known_duration) if known_duration else 0.0
        detail = activity
        if out_time > 0:
            if known_duration:
                detail += f" · {_media_time(out_time)} / {_media_time(known_duration)}"
            else:
                detail += f" · 已处理 {_media_time(out_time)}"
        if effective_rate > 0 and math.isfinite(effective_rate):
            detail += f" · {effective_rate:.2f}×"
        event: dict[str, Any] = {
            "type": "progress",
            "jobId": progress.job_id,
            "filename": progress.filename,
            # A local FFmpeg pass is its own phase. Reporting it as
            # "downloading" made a finished transfer's bar snap back to 0%.
            "status": "remuxing",
            "bytes": total_size,
            "total": 0,
            # FFmpeg exposes output size, not network input bytes. For MP3 this
            # is essentially the encoded bitrate, so presenting it as download
            # throughput is misleading; the processing multiplier above is the
            # honest speed signal.
            "speed": int(total_size / elapsed) if report_output_speed else 0,
            "message": detail,
        }
        # Without a known duration there is no honest fraction; omit the key
        # so the extension keeps the last value instead of resetting the bar.
        if known_duration or phase == "end":
            event["progress"] = fraction
        progress.emit(event)

    def consume_progress_line(line: str) -> None:
        nonlocal total_size, out_time, media_rate, saw_out_time_us
        key, separator, value = line.strip().partition("=")
        if not separator:
            return
        if key == "total_size":
            with contextlib.suppress(ValueError):
                total_size = max(0, int(value))
        elif key == "out_time_us":
            with contextlib.suppress(ValueError):
                candidate = int(value) / 1_000_000
                if math.isfinite(candidate) and candidate >= 0:
                    out_time = candidate
                    saw_out_time_us = True
        elif key == "out_time_ms" and not saw_out_time_us:
            # Despite its historical name, FFmpeg reports this field in
            # microseconds. Prefer out_time_us when newer builds provide both.
            with contextlib.suppress(ValueError):
                candidate = int(value) / 1_000_000
                if math.isfinite(candidate) and candidate >= 0:
                    out_time = candidate
        elif key == "out_time" and not saw_out_time_us:
            out_time = max(out_time, _ffmpeg_clock(value))
        elif key == "speed":
            with contextlib.suppress(ValueError):
                candidate = float(value.removesuffix("x"))
                if math.isfinite(candidate) and candidate >= 0:
                    media_rate = candidate
        elif key == "progress" and value in {"continue", "end"}:
            emit_ffmpeg_progress(value)

    def consume_progress_bytes(chunk: bytes, *, final: bool = False) -> None:
        stdout_buffer.extend(chunk)
        while b"\n" in stdout_buffer:
            raw_line, _, remainder = stdout_buffer.partition(b"\n")
            stdout_buffer[:] = remainder
            consume_progress_line(raw_line.decode("utf-8", "replace"))
        if final and stdout_buffer:
            consume_progress_line(stdout_buffer.decode("utf-8", "replace"))
            stdout_buffer.clear()

    try:
        proc = subprocess.Popen(
            process_args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=error_log,
            bufsize=0,
            start_new_session=True,
        )
        assert proc.stdout is not None
        selector.register(proc.stdout, selectors.EVENT_READ)
        while proc.poll() is None:
            if cancel.is_set():
                proc.terminate()
                try:
                    proc.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    proc.kill()
                raise Cancelled()
            if time.monotonic() - started > FFMPEG_MAX_WALL_SECONDS:
                proc.terminate()
                raise DownloadError("FFmpeg exceeded the processing time limit")
            if total_size > FFMPEG_MAX_OUTPUT_BYTES:
                proc.terminate()
                raise DownloadError("FFmpeg output exceeded the configured size limit")
            with contextlib.suppress(OSError):
                if staging.exists() and staging.stat().st_size > FFMPEG_MAX_OUTPUT_BYTES:
                    proc.terminate()
                    raise DownloadError("FFmpeg output exceeded the configured size limit")
            events = selector.select(timeout=0.25)
            for key, _mask in events:
                consume_progress_bytes(os.read(key.fileobj.fileno(), 64 * 1024))
        # The process can exit with one final progress block still buffered.
        while chunk := os.read(proc.stdout.fileno(), 64 * 1024):
            consume_progress_bytes(chunk)
        consume_progress_bytes(b"", final=True)
        if proc.returncode != 0:
            error_log.seek(0)
            tail = error_log.read().decode("utf-8", "replace")[-4000:]
            raise DownloadError(f"FFmpeg failed ({proc.returncode}): {redact_text(tail.strip())}")
        if not staging.exists() or staging.stat().st_size == 0:
            raise DownloadError("FFmpeg produced no output")
        staging.chmod(0o600)
        target = commit_file(staging, target)
        success = True
        return target
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        selector.close()
        if proc is not None and proc.stdout is not None:
            proc.stdout.close()
        error_log.close()
        if not success:
            staging.unlink(missing_ok=True)


class ExternalToolBroker:
    """Loopback HTTP CONNECT proxy that brokers an external tool's connections.

    yt-dlp owns its DNS lookups, redirects and child-resource connections, so
    it cannot use the pinned urllib client that every native transfer goes
    through. The broker closes that gap instead of opening the network: the
    tool is started with ``--proxy`` pointing at this loopback listener and a
    per-process random credential; every ``CONNECT host:port`` is resolved
    and checked against the job's NetworkPolicy; the upstream socket is
    dialled to one of the authorized addresses (or chained through the OS
    proxy when one is configured for that host) and the connected peer is
    validated before a single byte is relayed. Loopback, private, link-local,
    multicast, unspecified, reserved and metadata targets therefore fail
    closed exactly as they do for the native client, while TLS stays end to
    end between the tool and the origin. Only ports 80 and 443 are brokered
    and only CONNECT is accepted, so the tool cannot turn the broker into a
    plain-HTTP side door.
    """

    def __init__(self, policy: NetworkPolicy | None = None) -> None:
        self.policy = policy or current_network_policy()
        self.username = "havre"
        self.token = base64.urlsafe_b64encode(os.urandom(24)).decode("ascii").rstrip("=")
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(16)
        self._server.settimeout(0.5)
        self.port = int(self._server.getsockname()[1])
        self._closed = threading.Event()
        self._lock = threading.Lock()
        self._sockets: set[socket.socket] = set()
        self.tunnels = 0
        self.rejections: list[str] = []
        self._thread = threading.Thread(target=self._serve, name="havre-broker", daemon=True)
        self._thread.start()

    @property
    def proxy_url(self) -> str:
        return f"http://{self.username}:{self.token}@127.0.0.1:{self.port}"

    def close(self) -> None:
        self._closed.set()
        with contextlib.suppress(OSError):
            self._server.close()
        with self._lock:
            sockets = list(self._sockets)
        for sock in sockets:
            with contextlib.suppress(OSError):
                sock.shutdown(socket.SHUT_RDWR)
            with contextlib.suppress(OSError):
                sock.close()
        self._thread.join(timeout=2)

    def _serve(self) -> None:
        while not self._closed.is_set():
            try:
                conn, _peer = self._server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self._lock:
                if len(self._sockets) >= EXTERNAL_TOOL_MAX_TUNNELS:
                    with contextlib.suppress(OSError):
                        conn.close()
                    continue
                self._sockets.add(conn)
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    @staticmethod
    def _reply(conn: socket.socket, status: int, reason: str, extra: str = "") -> None:
        with contextlib.suppress(OSError):
            conn.sendall(f"HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Length: 0\r\n{extra}\r\n".encode("latin-1"))

    def _authorized(self, header: str) -> bool:
        scheme, _, encoded = header.strip().partition(" ")
        if scheme.lower() != "basic" or not encoded:
            return False
        try:
            decoded = base64.b64decode(encoded.strip(), validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
        user, _, token = decoded.partition(":")
        return hmac.compare_digest(user, self.username) and hmac.compare_digest(token, self.token)

    @staticmethod
    def _parse_target(value: str) -> tuple[str, int]:
        text = value.strip()
        if text.startswith("["):
            host, _, port = text[1:].partition("]")
            port = port.lstrip(":")
        else:
            host, _, port = text.rpartition(":")
        host = host.strip().rstrip(".").lower()
        if not host or not port.isdigit() or not re.fullmatch(r"[a-z0-9.:_-]{1,253}", host):
            raise ValueError("Malformed CONNECT target")
        return host, int(port)

    def _dial(self, target: Any, host: str, port: int) -> socket.socket:
        proxies = _system_proxies()
        proxy = proxies.get("https") or proxies.get("http")
        if proxy and not _target_bypasses_proxy(host):
            # Same trust model as the pinned client: the OS proxy is a locally
            # trusted hop, so peer pinning cannot apply across its tunnel;
            # authorization and resolution already ran before the dial.
            parsed = urllib.parse.urlsplit(proxy if "://" in proxy else f"http://{proxy}")
            if parsed.scheme != "http" or not parsed.hostname:
                raise OSError("Unsupported system proxy")
            upstream = socket.create_connection((parsed.hostname, parsed.port or 8080), 20)
            try:
                connect = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                if parsed.username:
                    credential = base64.b64encode(f"{urllib.parse.unquote(parsed.username)}:{urllib.parse.unquote(parsed.password or '')}".encode()).decode("ascii")
                    connect += f"Proxy-Authorization: Basic {credential}\r\n"
                upstream.sendall((connect + "\r\n").encode("latin-1"))
                head = b""
                while b"\r\n\r\n" not in head:
                    chunk = upstream.recv(4096)
                    if not chunk or len(head) > 16_384:
                        raise OSError("System proxy closed the CONNECT")
                    head += chunk
                status = head.split(b"\r\n", 1)[0].split(b" ")
                if len(status) < 2 or status[1] != b"200":
                    raise OSError("System proxy refused the CONNECT")
                return upstream
            except Exception:
                upstream.close()
                raise
        last_error: Exception | None = None
        for address in sorted(target.addresses):
            upstream = None
            try:
                upstream = socket.create_connection((address, port), 20)
                self.policy.validate_peer(upstream.getpeername()[0], target)
                return upstream
            except (OSError, NetworkPolicyError) as error:
                last_error = error
                if upstream is not None:
                    upstream.close()
        if isinstance(last_error, NetworkPolicyError):
            raise last_error
        raise OSError(f"Could not connect to authorized network target {host}")

    def _handle(self, conn: socket.socket) -> None:
        upstream: socket.socket | None = None
        try:
            conn.settimeout(15)
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                head += chunk
                if len(head) > 16_384:
                    self._reply(conn, 431, "Request header too large")
                    return
            request_line, _, rest = head.partition(b"\r\n")
            parts = request_line.decode("latin-1").split(" ")
            if len(parts) != 3 or parts[0].upper() != "CONNECT":
                self._reply(conn, 405, "Only CONNECT is brokered")
                return
            headers: dict[str, str] = {}
            for line in rest.split(b"\r\n"):
                name, separator, value = line.decode("latin-1").partition(":")
                if separator:
                    headers[name.strip().lower()] = value.strip()
            if not self._authorized(headers.get("proxy-authorization", "")):
                self._reply(conn, 407, "Proxy authentication required", 'Proxy-Authenticate: Basic realm="Havre"\r\n')
                return
            host, port = self._parse_target(parts[1])
            if port not in EXTERNAL_TOOL_BROKER_PORTS:
                self._reply(conn, 403, "Port is not brokered")
                return
            target = self.policy.authorize(f"https://{host}:{port}/", purpose="external tool connection")
            upstream = self._dial(target, host, port)
            with self._lock:
                self._sockets.add(upstream)
                self.tunnels += 1
            conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            self._pump(conn, upstream)
        except NetworkPolicyError as error:
            with self._lock:
                if len(self.rejections) < 32:
                    self.rejections.append(redact_text(error))
            self._reply(conn, 403, "Blocked by Havre network policy")
        except (OSError, ValueError, UnicodeError):
            self._reply(conn, 502, "Upstream connection failed")
        finally:
            for sock in (conn, upstream):
                if sock is None:
                    continue
                with self._lock:
                    self._sockets.discard(sock)
                with contextlib.suppress(OSError):
                    sock.close()

    def _pump(self, client: socket.socket, upstream: socket.socket) -> None:
        client.settimeout(None)
        upstream.settimeout(None)
        client.setblocking(False)
        upstream.setblocking(False)
        selector = selectors.DefaultSelector()
        selector.register(client, selectors.EVENT_READ, upstream)
        selector.register(upstream, selectors.EVENT_READ, client)
        open_sides = 2
        last_activity = time.monotonic()
        try:
            while open_sides and not self._closed.is_set():
                events = selector.select(timeout=1.0)
                if not events:
                    if time.monotonic() - last_activity > EXTERNAL_TOOL_TUNNEL_IDLE_SECONDS:
                        return
                    continue
                for key, _mask in events:
                    source = key.fileobj
                    destination = key.data
                    try:
                        data = source.recv(65_536)
                    except BlockingIOError:
                        continue
                    except OSError:
                        data = b""
                    if not data:
                        selector.unregister(source)
                        open_sides -= 1
                        with contextlib.suppress(OSError):
                            destination.shutdown(socket.SHUT_WR)
                        continue
                    last_activity = time.monotonic()
                    try:
                        destination.setblocking(True)
                        destination.sendall(data)
                        destination.setblocking(False)
                    except OSError:
                        return
        finally:
            selector.close()


def _tool_path_entries(*executables: str | None) -> str:
    entries: list[str] = []
    for executable in executables:
        if executable:
            parent = str(Path(executable).resolve().parent)
            if parent not in entries:
                entries.append(parent)
    for standard in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"):
        if standard not in entries:
            entries.append(standard)
    return ":".join(entries)


def _ytdlp_environment(executable: str, ffmpeg: str | None, work_dir: Path) -> dict[str, str]:
    """A minimal environment: no inherited proxy variables, no user config."""
    return {
        "PATH": _tool_path_entries(executable, ffmpeg),
        "HOME": str(Path.home()),
        "TMPDIR": str(work_dir),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONIOENCODING": "utf-8",
        "NO_COLOR": "1",
    }


def _ytdlp_common_args(executable: str, broker: ExternalToolBroker, ffmpeg: str | None) -> list[str]:
    args = [
        executable,
        "--ignore-config",
        "--no-cache-dir",
        "--no-playlist",
        "--no-mtime",
        "--no-color",
        "--no-warnings",
        "--proxy",
        broker.proxy_url,
        "--socket-timeout",
        "30",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
    ]
    if ffmpeg:
        args.extend(["--ffmpeg-location", ffmpeg])
    return args


def ytdlp_format_args(container: str, extract_audio: bool, max_height: int = 0) -> list[str]:
    """The format selection handed to yt-dlp for one download.

    The quality the user picked becomes an upper bound on height; yt-dlp then
    merges the best video and audio below it into the requested container.
    """
    if extract_audio:
        return ["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "2"]
    height = int(max_height) if 0 < int(max_height) <= YTDLP_MAX_HEIGHT else 0
    limit = f"[height<={height}]" if height else ""
    selector = f"bv*{limit}+ba/b{limit}"
    if container == "webm":
        order = "res,vcodec:vp9,acodec:opus"
    elif container == "mkv":
        order = "res"
    else:
        container = "mp4"
        order = "res,vcodec:h264,acodec:m4a,ext"
    return ["-f", selector, "-S", order, "--merge-output-format", container, "--remux-video", container]


YTDLP_DOWNLOAD_TEMPLATE = (
    "download:HAVRE\t%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s"
    "\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.fragment_index)s\t%(progress.fragment_count)s"
)
YTDLP_POSTPROCESS_TEMPLATE = "postprocess:HAVRE_PP\t%(progress.status)s\t%(postprocessor)s"


def _ytdlp_number(value: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number >= 0 else 0.0


def _terminate_process_group(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (OSError, ProcessLookupError):
        proc.terminate()
    try:
        proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(OSError, ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        proc.kill()
        proc.wait()


def _ytdlp_output_file(work_dir: Path) -> Path | None:
    produced: list[Path] = []
    for entry in work_dir.iterdir():
        if not entry.is_file() or entry.is_symlink() or not entry.name.startswith("media."):
            continue
        if entry.name.endswith((".part", ".ytdl", ".temp")) or re.search(r"\.f[0-9a-z_-]+\.[A-Za-z0-9]+$", entry.name):
            continue
        produced.append(entry)
    if not produced:
        return None
    produced.sort(key=lambda path: path.stat().st_size, reverse=True)
    return produced[0]


def youtube_download(
    url: str,
    target: Path,
    container: str,
    extract_audio: bool,
    cancel: threading.Event,
    progress: Progress,
    executable: str | None,
    *,
    ffmpeg: str | None = None,
    max_height: int = 0,
    concurrent_fragments: int = 4,
    work_root: Path | None = None,
) -> Path:
    """Download one YouTube watch URL with yt-dlp through the loopback broker.

    yt-dlp writes into a private work directory beside the output, every
    connection it opens goes through ExternalToolBroker, and the finished file
    is published under the reserved output name without overwriting anything.
    """
    if not executable:
        raise DownloadError("yt-dlp is not installed; YouTube downloads need it")
    safe_url = valid_url(url)
    if target.exists() or target.is_symlink():
        raise DownloadError("Output filename became occupied")
    if cancel.is_set():
        raise Cancelled()
    work_dir = Path(tempfile.mkdtemp(prefix=YTDLP_WORK_PREFIX, dir=str(work_root or target.parent)))
    broker = ExternalToolBroker(current_network_policy())
    args = [
        *_ytdlp_common_args(executable, broker, ffmpeg),
        "--quiet",
        "--progress",
        "--newline",
        "--progress-template",
        YTDLP_DOWNLOAD_TEMPLATE,
        "--progress-template",
        YTDLP_POSTPROCESS_TEMPLATE,
        "--concurrent-fragments",
        str(max(1, min(8, int(concurrent_fragments or 1)))),
        "-o",
        str(work_dir / "media.%(ext)s"),
        *ytdlp_format_args(container, extract_audio, max_height),
        "--",
        safe_url,
    ]
    error_log = tempfile.TemporaryFile(mode="w+b")
    proc: subprocess.Popen[bytes] | None = None
    selector = selectors.DefaultSelector()
    stdout_buffer = bytearray()
    finished_bytes = 0
    current_bytes = 0
    current_total = 0
    started = time.monotonic()
    phase_message = "正在通过 YouTube 引擎下载"

    def consume_line(line: str) -> None:
        nonlocal finished_bytes, current_bytes, current_total, phase_message
        fields = line.rstrip("\r\n").split("\t")
        if fields[0] == "HAVRE" and len(fields) >= 8:
            status = fields[1]
            downloaded = _ytdlp_number(fields[2])
            total = _ytdlp_number(fields[3]) or _ytdlp_number(fields[4])
            speed = _ytdlp_number(fields[5])
            fragment_index = _ytdlp_number(fields[6])
            fragment_count = _ytdlp_number(fields[7])
            if status == "finished":
                finished_bytes += int(downloaded)
                current_bytes = 0
                current_total = 0
                return
            current_bytes = int(downloaded)
            current_total = int(total)
            elapsed = max(0.001, time.monotonic() - started)
            total_bytes = finished_bytes + current_total if current_total else 0
            done_bytes = finished_bytes + current_bytes
            message = phase_message
            if fragment_count > 0:
                message = f"{phase_message} · 分片 {int(fragment_index)}/{int(fragment_count)}"
            payload: dict[str, Any] = {
                "status": "downloading",
                "bytes": done_bytes,
                "total": total_bytes,
                "speed": int(speed) if speed else int(done_bytes / elapsed),
                "message": message,
            }
            if total_bytes:
                payload["progress"] = min(0.99, done_bytes / total_bytes)
            progress.report(payload)
        elif fields[0] == "HAVRE_PP" and len(fields) >= 3:
            if fields[1] == "started":
                progress.status("remuxing", f"正在合并音视频 · {fields[2]}", bytes=finished_bytes, total=0)

    def consume_bytes(chunk: bytes, *, final: bool = False) -> None:
        stdout_buffer.extend(chunk)
        while b"\n" in stdout_buffer:
            raw_line, _, remainder = stdout_buffer.partition(b"\n")
            stdout_buffer[:] = remainder
            consume_line(raw_line.decode("utf-8", "replace"))
        if final and stdout_buffer:
            consume_line(stdout_buffer.decode("utf-8", "replace"))
            stdout_buffer.clear()

    success = False
    try:
        progress.status("starting", "正在启动 YouTube 引擎")
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=error_log,
            bufsize=0,
            start_new_session=True,
            cwd=str(work_dir),
            env=_ytdlp_environment(executable, ffmpeg, work_dir),
        )
        assert proc.stdout is not None
        selector.register(proc.stdout, selectors.EVENT_READ)
        while proc.poll() is None:
            if cancel.is_set():
                _terminate_process_group(proc)
                raise Cancelled()
            if time.monotonic() - started > EXTERNAL_TOOL_MAX_WALL_SECONDS:
                _terminate_process_group(proc)
                raise DownloadError("yt-dlp exceeded the processing time limit")
            for key, _mask in selector.select(timeout=0.25):
                consume_bytes(os.read(key.fileobj.fileno(), 64 * 1024))
        while chunk := os.read(proc.stdout.fileno(), 64 * 1024):
            consume_bytes(chunk)
        consume_bytes(b"", final=True)
        if proc.returncode != 0:
            error_log.seek(0)
            tail = error_log.read().decode("utf-8", "replace")[-4000:]
            rejected = "；".join(broker.rejections[-3:])
            detail = redact_text(tail.strip())
            if rejected:
                detail = f"{detail} [network policy: {rejected}]"
            raise DownloadError(f"yt-dlp failed ({proc.returncode}): {detail}")
        produced = _ytdlp_output_file(work_dir)
        if produced is None or produced.stat().st_size == 0:
            raise DownloadError("yt-dlp produced no output")
        produced.chmod(0o600)
        suffix = produced.suffix.lower()
        published_target = target if suffix == target.suffix.lower() or not re.fullmatch(r"\.[a-z0-9]{1,5}", suffix) else target.with_suffix(suffix)
        target = commit_file(produced, published_target)
        success = True
        return target
    finally:
        if proc is not None:
            _terminate_process_group(proc)
            if proc.stdout is not None:
                proc.stdout.close()
        selector.close()
        error_log.close()
        broker.close()
        shutil.rmtree(work_dir, ignore_errors=True)
        del success


def summarize_ytdlp_info(info: Any) -> dict[str, Any]:
    """Project yt-dlp's -J output onto the small shape the extension needs.

    Only the quality ladder (one entry per distinct height, best bitrate per
    height), the title, the duration and the live flag cross the Native
    Messaging channel; the format URLs, signatures and cookies stay here.
    """
    if not isinstance(info, dict):
        raise DownloadError("yt-dlp returned no media information")
    if info.get("_type") in {"playlist", "multi_video"} and isinstance(info.get("entries"), list) and info["entries"]:
        first = info["entries"][0]
        info = first if isinstance(first, dict) else info
    formats = info.get("formats")
    if not isinstance(formats, list):
        formats = [info] if info.get("url") else []
    by_height: dict[int, dict[str, Any]] = {}
    for entry in formats:
        if not isinstance(entry, dict):
            continue
        vcodec = str(entry.get("vcodec") or "none").lower()
        try:
            height = int(entry.get("height") or 0)
        except (TypeError, ValueError):
            height = 0
        if vcodec == "none" or height <= 0 or height > YTDLP_MAX_HEIGHT:
            continue
        try:
            bandwidth = int(float(entry.get("tbr") or entry.get("vbr") or 0) * 1000)
        except (TypeError, ValueError):
            bandwidth = 0
        try:
            width = int(entry.get("width") or 0)
        except (TypeError, ValueError):
            width = 0
        current = by_height.get(height)
        if current is None or bandwidth > current["bandwidth"]:
            by_height[height] = {
                "height": height,
                "width": width if width > 0 else None,
                "bandwidth": max(0, bandwidth),
                "codecs": str(entry.get("vcodec") or "")[:60],
                "ext": str(entry.get("ext") or "")[:8],
            }
    variants = [by_height[height] for height in sorted(by_height, reverse=True)][:32]
    try:
        duration = int(float(info.get("duration") or 0))
    except (TypeError, ValueError):
        duration = 0
    return {
        "title": str(info.get("title") or "")[:240],
        "duration": duration if 0 < duration < 7 * 24 * 3600 else 0,
        "live": bool(info.get("is_live")),
        "audioOnly": not variants and bool(formats),
        "variants": variants,
    }


def youtube_inspect(url: str, executable: str | None, ffmpeg: str | None = None) -> dict[str, Any]:
    """Ask yt-dlp (through the broker) which qualities a watch URL offers."""
    if not executable:
        raise DownloadError("yt-dlp is not installed; YouTube downloads need it")
    safe_url = valid_url(url)
    work_dir = Path(tempfile.mkdtemp(prefix=f"{YTDLP_WORK_PREFIX}inspect-"))
    broker = ExternalToolBroker(current_network_policy())
    proc: subprocess.Popen[bytes] | None = None
    try:
        args = [*_ytdlp_common_args(executable, broker, ffmpeg), "--quiet", "--skip-download", "-J", "--", safe_url]
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            cwd=str(work_dir),
            env=_ytdlp_environment(executable, ffmpeg, work_dir),
        )
        try:
            stdout, stderr = proc.communicate(timeout=EXTERNAL_TOOL_INSPECT_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _terminate_process_group(proc)
            raise DownloadError("yt-dlp did not answer within the inspection time limit") from None
        if proc.returncode != 0:
            tail = stderr.decode("utf-8", "replace")[-4000:]
            rejected = "；".join(broker.rejections[-3:])
            detail = redact_text(tail.strip())
            if rejected:
                detail = f"{detail} [network policy: {rejected}]"
            raise DownloadError(f"yt-dlp failed ({proc.returncode}): {detail}")
        if len(stdout) > EXTERNAL_TOOL_MAX_INSPECT_BYTES:
            raise DownloadError("yt-dlp media information exceeded the inspection size limit")
        try:
            info = json.loads(stdout.decode("utf-8", "replace") or "null")
        except ValueError as error:
            raise DownloadError("yt-dlp returned unreadable media information") from error
        return summarize_ytdlp_info(info)
    finally:
        if proc is not None:
            _terminate_process_group(proc)
        broker.close()
        shutil.rmtree(work_dir, ignore_errors=True)


def ffprobe_path(ffmpeg: str | None) -> str | None:
    """Locate ffprobe next to the configured ffmpeg (Homebrew installs both)."""
    candidates: list[Path] = []
    if ffmpeg:
        candidates.append(Path(ffmpeg).with_name("ffprobe"))
    found = shutil.which("ffprobe")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        try:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
        except OSError:
            continue
    return None


def _positive_number(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return result if math.isfinite(result) and result > 0 else 0.0


def describe_media(path: Path, ffmpeg: str | None) -> dict[str, Any]:
    """Read container, duration, dimensions and codecs of a finished file.

    Best effort only: a probe failure never fails the job. The result feeds
    the extension's download history (duration, resolution and codec chips).
    """
    probe = ffprobe_path(ffmpeg)
    if not probe:
        return {}
    try:
        completed = subprocess.run(
            [probe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i", str(path)],
            capture_output=True,
            timeout=MEDIA_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
        data = json.loads(completed.stdout.decode("utf-8", "replace") or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    fmt = data.get("format") if isinstance(data.get("format"), dict) else {}
    streams = [item for item in data.get("streams") or [] if isinstance(item, dict)]
    video = next(
        (item for item in streams
         if item.get("codec_type") == "video" and (item.get("disposition") or {}).get("attached_pic") != 1),
        None,
    )
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    duration = _positive_number(fmt.get("duration")) or _positive_number((video or audio or {}).get("duration"))
    container = str(fmt.get("format_name") or "").split(",", 1)[0].strip()[:32]
    result: dict[str, Any] = {}
    if duration:
        result["duration"] = round(duration, 2)
    if container:
        result["container"] = container
    if video:
        width, height = int(_positive_number(video.get("width"))), int(_positive_number(video.get("height")))
        if width and height:
            result["width"], result["height"] = width, height
        codec = str(video.get("codec_name") or "")[:32]
        if codec:
            result["videoCodec"] = codec
    if audio:
        codec = str(audio.get("codec_name") or "")[:32]
        if codec:
            result["audioCodec"] = codec
    bitrate = _positive_number(fmt.get("bit_rate"))
    if bitrate:
        result["bitrate"] = int(bitrate)
    return result


def make_thumbnail(path: Path, ffmpeg: str | None, duration: float = 0.0) -> str | None:
    """Render one small JPEG poster frame as a data URL, or None.

    The frame is written to a private temporary directory and read back, so
    FFmpeg keeps its file-only protocol whitelist. Output is capped so the
    extension's history record stays small enough for chrome.storage.
    """
    if not ffmpeg:
        return None
    seek = min(3.0, duration * 0.1) if duration and duration > 1 else 0.0
    work_dir = Path(tempfile.mkdtemp(prefix="havre-thumb-"))
    try:
        for scale, quality in ((360, 8), (240, 14)):
            output = work_dir / f"poster-{scale}.jpg"
            args = [
                ffmpeg, "-hide_banner", "-nostdin", "-y", "-v", "error",
                *(["-ss", f"{seek:.2f}"] if seek else []),
                "-i", str(path),
                "-frames:v", "1", "-vf", f"scale={scale}:-2", "-q:v", str(quality),
                str(output),
            ]
            try:
                subprocess.run(
                    resource_limited_ffmpeg_args(local_only_ffmpeg_args(args)),
                    capture_output=True,
                    timeout=MEDIA_PROBE_TIMEOUT_SECONDS,
                    check=False,
                )
                payload = output.read_bytes()
            except (OSError, subprocess.SubprocessError, DownloadError):
                return None
            if not payload:
                return None
            if len(payload) <= HISTORY_THUMBNAIL_MAX_BYTES:
                return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")
        return None
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


class Host:
    def __init__(self) -> None:
        self.write_lock = threading.Lock()
        self.jobs: dict[str, threading.Event] = {}
        self.jobs_lock = threading.Lock()
        self.targets_lock = threading.Lock()
        self.reserved_targets: set[Path] = set()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS + 2, thread_name_prefix="havre-job")
        # Admitted jobs beyond the user's concurrency setting wait here; the
        # setting travels with every download message and applies at once.
        self.job_limit = DEFAULT_CONCURRENT_JOBS
        self.running_jobs = 0
        self.slots = threading.Condition()
        self.ffmpeg_capabilities = probe_ffmpeg(env_setting("FFMPEG") or None)
        self.ffmpeg = self.ffmpeg_capabilities.path or None
        self.ytdlp_capabilities = probe_ytdlp(env_setting("YTDLP") or None)
        self.ytdlp = self.ytdlp_capabilities.path if self.ytdlp_capabilities.available else None
        self.config = load_host_config()
        self.download_dir = resolve_download_dir(self.config)
        self.known_download_dirs = [path for path in known_download_dirs(self.config) if path != self.download_dir]
        cleanup_stale_workdirs(self.download_dir)

    def send(self, message: dict[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(payload) > MAX_MESSAGE:
            payload = json.dumps({"type": "error", "error": "Host message exceeded 1 MiB"}).encode()
        with self.write_lock:
            sys.stdout.buffer.write(struct.pack("=I", len(payload)))
            sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()

    def handle(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "ping":
            # Re-probe on every ping: installing or upgrading yt-dlp after the
            # engine started takes effect at the next "Retry" in Settings.
            self.ytdlp_capabilities = probe_ytdlp(env_setting("YTDLP") or None)
            self.ytdlp = self.ytdlp_capabilities.path if self.ytdlp_capabilities.available else None
            self.send({
                "type": "pong",
                "requestId": message.get("requestId"),
                "version": VERSION,
                "protocolVersion": NATIVE_PROTOCOL_VERSION,
                "capabilityProfileVersion": CAPABILITY_PROFILE_VERSION,
                "ffmpeg": bool(self.ffmpeg),
                "downloadDir": str(self.download_dir),
                "capabilities": {
                    "ffmpeg": self.ffmpeg_capabilities.as_dict(),
                    "ytdlp": self.ytdlp_capabilities.as_dict(),
                    "dashPlanner": "static-v1",
                    "dashPair": "direct-v1",
                    "externalNetworkProcesses": EXTERNAL_TOOL_BROKER_CAPABILITY,
                    "fileActions": "finder-v1",
                    "pause": PAUSE_CAPABILITY,
                },
            })
            return
        if kind in FILE_ACTIONS:
            self.send(self.handle_file_action(kind, message))
            return
        if kind in {"cancel", "pause"}:
            with self.jobs_lock:
                event = self.jobs.get(str(message.get("jobId") or ""))
            if event:
                # A pause keeps resumable state on disk; a cancel that follows
                # a pause request wins, so partial files never outlive intent.
                if isinstance(event, JobControl):
                    event.reason = "pause" if kind == "pause" else "cancel"
                event.set()
            return
        if kind == "choose_folder":
            # The picker blocks for as long as the user looks at it; keep the
            # reader loop free for pings and cancels meanwhile.
            self.executor.submit(self.handle_choose_folder, message)
            return
        if kind == "discard":
            reply: dict[str, Any] = {"type": "file_action_result", "requestId": message.get("requestId"), "action": "discard"}
            try:
                reply.update({"ok": True, **discard_partial_download(self.download_dir, str(message.get("filename") or ""))})
            except Exception as error:  # noqa: BLE001 - reported (redacted) to the extension
                reply.update({"ok": False, "error": redact_text(error)})
            self.send(reply)
            return
        if kind == "inspect_hls":
            # Fetch a media playlist through the pinned client with the
            # headers the page itself used. Several CDNs reject the
            # extension's own fetches (hotlink referer checks), which used to
            # leave cards without duration/quality metadata.
            request_id = message.get("requestId")
            try:
                inspect_url = valid_url(message.get("url"))
                inspect_headers = clean_headers(message.get("headers"))
                manifest = fetch_manifest(inspect_url, inspect_headers, threading.Event())
                inspect_text = manifest.text
                if len(inspect_text.encode("utf-8")) > 1_500_000:
                    raise DownloadError("HLS playlist exceeds the inspection size limit")
                self.send({
                    "type": "inspect_hls_result",
                    "requestId": request_id,
                    "ok": True,
                    "text": inspect_text,
                    "finalUrl": manifest.final_url,
                })
            except Exception as error:  # noqa: BLE001 - surfaced verbatim to the extension
                self.send({
                    "type": "inspect_hls_result",
                    "requestId": request_id,
                    "ok": False,
                    "error": str(error),
                })
            return
        if kind == "inspect_youtube":
            # yt-dlp takes seconds to answer; keep the reader loop free.
            self.executor.submit(self.handle_inspect_youtube, message)
            return
        if kind != "download":
            self.send({"type": "error", "requestId": message.get("requestId"), "error": "Unknown request type"})
            return
        job_id = str(message.get("jobId") or uuid.uuid4())[:100]
        rejection: dict[str, Any] | None = None
        cancel: threading.Event | None = None
        with self.jobs_lock:
            if job_id in self.jobs:
                rejection = {"type": "error", "jobId": job_id, "error": "Duplicate job ID"}
            elif len(self.jobs) >= MAX_NATIVE_ADMITTED_JOBS:
                rejection = {
                    "type": "failed",
                    "jobId": job_id,
                    "status": "failed",
                    "error": "Native job queue is full; retry after an active job finishes",
                    "message": "本地引擎任务队列已满，请稍后重试",
                    "code": "host_busy",
                }
            else:
                cancel = JobControl()
                self.jobs[job_id] = cancel
        if rejection is not None:
            self.send(rejection)
            return
        assert cancel is not None
        try:
            self.executor.submit(self.run_job, job_id, message, cancel)
        except RuntimeError as error:
            with self.jobs_lock:
                self.jobs.pop(job_id, None)
            detail = redact_text(error)
            self.send({
                "type": "failed",
                "jobId": job_id,
                "status": "failed",
                "error": detail,
                "message": detail,
            })

    def _acquire_job_slot(self, limit: int, cancel: threading.Event, job_id: str, filename: str) -> None:
        with self.slots:
            self.job_limit = limit
            announced = False
            while self.running_jobs >= self.job_limit:
                if cancel.is_set():
                    raise Cancelled()
                if not announced:
                    announced = True
                    self.send({"type": "progress", "jobId": job_id, "filename": filename, "status": "queued", "progress": 0, "message": QUEUED_MESSAGE})
                self.slots.wait(0.25)
            self.running_jobs += 1

    def _release_job_slot(self) -> None:
        with self.slots:
            self.running_jobs = max(0, self.running_jobs - 1)
            self.slots.notify_all()

    def run_job(self, job_id: str, message: dict[str, Any], cancel: threading.Event) -> None:
        filename = safe_filename(message.get("filename"), "media.mp4")
        source_suffix = Path(filename).suffix or ".bin"
        reserved_target: Path | None = None
        work_dir: Path | None = None
        started = time.monotonic()
        options = message.get("options") if isinstance(message.get("options"), dict) else {}
        network_token = set_current_network_policy(NetworkPolicy(
            allow_private_network_media=options.get("allowPrivateNetworkMedia") is True,
        ))
        preload_token: contextvars.Token[dict[str, str]] | None = None
        slot_held = False
        try:
            if cancel.is_set():
                raise Cancelled()
            self._acquire_job_slot(
                bounded_int(options.get("concurrentJobs"), 1, MAX_CONCURRENT_JOBS, DEFAULT_CONCURRENT_JOBS),
                cancel,
                job_id,
                filename,
            )
            slot_held = True
            started = time.monotonic()
            kind = str(message.get("mediaKind") or "video").strip().lower()
            url = valid_url(message.get("videoUrl") or options.get("videoUrl") or message.get("url")) if kind == "dash_pair" else valid_url(message.get("url"))
            headers = clean_headers(message.get("headers"))
            preload_token = _PRELOADED_MANIFESTS.set(preloaded_manifests(options.get("preloadedManifests"), url) if kind == "hls" else {})
            pair_audio_url: str | None = None
            pair_video_headers: dict[str, str] | None = None
            pair_audio_headers: dict[str, str] | None = None
            pair_expires_at = 0.0
            if kind == "dash_pair":
                raw_audio_url = message.get("audioUrl") or options.get("audioUrl")
                if not raw_audio_url:
                    raise DownloadError("DASH pair is missing an audio URL")
                pair_audio_url = valid_url(raw_audio_url)
                raw_video_headers = message.get("videoHeaders")
                if not isinstance(raw_video_headers, dict):
                    raw_video_headers = options.get("videoHeaders")
                raw_audio_headers = message.get("audioHeaders")
                if not isinstance(raw_audio_headers, dict):
                    raw_audio_headers = options.get("audioHeaders")
                pair_video_headers, pair_audio_headers = dash_pair_headers(
                    url,
                    pair_audio_url,
                    headers,
                    raw_video_headers,
                    raw_audio_headers,
                )
                raw_expires_at = message.get("expiresAt")
                if raw_expires_at is None:
                    raw_expires_at = options.get("expiresAt")
                pair_expires_at = dash_pair_expires_at(raw_expires_at)
                # This runs after any executor queue delay, not when Chrome
                # originally enqueued the native message.
                ensure_dash_pair_fresh(pair_expires_at, "任务开始")
            container = str(options.get("outputContainer") or "mp4").lower()
            if container not in {"mp4", "mkv", "webm"}:
                container = "mp4"
            extract_audio = bool(options.get("extractAudio"))
            if kind == "dash_pair":
                if extract_audio:
                    filename = f"{Path(filename).stem}.mp3"
                else:
                    container = "mp4"
                    filename = f"{Path(filename).stem}.mp4"
            elif extract_audio:
                filename = f"{Path(filename).stem}.mp3"
            elif kind in {"hls", "dash", "youtube"} or options.get("convert"):
                filename = f"{Path(filename).stem}.{container}"
            direct_resumable = kind not in {"hls", "dash", "dash_pair", "youtube"} and not extract_audio and not options.get("convert")
            # Staged-segment jobs resume from their pause marker under the
            # same output name, exactly like a direct checkpoint.
            segment_resumable = kind in {"hls", "dash"}
            with self.targets_lock:
                target = unique_path(
                    self.download_dir,
                    filename,
                    allow_checkpoint=direct_resumable or segment_resumable,
                    reserved=self.reserved_targets,
                )
                self.reserved_targets.add(target)
                reserved_target = target
            progress = Progress(self.send, job_id, target.name)
            progress.status("starting", "正在探测媒体")
            concurrent_fragments = bounded_int(options.get("concurrentFragments"), 1, 24, 8)
            concurrent_ranges = bounded_int(options.get("concurrentRanges"), 1, 24, 8)
            live_duration = bounded_int(options.get("liveDuration"), 0, 24 * 3600, 0)
            expected_duration = bounded_float(options.get("expectedDuration", options.get("duration", 0)), 0, 24 * 3600, 0)
            if extract_audio and self.ffmpeg and not self.ffmpeg_capabilities.libmp3lame and not self.ffmpeg_capabilities.probe_error:
                raise DownloadError(f"Audio extraction requires libmp3lame, but {self.ffmpeg} does not provide that encoder")

            if kind == "dash_pair":
                if not self.ffmpeg:
                    raise DownloadError("DASH pair download requires FFmpeg")
                assert pair_audio_url is not None and pair_video_headers is not None and pair_audio_headers is not None
                if extract_audio:
                    target = dash_pair_audio_download(
                        pair_audio_url,
                        target,
                        pair_audio_headers,
                        concurrent_ranges,
                        cancel,
                        progress,
                        self.ffmpeg,
                        expected_duration=expected_duration,
                        expires_at=pair_expires_at,
                    )
                else:
                    target = dash_pair_download(
                        url,
                        pair_audio_url,
                        target,
                        pair_video_headers,
                        pair_audio_headers,
                        concurrent_ranges,
                        cancel,
                        progress,
                        self.ffmpeg,
                        expected_duration=expected_duration,
                        expires_at=pair_expires_at,
                    )
            elif kind == "hls":
                variant_url = valid_url(options.get("variantUrl")) if options.get("variantUrl") else None
                rendition_audio_url = valid_url(options.get("audioUrl")) if options.get("audioUrl") else None
                target = hls_fast_download(
                    url,
                    target,
                    headers,
                    concurrent_fragments,
                    cancel,
                    progress,
                    self.ffmpeg,
                    variant_url,
                    live_duration,
                    extract_audio,
                    rendition_audio_url,
                )
            elif kind == "dash":
                if not self.ffmpeg:
                    raise DownloadError("DASH download requires FFmpeg")
                dash_manifest = fetch_manifest(url, headers, cancel)
                if dash_is_protected(dash_manifest.text):
                    raise DownloadError("Protected DASH is metadata-only")
                try:
                    requested_representation_index = None
                    if options.get("representationIndex") is not None:
                        bounded_index = bounded_int(
                            options.get("representationIndex"),
                            0,
                            MAX_DASH_REPRESENTATIONS - 1,
                            -1,
                        )
                        if bounded_index >= 0:
                            requested_representation_index = bounded_index
                    # Always download MPD children through the pinned native
                    # client, then give FFmpeg local files only.  Availability
                    # of FFmpeg's own DASH demuxer never weakens this boundary.
                    target = dash_static_download(
                        dash_manifest.final_url,
                        dash_manifest.text,
                        target,
                        dash_manifest.request_headers,
                        concurrent_fragments,
                        cancel,
                        progress,
                        self.ffmpeg,
                        extract_audio=extract_audio,
                        selected_representation_index=requested_representation_index,
                    )
                except UnsupportedDashError as error:
                    raise _dash_demuxer_error(self.ffmpeg_capabilities, str(error)) from error
            elif kind == "youtube":
                target = youtube_download(
                    url,
                    target,
                    container,
                    extract_audio,
                    cancel,
                    progress,
                    self.ytdlp,
                    ffmpeg=self.ffmpeg,
                    max_height=bounded_int(options.get("maxHeight"), 0, YTDLP_MAX_HEIGHT, 0),
                    concurrent_fragments=concurrent_fragments,
                    work_root=self.download_dir,
                )
            else:
                raw_target = target
                if extract_audio or options.get("convert"):
                    if not self.ffmpeg:
                        raise DownloadError("Conversion requires FFmpeg")
                    work_dir = Path(tempfile.mkdtemp(prefix=".havre-convert-", dir=str(self.download_dir)))
                    raw_target = work_dir / f"source{source_suffix}"
                raw_target = multipart_download(url, raw_target, headers, concurrent_ranges, cancel, progress)
                if extract_audio or options.get("convert"):
                    progress.status("remuxing", "正在转换格式")
                    if extract_audio:
                        args = [self.ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(raw_target), "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-progress", "pipe:1", "-nostats", str(target)]
                        target = run_ffmpeg(
                            args,
                            target,
                            cancel,
                            progress,
                            expected_duration=float(describe_media(raw_target, self.ffmpeg).get("duration") or 0),
                            activity="正在提取音频",
                            report_output_speed=False,
                        )
                    else:
                        target = ffmpeg_remux(raw_target, target, cancel, progress, self.ffmpeg)
                    raw_target.unlink(missing_ok=True)

            self.send(self.completion_message(job_id, target, started=started, extract_audio=extract_audio))
        except Cancelled:
            if is_pause(cancel):
                self.send({
                    "type": "paused",
                    "jobId": job_id,
                    "filename": filename,
                    "status": "paused",
                    "message": PAUSED_MESSAGE,
                    # The name the resuming job must ask for so unique_path
                    # hands back the same checkpoint/staging state.
                    "targetName": reserved_target.name if reserved_target is not None else filename,
                })
            else:
                self.send({"type": "cancelled", "jobId": job_id, "filename": filename, "status": "cancelled", "message": "任务已取消"})
        except Exception as error:  # noqa: BLE001 - report all job failures to Chrome
            detail = redact_text(error)
            self.send({"type": "failed", "jobId": job_id, "filename": filename, "status": "failed", "error": detail, "message": detail})
        finally:
            if slot_held:
                self._release_job_slot()
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)
            if reserved_target is not None:
                with self.targets_lock:
                    self.reserved_targets.discard(reserved_target)
            with self.jobs_lock:
                self.jobs.pop(job_id, None)
            if preload_token is not None:
                _PRELOADED_MANIFESTS.reset(preload_token)
            reset_current_network_policy(network_token)

    def completion_message(self, job_id: str, target: Path, *, started: float, extract_audio: bool = False) -> dict[str, Any]:
        """Describe a published file for the extension's download history.

        Besides the path and size, the record carries duration/resolution/
        codec facts from ffprobe and one small poster frame so finished rows
        are recognisable at a glance. Every extra is best effort.
        """
        media = describe_media(target, self.ffmpeg)
        thumbnail = None if extract_audio else make_thumbnail(target, self.ffmpeg, float(media.get("duration") or 0))
        return {
            "type": "complete",
            "jobId": job_id,
            "filename": target.name,
            "status": "completed",
            "progress": 1,
            "path": str(target),
            "size": target.stat().st_size,
            "message": COMPLETE_MESSAGE,
            "media": media,
            "thumbnail": thumbnail,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "downloadDir": str(self.download_dir),
        }

    # ---- External tools ----------------------------------------------------
    def handle_inspect_youtube(self, message: dict[str, Any]) -> None:
        reply: dict[str, Any] = {"type": "inspect_youtube_result", "requestId": message.get("requestId")}
        network_token = set_current_network_policy(NetworkPolicy(
            allow_private_network_media=(message.get("options") or {}).get("allowPrivateNetworkMedia") is True
            if isinstance(message.get("options"), dict) else False,
        ))
        try:
            summary = youtube_inspect(valid_url(message.get("url")), self.ytdlp, self.ffmpeg)
            reply.update({"ok": True, **summary})
        except Exception as error:  # noqa: BLE001 - reported (redacted) to the extension
            reply.update({"ok": False, "error": redact_text(error)})
        finally:
            reset_current_network_policy(network_token)
        self.send(reply)

    # ---- File actions ------------------------------------------------------
    def handle_choose_folder(self, message: dict[str, Any]) -> None:
        reply: dict[str, Any] = {"type": "file_action_result", "requestId": message.get("requestId"), "action": "choose_folder"}
        try:
            if message.get("reset") is True:
                chosen = default_download_dir()
            else:
                chosen = choose_folder_dialog(self.download_dir)
                if chosen is None:
                    reply.update({"ok": False, "error": "cancelled"})
                    self.send(reply)
                    return
            self.set_download_dir(validate_download_dir(str(chosen)))
            reply.update({"ok": True, "downloadDir": str(self.download_dir)})
        except Exception as error:  # noqa: BLE001 - reported (redacted) to the extension
            reply.update({"ok": False, "error": redact_text(error)})
        self.send(reply)

    def set_download_dir(self, directory: Path) -> None:
        """Switch the save folder and remember the previous ones, so files
        published there remain openable through the confined file actions."""
        with self.targets_lock:
            previous = self.download_dir
            if previous != directory and previous not in self.known_download_dirs:
                self.known_download_dirs.insert(0, previous)
            self.known_download_dirs = [path for path in self.known_download_dirs if path != directory][:MAX_KNOWN_DOWNLOAD_DIRS]
            self.download_dir = directory
            self.config = {
                **self.config,
                "downloadDir": str(directory) if directory != default_download_dir() else "",
                "knownDownloadDirs": [str(path) for path in self.known_download_dirs],
            }
            if env_setting("DOWNLOAD_DIR") is None:
                save_host_config(self.config)
        cleanup_stale_workdirs(directory)

    def managed_path(self, value: Any, *, allow_directory: bool = False) -> Path:
        """Resolve a path the extension asks to act on and confine it to the
        download folder. Symlinks, traversal and foreign roots fail closed: the
        host only ever opens, reveals or trashes files it published itself."""
        raw = value if isinstance(value, str) else ""
        if not raw or len(raw) > 2048 or "\x00" in raw:
            raise DownloadError("Path is invalid")
        candidate = Path(raw)
        if not candidate.is_absolute():
            raise DownloadError("Path must be absolute")
        if candidate.is_symlink():
            raise DownloadError("Symlinks are not managed")
        roots = [self.download_dir.resolve(), *(path.resolve() for path in getattr(self, "known_download_dirs", []))]
        root = roots[0]
        try:
            resolved = candidate.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise DownloadError("File no longer exists") from error
        if not any(resolved == base or resolved.is_relative_to(base) for base in roots):
            raise DownloadError("Path is outside the download folder")
        root = next(base for base in roots if resolved == base or resolved.is_relative_to(base))
        if resolved == root or resolved.is_dir():
            if not allow_directory:
                raise DownloadError("Path is not a file")
            return resolved
        if not resolved.is_file():
            raise DownloadError("Path is not a regular file")
        relative_parts = resolved.relative_to(root).parts
        if any(part.startswith(TEMP_WORK_PREFIXES) or is_stale_partial_name(part) for part in relative_parts):
            raise DownloadError("Unfinished files cannot be opened")
        return resolved

    def handle_file_action(self, action: str, message: dict[str, Any]) -> dict[str, Any]:
        reply: dict[str, Any] = {"type": "file_action_result", "requestId": message.get("requestId"), "action": action}
        try:
            if action == "stat":
                items: list[dict[str, Any]] = []
                raw_paths = message.get("paths") if isinstance(message.get("paths"), list) else []
                for raw in raw_paths[:MAX_FILE_STAT_PATHS]:
                    item: dict[str, Any] = {"path": raw if isinstance(raw, str) else "", "exists": False}
                    try:
                        metadata = self.managed_path(raw).stat()
                        item.update({"exists": True, "size": metadata.st_size, "mtime": int(metadata.st_mtime * 1000)})
                    except DownloadError:
                        pass
                    items.append(item)
                reply.update({"ok": True, "items": items})
                return reply
            if action == "open_folder":
                run_opener([OPEN_COMMAND, str(self.download_dir)])
                reply["ok"] = True
                return reply
            path = self.managed_path(message.get("path"))
            if action == "reveal":
                run_opener([OPEN_COMMAND, "-R", str(path)])
            elif action == "open":
                run_opener([OPEN_COMMAND, str(path)])
            elif action == "trash":
                move_to_trash(path)
            else:
                raise DownloadError("Unknown file action")
            reply["ok"] = True
        except Exception as error:  # noqa: BLE001 - reported (redacted) to the extension
            reply.update({"ok": False, "error": redact_text(error)})
        return reply

    def close(self) -> None:
        with self.jobs_lock:
            for event in self.jobs.values():
                event.set()
        self.executor.shutdown(wait=False, cancel_futures=True)


def _read_exact(stream: Any, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_messages(stream: Any | None = None) -> Iterable[dict[str, Any]]:
    stream = stream or sys.stdin.buffer
    while True:
        raw_length = _read_exact(stream, 4)
        if not raw_length:
            return
        if len(raw_length) != 4:
            raise DownloadError("Truncated native message header")
        (length,) = struct.unpack("=I", raw_length)
        if length == 0:
            raise DownloadError("Native message is empty")
        if length > MAX_MESSAGE:
            raise DownloadError("Native message exceeds 1 MiB")
        payload = _read_exact(stream, length)
        if len(payload) != length:
            raise DownloadError("Truncated native message")
        message = json.loads(payload.decode("utf-8"))
        if not isinstance(message, dict):
            raise DownloadError("Native message must be an object")
        yield message


def main() -> int:
    host = Host()
    try:
        for message in read_messages():
            host.handle(message)
    except Exception as error:  # Native Messaging logs stderr in Chrome diagnostics.
        print(f"Havre host error: {redact_text(error)}", file=sys.stderr)
        # ``traceback.print_exc`` would append the original exception message,
        # which can contain a signed query string from a third-party library.
        for frame in traceback.format_tb(error.__traceback__):
            print(frame.rstrip(), file=sys.stderr)
        return 1
    finally:
        host.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
