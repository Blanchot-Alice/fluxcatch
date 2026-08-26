#!/usr/bin/env python3
"""Verify FluxCatch release archives after local build or CI artifact download."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import re
import tempfile
import zipfile

from build_packages import (
    TREE_DIGEST_PREFIX,
    canonical_tree_digest,
    normalize_packaged_profile,
    read_zip_entries,
    stage_extension,
    stage_native,
    validate_archive_name,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=pathlib.Path, default=ROOT / "dist")
    parser.add_argument("--expected-commit")
    return parser.parse_args()


def checksum_manifest(dist: pathlib.Path) -> dict[str, str]:
    path = dist / "SHA256SUMS"
    lines = path.read_text("utf-8").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._-]+\.zip)", line)
        if not match or match.group(2) in values:
            raise SystemExit(f"invalid checksum line: {line!r}")
        values[match.group(2)] = match.group(1)
    if len(values) != 2:
        raise SystemExit("SHA256SUMS must name exactly the extension and native ZIP")
    archive_files = {path.name for path in dist.glob("*.zip") if path.is_file()}
    if archive_files != set(values):
        raise SystemExit(f"dist ZIP set differs from SHA256SUMS: {sorted(archive_files ^ set(values))}")
    for name, expected in values.items():
        actual = hashlib.sha256((dist / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"checksum mismatch for {name}")
    return values


def one_archive(values: dict[str, str], prefix: str) -> str:
    matches = [name for name in values if name.startswith(prefix)]
    if len(matches) != 1:
        raise SystemExit(f"expected one {prefix} archive")
    return matches[0]


def archive_metadata(path: pathlib.Path) -> tuple[int, int, int, int, int, int]:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if not infos:
            raise SystemExit(f"empty archive: {path}")
        timestamp = infos[0].date_time
        for info in infos:
            pure = pathlib.PurePosixPath(info.filename)
            validate_archive_name(info.filename)
            if pure.is_absolute() or ".." in pure.parts or info.is_dir():
                raise SystemExit(f"unsafe or unexpected archive entry in {path}: {info.filename}")
            if info.create_system != 3 or info.date_time != timestamp or info.compress_type != zipfile.ZIP_STORED:
                raise SystemExit(f"non-deterministic ZIP metadata in {path}: {info.filename}")
        return timestamp


def resolve_message(value: object, messages: dict, field: str) -> str:
    if not isinstance(value, str):
        raise SystemExit(f"packaged manifest {field} is not a string")
    match = re.fullmatch(r"__MSG_([A-Za-z0-9_]+)__", value)
    if not match:
        raise SystemExit(f"packaged manifest {field} is not localized")
    entry = messages.get(match.group(1))
    message = entry.get("message") if isinstance(entry, dict) else None
    if not isinstance(message, str) or not message.strip():
        raise SystemExit(f"packaged manifest {field} has a missing locale entry")
    return message.strip()


def valid_chrome_version(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parts = value.split(".")
    return (
        1 <= len(parts) <= 4
        and all(re.fullmatch(r"0|[1-9]\d*", part) for part in parts)
        and all(int(part) <= 65535 for part in parts)
    )


def verify_extension(path: pathlib.Path, expected_commit: str | None):
    archive_timestamp = archive_metadata(path)
    entries = read_zip_entries(path)
    if "manifest.json" not in entries or "lib/build-profile.js" not in entries:
        raise SystemExit("extension archive lacks its manifest or build profile")
    for name, (mode, _) in entries.items():
        if mode != 0o644:
            raise SystemExit(f"extension entry mode is not normalized to 0644: {name}")
    manifest = json.loads(entries["manifest.json"][1].decode("utf-8"))
    version = manifest.get("version")
    if not valid_chrome_version(version):
        raise SystemExit("packaged extension has an invalid version")
    if path.name != f"fluxcatch-extension-{version}.zip":
        raise SystemExit("extension archive filename does not match manifest version")
    if manifest.get("default_locale") != "zh_CN":
        raise SystemExit("packaged extension default_locale is not zh_CN")
    for locale in ("zh_CN", "en"):
        locale_path = f"_locales/{locale}/messages.json"
        if locale_path not in entries:
            raise SystemExit(f"packaged extension lacks locale: {locale}")
        messages = json.loads(entries[locale_path][1].decode("utf-8"))
        if resolve_message(manifest.get("name"), messages, "name") != "FluxCatch":
            raise SystemExit(f"packaged extension name differs in locale {locale}")
        if resolve_message(manifest.get("action", {}).get("default_title"), messages, "action.default_title") != "FluxCatch":
            raise SystemExit(f"packaged extension action title differs in locale {locale}")
        description = resolve_message(manifest.get("description"), messages, "description")
        if not 1 <= len(description) <= 132:
            raise SystemExit(f"packaged extension description is invalid in locale {locale}")
    profile = entries["lib/build-profile.js"][1].decode("utf-8")
    commit_match = re.search(r'^\s*commit:\s*"([^"]+)",?$', profile, re.MULTILINE)
    timestamp_match = re.search(r'^\s*buildTimestamp:\s*"([^"]+)",?$', profile, re.MULTILINE)
    if not commit_match or not timestamp_match:
        raise SystemExit("packaged build identity is incomplete")
    commit = commit_match.group(1)
    timestamp = timestamp_match.group(1)
    try:
        source_time = datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise SystemExit("packaged source timestamp is not canonical UTC") from error
    normalized_source_time = (
        source_time.year, source_time.month, source_time.day,
        source_time.hour, source_time.minute, source_time.second // 2 * 2,
    )
    if normalized_source_time != archive_timestamp:
        raise SystemExit("packaged source timestamp and deterministic ZIP timestamp differ")
    if expected_commit and commit != expected_commit:
        raise SystemExit(f"packaged commit {commit!r} does not equal {expected_commit!r}")
    normalized = normalize_packaged_profile(entries, commit, timestamp)
    archive_tree_digest = canonical_tree_digest(normalized)
    if commit.startswith(TREE_DIGEST_PREFIX):
        expected_digest = commit.removeprefix(TREE_DIGEST_PREFIX)
        if archive_tree_digest != expected_digest:
            raise SystemExit("dirty extension tree digest does not cover the complete payload")
    elif not re.fullmatch(r"[0-9a-f]{12}", commit):
        raise SystemExit(f"unsupported packaged identity: {commit}")
    with tempfile.TemporaryDirectory(prefix="fluxcatch-verify-extension-") as temporary:
        current_source = stage_extension(pathlib.Path(temporary))
    if normalized != current_source:
        raise SystemExit("extension archive does not match the current canonical source tree")
    return {"commit": commit, "sourceTimestamp": timestamp, "version": version}, archive_timestamp


def verify_markdown_links(entries: dict[str, tuple[int, bytes]]) -> None:
    link_pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    for name, (_, payload) in entries.items():
        if not name.endswith(".md"):
            continue
        for target in link_pattern.findall(payload.decode("utf-8")):
            relative = target.split("#", 1)[0]
            if not relative or "://" in relative or relative.startswith(("mailto:", "#")):
                continue
            resolved = (pathlib.PurePosixPath(name).parent / relative).as_posix()
            if resolved.startswith("../") or resolved not in entries:
                raise SystemExit(f"broken packaged Markdown link: {name} -> {target}")


def verify_native(path: pathlib.Path, expected_version: str, expected_timestamp) -> dict[str, object]:
    archive_timestamp = archive_metadata(path)
    if archive_timestamp != expected_timestamp:
        raise SystemExit("extension and native archives do not share one source timestamp")
    entries = read_zip_entries(path)
    required = {
        "README.md",
        "INSTALL.md",
        "LICENSE",
        "PRIVACY.md",
        "ACCEPTABLE_USE.md",
        "install-macos.sh",
        "uninstall-macos.sh",
        "native-host/host.py",
        "native-host/fluxcatch_network_policy.py",
        "native-host/install-macos.sh",
        "native-host/uninstall-macos.sh",
        "native-host/io.github.blanchot_alice.fluxcatch.json.in",
    }
    if set(entries) != required:
        raise SystemExit(f"native package entry set differs: {sorted(set(entries) ^ required)}")
    if path.name != f"fluxcatch-native-host-macos-{expected_version}.zip":
        raise SystemExit("native archive filename does not match extension version")
    verify_markdown_links(entries)
    for name in {
        "install-macos.sh",
        "uninstall-macos.sh",
        "native-host/host.py",
        "native-host/install-macos.sh",
        "native-host/uninstall-macos.sh",
    }:
        if entries[name][0] != 0o755:
            raise SystemExit(f"native executable mode is not 0755: {name}")
    for name in set(entries) - {
        "install-macos.sh",
        "uninstall-macos.sh",
        "native-host/host.py",
        "native-host/install-macos.sh",
        "native-host/uninstall-macos.sh",
    }:
        if entries[name][0] != 0o644:
            raise SystemExit(f"native regular-file mode is not 0644: {name}")
    host = entries["native-host/host.py"][1].decode("utf-8")
    version_match = re.search(r'^VERSION\s*=\s*["\']([^"\']+)["\']', host, re.MULTILINE)
    if not version_match or version_match.group(1) != expected_version:
        raise SystemExit("packaged native-host VERSION differs from extension version")
    wrapper = entries["install-macos.sh"][1].decode("utf-8")
    if "sys.version_info < required" not in wrapper or "(3, 9)" not in wrapper:
        raise SystemExit("packaged installer lacks the Python 3.9+ preflight")
    with tempfile.TemporaryDirectory(prefix="fluxcatch-verify-native-") as temporary:
        current_source, _ = stage_native(pathlib.Path(temporary))
    if entries != current_source:
        raise SystemExit("native archive does not match the current canonical source tree")
    return {"entries": len(entries), "links": "valid", "pythonMinimum": "3.9", "version": expected_version}


def main() -> int:
    arguments = parse_arguments()
    dist = arguments.dist.resolve()
    checksums = checksum_manifest(dist)
    extension_name = one_archive(checksums, "fluxcatch-extension-")
    native_name = one_archive(checksums, "fluxcatch-native-host-")
    extension, archive_timestamp = verify_extension(dist / extension_name, arguments.expected_commit)
    result = {
        "status": "valid",
        "extension": extension,
        "native": verify_native(dist / native_name, extension["version"], archive_timestamp),
        "checksums": checksums,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
