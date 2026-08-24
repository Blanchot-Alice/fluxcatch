#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALLOW_DIRTY=0
for argument in "$@"; do
  case "$argument" in
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    -h|--help)
      echo "Usage: npm run package -- [--allow-dirty]"
      exit 0
      ;;
    *)
      echo "error: unknown package option: $argument" >&2
      echo "Usage: npm run package -- [--allow-dirty]" >&2
      exit 2
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: packaging requires a Git worktree so the archive identity can be verified" >&2
  exit 2
fi

WORKTREE_STATUS="$(git status --porcelain --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" && "$ALLOW_DIRTY" -ne 1 ]]; then
  echo "error: refusing to package a dirty worktree (modified or untracked files are present)" >&2
  echo "Commit or stash the changes first, or explicitly run: npm run package -- --allow-dirty" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 2
fi
export FLUXCATCH_PACKAGE_ALLOW_DIRTY="$ALLOW_DIRTY"

python3 scripts/validate.py
npm test
python3 -m unittest discover -s native-host/tests -v
python3 - <<'PY'
import datetime, hashlib, json, os, pathlib, shutil, subprocess, tempfile, zipfile
root = pathlib.Path.cwd()
manifest = json.loads((root / "extension/manifest.json").read_text("utf-8"))
assert manifest["manifest_version"] == 3
allow_dirty = os.environ.get("FLUXCATCH_PACKAGE_ALLOW_DIRTY") == "1"
status = subprocess.check_output(
    ["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True
).strip()
dirty = bool(status)
if dirty and not allow_dirty:
    raise SystemExit(
        "worktree became dirty during package validation; commit or stash the changes, "
        "or explicitly rerun with --allow-dirty"
    )
head_commit = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=root, text=True).strip()
build_timestamp = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
dist = root / "dist"
if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()

extension_output = dist / f"fluxcatch-extension-{manifest['version']}.zip"
source_profile = root / "extension/lib/build-profile.js"
source_digest = hashlib.sha256(source_profile.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix="fluxcatch-package-") as temporary:
    stage = pathlib.Path(temporary) / "extension"
    stage.mkdir()
    # Package tracked files plus explicit, non-ignored untracked files. This
    # prevents ignored editor/cache debris from entering an otherwise clean
    # HEAD-labelled archive while retaining intentional dirty-fixture inputs.
    extension_sources = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "extension"],
        cwd=root
    ).split(b"\0")
    for raw_relative in extension_sources:
        if not raw_relative:
            continue
        relative = pathlib.Path(os.fsdecode(raw_relative))
        source = root / relative
        if not source.is_file():
            continue
        destination = stage / relative.relative_to("extension")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    packaged_background_sha256 = hashlib.sha256((stage / "background.js").read_bytes()).hexdigest()
    commit = f"uncommitted:background.js@sha256:{packaged_background_sha256}" if dirty else head_commit
    staged_profile = stage / "lib/build-profile.js"
    profile_text = staged_profile.read_text("utf-8")
    if profile_text.count('commit: "development"') != 1 or profile_text.count("buildTimestamp: null") != 1:
        raise SystemExit("build identity sentinels are missing or ambiguous")
    profile_text = profile_text.replace('commit: "development"', f"commit: {json.dumps(commit)}", 1)
    profile_text = profile_text.replace("buildTimestamp: null", f"buildTimestamp: {json.dumps(build_timestamp)}", 1)
    staged_profile.write_text(profile_text, "utf-8")
    with zipfile.ZipFile(extension_output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(stage))
        archive.write(root / "LICENSE", "LICENSE")
if hashlib.sha256(source_profile.read_bytes()).hexdigest() != source_digest:
    raise SystemExit("package generation modified the source build profile")
with zipfile.ZipFile(extension_output) as archive:
    packaged_profile = archive.read("lib/build-profile.js").decode("utf-8")
    archived_background_sha256 = hashlib.sha256(archive.read("background.js")).hexdigest()
if f'commit: "{commit}"' not in packaged_profile or f'buildTimestamp: "{build_timestamp}"' not in packaged_profile:
    raise SystemExit("packaged extension build identity does not match the staged commit")
if 'commit: "development"' in packaged_profile or "buildTimestamp: null" in packaged_profile:
    raise SystemExit("development build identity leaked into the packaged extension")
if archived_background_sha256 != packaged_background_sha256:
    raise SystemExit("packaged background.js does not match the content hash in the build identity")
if dirty and commit != f"uncommitted:background.js@sha256:{archived_background_sha256}":
    raise SystemExit("dirty package identity is not bound to its archived background.js content")

native_output = dist / f"fluxcatch-native-host-macos-{manifest['version']}.zip"
native_files = [
    "native-host/host.py",
    "native-host/fluxcatch_network_policy.py",
    "native-host/install-macos.sh",
    "native-host/uninstall-macos.sh",
    "native-host/io.github.blanchot_alice.fluxcatch.json.in",
    "LICENSE",
    "README.md",
    "PRIVACY.md",
    "ACCEPTABLE_USE.md",
]
with zipfile.ZipFile(native_output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for relative in native_files:
        path = root / relative
        target = pathlib.Path(relative).name if relative.startswith("native-host/") else pathlib.Path(relative)
        archive.write(path, target)
    archive.write(root / "docs/INSTALL.md", "INSTALL.md")

outputs = [extension_output, native_output]
checksums = []
for output in outputs:
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksums.append(f"{digest}  {output.name}")
    print(f"{output}  sha256={digest}")
(dist / "SHA256SUMS").write_text("\n".join(checksums) + "\n", "utf-8")
print(dist / "SHA256SUMS")
print(f"extension build identity: channel=github commit={commit} timestamp={build_timestamp}")
if dirty:
    print(f"dirty package content identity: background.js sha256={archived_background_sha256}")

if not dirty:
    final_status = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True
    ).strip()
    final_head = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=root, text=True).strip()
    if final_status or final_head != head_commit:
        shutil.rmtree(dist, ignore_errors=True)
        raise SystemExit("source identity changed while packaging; discarded the generated archives")
PY
