#!/usr/bin/env python3
"""Build deterministic FluxCatch extension and native-host release archives."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
ZIP_MIN_EPOCH = 315_532_800  # 1980-01-01, the first ZIP/DOS timestamp.
ZIP_MAX_EPOCH = 4_354_819_198  # 2107-12-31 23:59:58 UTC.
TREE_DIGEST_PREFIX = "uncommitted:extension@sha256:"
EXECUTABLE_MODE = 0o755
REGULAR_MODE = 0o644


def git(*arguments: str, binary: bool = False):
    return subprocess.check_output(
        ["git", *arguments], cwd=ROOT, text=not binary
    )


def worktree_status() -> str:
    return git("status", "--porcelain", "--untracked-files=all").strip()


def source_date_epoch() -> int:
    raw = os.environ.get("SOURCE_DATE_EPOCH")
    if raw is None:
        raw = git("show", "-s", "--format=%ct", "HEAD").strip()
    if not re.fullmatch(r"\d{1,12}", raw or ""):
        raise SystemExit("SOURCE_DATE_EPOCH must be a non-negative integer")
    value = int(raw)
    if not ZIP_MIN_EPOCH <= value <= ZIP_MAX_EPOCH:
        raise SystemExit("SOURCE_DATE_EPOCH must fit the ZIP timestamp range 1980-2107")
    return value


def zip_timestamp(epoch: int) -> tuple[int, int, int, int, int, int]:
    value = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
    # ZIP/DOS stores seconds in two-second increments.
    return (value.year, value.month, value.day, value.hour, value.minute, value.second // 2 * 2)


def build_timestamp(epoch: int) -> str:
    return (
        datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def validate_archive_name(name: str) -> None:
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(ord(character) < 32 or ord(character) == 127 for character in name)
    ):
        raise SystemExit(f"unsafe archive path: {name!r}")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise SystemExit(f"unsafe archive path: {name!r}")
    if pathlib.PurePosixPath(name).as_posix() != name:
        raise SystemExit(f"non-canonical archive path: {name!r}")


def normalized_mode(path: pathlib.Path, executable_paths: set[str]) -> int:
    return EXECUTABLE_MODE if path.as_posix() in executable_paths else REGULAR_MODE


def staged_entries(stage: pathlib.Path, executable_paths: set[str]) -> dict[str, tuple[int, bytes]]:
    entries: dict[str, tuple[int, bytes]] = {}
    for path in sorted(stage.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(stage).as_posix()
        validate_archive_name(relative)
        entries[relative] = (normalized_mode(path.relative_to(stage), executable_paths), path.read_bytes())
    return entries


def canonical_tree_digest(entries: dict[str, tuple[int, bytes]]) -> str:
    digest = hashlib.sha256()
    digest.update(b"fluxcatch-extension-tree-v1\0")
    for name in sorted(entries):
        mode, payload = entries[name]
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(f"{mode:o}".encode("ascii"))
        digest.update(b"\0")
        digest.update(str(len(payload)).encode("ascii"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    return digest.hexdigest()


def write_deterministic_zip(
    output: pathlib.Path,
    entries: dict[str, tuple[int, bytes]],
    timestamp: tuple[int, int, int, int, int, int],
) -> None:
    # ZIP_STORED removes zlib-version variance; these bundles are small enough
    # that deterministic bytes are more valuable than compression.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(entries):
            mode, payload = entries[name]
            info = zipfile.ZipInfo(name, date_time=timestamp)
            info.create_system = 3
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.flag_bits = 0
            archive.writestr(info, payload)


def read_zip_entries(path: pathlib.Path) -> dict[str, tuple[int, bytes]]:
    entries: dict[str, tuple[int, bytes]] = {}
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if names != sorted(names) or len(names) != len(set(names)):
            raise SystemExit(f"archive entries are not unique and sorted: {path}")
        for info in archive.infolist():
            if info.is_dir():
                raise SystemExit(f"unexpected directory entry in {path}: {info.filename}")
            validate_archive_name(info.filename)
            raw_mode = (info.external_attr >> 16) & 0xFFFF
            if info.create_system != 3 or stat.S_IFMT(raw_mode) != stat.S_IFREG:
                raise SystemExit(f"archive entry is not a Unix regular file in {path}: {info.filename}")
            entries[info.filename] = (stat.S_IMODE(raw_mode), archive.read(info))
    return entries


def assert_archive_metadata(
    path: pathlib.Path,
    timestamp: tuple[int, int, int, int, int, int],
    expected: dict[str, tuple[int, bytes]],
) -> None:
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.date_time != timestamp:
                raise SystemExit(f"non-deterministic timestamp in {path}: {info.filename}")
            if info.compress_type != zipfile.ZIP_STORED:
                raise SystemExit(f"non-deterministic compression in {path}: {info.filename}")
    actual = read_zip_entries(path)
    if actual != expected:
        raise SystemExit(f"archive content or normalized modes differ from staging: {path}")


def copy_file(source: pathlib.Path, stage: pathlib.Path, target: str) -> None:
    validate_archive_name(target)
    try:
        source_mode = source.lstat().st_mode
    except FileNotFoundError as error:
        raise SystemExit(f"package source is missing: {source}") from error
    if not stat.S_ISREG(source_mode):
        raise SystemExit(f"package sources must be regular files, not symlinks or devices: {source}")
    destination = stage / target
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def stage_extension(stage: pathlib.Path) -> dict[str, tuple[int, bytes]]:
    raw_paths = git(
        "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "extension", binary=True
    ).split(b"\0")
    for raw_relative in raw_paths:
        if not raw_relative:
            continue
        relative = pathlib.Path(os.fsdecode(raw_relative))
        source = ROOT / relative
        if source.is_file():
            copy_file(source, stage, relative.relative_to("extension").as_posix())
    copy_file(ROOT / "LICENSE", stage, "LICENSE")
    return staged_entries(stage, set())


def normalize_packaged_profile(
    entries: dict[str, tuple[int, bytes]], identity: str, timestamp: str
) -> dict[str, tuple[int, bytes]]:
    normalized = dict(entries)
    mode, payload = normalized["lib/build-profile.js"]
    text = payload.decode("utf-8")
    if text.count(f"commit: {json.dumps(identity)}") != 1:
        raise SystemExit("packaged build identity is missing or ambiguous")
    if text.count(f"buildTimestamp: {json.dumps(timestamp)}") != 1:
        raise SystemExit("packaged source timestamp is missing or ambiguous")
    text = text.replace(f"commit: {json.dumps(identity)}", 'commit: "development"', 1)
    text = text.replace(f"buildTimestamp: {json.dumps(timestamp)}", "buildTimestamp: null", 1)
    normalized["lib/build-profile.js"] = (mode, text.encode("utf-8"))
    return normalized


def build_extension(
    manifest: dict,
    identity: str,
    source_timestamp: str,
    archive_timestamp: tuple[int, int, int, int, int, int],
    dirty: bool,
) -> pathlib.Path:
    output = DIST / f"fluxcatch-extension-{manifest['version']}.zip"
    with tempfile.TemporaryDirectory(prefix="fluxcatch-extension-package-") as temporary:
        stage = pathlib.Path(temporary)
        source_entries = stage_extension(stage)
        source_tree_digest = canonical_tree_digest(source_entries)
        expected_identity = f"{TREE_DIGEST_PREFIX}{source_tree_digest}" if dirty else identity
        if identity != expected_identity:
            raise SystemExit("dirty extension identity does not cover the complete canonical source tree")

        profile = stage / "lib/build-profile.js"
        text = profile.read_text("utf-8")
        if text.count('commit: "development"') != 1 or text.count("buildTimestamp: null") != 1:
            raise SystemExit("build identity sentinels are missing or ambiguous")
        text = text.replace('commit: "development"', f"commit: {json.dumps(identity)}", 1)
        text = text.replace("buildTimestamp: null", f"buildTimestamp: {json.dumps(source_timestamp)}", 1)
        profile.write_text(text, "utf-8")

        packaged_entries = staged_entries(stage, set())
        write_deterministic_zip(output, packaged_entries, archive_timestamp)
        assert_archive_metadata(output, archive_timestamp, packaged_entries)
        archived = read_zip_entries(output)
        normalized = normalize_packaged_profile(archived, identity, source_timestamp)
        if canonical_tree_digest(normalized) != source_tree_digest:
            raise SystemExit("packaged extension differs from its complete canonical source-tree identity")
    return output


def markdown_link_audit(stage: pathlib.Path) -> None:
    pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    broken: list[str] = []
    for document in sorted(stage.rglob("*.md")):
        for target in pattern.findall(document.read_text("utf-8")):
            relative = target.split("#", 1)[0]
            if not relative or "://" in relative or relative.startswith(("mailto:", "#")):
                continue
            if not (document.parent / relative).resolve().is_file():
                broken.append(f"{document.relative_to(stage)} -> {target}")
    if broken:
        raise SystemExit(f"broken native-package Markdown links: {broken}")


def stage_native(stage: pathlib.Path) -> tuple[dict[str, tuple[int, bytes]], set[str]]:
    files = {
        "scripts/native-install-wrapper.sh": "install-macos.sh",
        "scripts/native-uninstall-wrapper.sh": "uninstall-macos.sh",
        "docs/NATIVE_HOST_PACKAGE.md": "README.md",
        "docs/INSTALL.md": "INSTALL.md",
        "LICENSE": "LICENSE",
        "PRIVACY.md": "PRIVACY.md",
        "ACCEPTABLE_USE.md": "ACCEPTABLE_USE.md",
        "native-host/host.py": "native-host/host.py",
        "native-host/fluxcatch_network_policy.py": "native-host/fluxcatch_network_policy.py",
        "native-host/install-macos.sh": "native-host/install-macos.sh",
        "native-host/uninstall-macos.sh": "native-host/uninstall-macos.sh",
        "native-host/io.github.blanchot_alice.fluxcatch.json.in":
            "native-host/io.github.blanchot_alice.fluxcatch.json.in",
    }
    for source, target in files.items():
        copy_file(ROOT / source, stage, target)
    # The native-package README lives under docs/ in the source tree but is
    # promoted to the archive root. Keep links valid in both locations.
    readme_path = stage / "README.md"
    readme = readme_path.read_text("utf-8")
    for name in ("PRIVACY.md", "ACCEPTABLE_USE.md", "LICENSE"):
        readme = readme.replace(f"](../{name})", f"]({name})")
    readme_path.write_text(readme, "utf-8")
    executables = {
        "install-macos.sh",
        "uninstall-macos.sh",
        "native-host/host.py",
        "native-host/install-macos.sh",
        "native-host/uninstall-macos.sh",
    }
    markdown_link_audit(stage)
    readme = readme_path.read_text("utf-8")
    if "./install-macos.sh" not in readme or "./native-host/install-macos.sh" in readme:
        raise SystemExit("native-package README does not use its root installation wrapper")
    wrapper = (stage / "install-macos.sh").read_text("utf-8")
    if "sys.version_info < required" not in wrapper or "(3, 9)" not in wrapper:
        raise SystemExit("native-package installer does not enforce Python 3.9+")
    return staged_entries(stage, executables), executables


def build_native(
    manifest: dict, archive_timestamp: tuple[int, int, int, int, int, int]
) -> pathlib.Path:
    output = DIST / f"fluxcatch-native-host-macos-{manifest['version']}.zip"
    with tempfile.TemporaryDirectory(prefix="fluxcatch-native-package-") as temporary:
        stage = pathlib.Path(temporary)
        entries, _ = stage_native(stage)
        write_deterministic_zip(output, entries, archive_timestamp)
        assert_archive_metadata(output, archive_timestamp, entries)
    return output


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-dirty", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if not (ROOT / ".git").exists():
        raise SystemExit("packaging requires a Git worktree")
    status = worktree_status()
    dirty = bool(status)
    if dirty and not arguments.allow_dirty:
        raise SystemExit("worktree became dirty during package validation")

    manifest = json.loads((ROOT / "extension/manifest.json").read_text("utf-8"))
    if manifest.get("manifest_version") != 3:
        raise SystemExit("only Manifest V3 packages are supported")
    head_commit = git("rev-parse", "--short=12", "HEAD").strip()
    epoch = source_date_epoch()
    source_timestamp = build_timestamp(epoch)
    archive_timestamp = zip_timestamp(epoch)

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    # Compute the dirty identity from the complete canonical extension tree.
    if dirty:
        with tempfile.TemporaryDirectory(prefix="fluxcatch-identity-") as temporary:
            identity_entries = stage_extension(pathlib.Path(temporary))
            identity = f"{TREE_DIGEST_PREFIX}{canonical_tree_digest(identity_entries)}"
    else:
        identity = head_commit

    extension = build_extension(
        manifest, identity, source_timestamp, archive_timestamp, dirty
    )
    native = build_native(manifest, archive_timestamp)
    outputs = [extension, native]
    checksums = []
    for output in outputs:
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        checksums.append(f"{digest}  {output.name}")
        print(f"{output}  sha256={digest}")
    (DIST / "SHA256SUMS").write_text("\n".join(checksums) + "\n", "utf-8")
    print(DIST / "SHA256SUMS")
    print(
        f"extension build identity: channel=github commit={identity} "
        f"source_timestamp={source_timestamp}"
    )

    if not dirty:
        final_status = worktree_status()
        final_head = git("rev-parse", "--short=12", "HEAD").strip()
        if final_status or final_head != head_commit:
            shutil.rmtree(DIST, ignore_errors=True)
            raise SystemExit("source identity changed while packaging; discarded generated archives")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
