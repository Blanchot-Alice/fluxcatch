#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 scripts/validate.py
npm test
python3 -m unittest discover -s native-host/tests -v
python3 - <<'PY'
import hashlib, json, pathlib, shutil, zipfile
root = pathlib.Path.cwd()
manifest = json.loads((root / "extension/manifest.json").read_text("utf-8"))
assert manifest["manifest_version"] == 3
dist = root / "dist"
if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()

extension_output = dist / f"fluxcatch-extension-{manifest['version']}.zip"
with zipfile.ZipFile(extension_output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted((root / "extension").rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(root / "extension"))
    archive.write(root / "LICENSE", "LICENSE")

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
PY
