#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 scripts/validate.py
npm test
python3 -m unittest discover -s native-host/tests -v
python3 - <<'PY'
import datetime, hashlib, json, pathlib, shutil, subprocess, tempfile, zipfile
root = pathlib.Path.cwd()
manifest = json.loads((root / "extension/manifest.json").read_text("utf-8"))
assert manifest["manifest_version"] == 3
commit = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=root, text=True).strip()
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
    shutil.copytree(root / "extension", stage)
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
if f'commit: "{commit}"' not in packaged_profile or f'buildTimestamp: "{build_timestamp}"' not in packaged_profile:
    raise SystemExit("packaged extension build identity does not match the staged commit")
if 'commit: "development"' in packaged_profile or "buildTimestamp: null" in packaged_profile:
    raise SystemExit("development build identity leaked into the packaged extension")

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
PY
