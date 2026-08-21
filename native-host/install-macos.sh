#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="$ROOT/host.py"
DEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
DEST="$DEST_DIR/io.github.blanchot_alice.fluxcatch.json"
RUNTIME_DIR="$HOME/Library/Application Support/FluxCatch"
HOST_DIR="$RUNTIME_DIR/native-host"
INSTALLED_HOST="$HOST_DIR/host.py"
LAUNCHER="$HOST_DIR/launcher"
PYTHON_COMMAND="$(command -v python3 || true)"
FFMPEG_COMMAND="$(command -v ffmpeg || true)"

if [[ -z "$PYTHON_COMMAND" ]]; then
  echo "python3 was not found in the installer shell PATH" >&2
  exit 1
fi
PYTHON_EXECUTABLE="$("$PYTHON_COMMAND" -c 'import pathlib, sys; print(pathlib.Path(sys.executable).resolve())')"
if [[ ! -x "$PYTHON_EXECUTABLE" ]]; then
  echo "Resolved Python interpreter is not executable: $PYTHON_EXECUTABLE" >&2
  exit 1
fi
FFMPEG_EXECUTABLE=""
if [[ -n "$FFMPEG_COMMAND" ]]; then
  FFMPEG_EXECUTABLE="$("$PYTHON_EXECUTABLE" -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve())' "$FFMPEG_COMMAND")"
  if [[ ! -x "$FFMPEG_EXECUTABLE" ]]; then
    FFMPEG_EXECUTABLE=""
  fi
fi

mkdir -p "$DEST_DIR"
mkdir -p "$HOST_DIR"
chmod 700 "$RUNTIME_DIR"
chmod 700 "$HOST_DIR"
"$PYTHON_EXECUTABLE" - "$ROOT/io.github.blanchot_alice.fluxcatch.json.in" "$DEST" "$HOST" "$INSTALLED_HOST" "$LAUNCHER" "$PYTHON_EXECUTABLE" "$FFMPEG_EXECUTABLE" <<'PY'
import json, os, pathlib, shlex, sys, tempfile

template, destination, source_host, installed_host, launcher, python = map(pathlib.Path, sys.argv[1:7])
ffmpeg = pathlib.Path(sys.argv[7]).resolve() if sys.argv[7] else None

host_tmp = installed_host.with_name(f".{installed_host.name}.tmp")
host_tmp.write_bytes(source_host.read_bytes())
host_tmp.chmod(0o700)
with host_tmp.open("rb") as stream:
    os.fsync(stream.fileno())
os.replace(host_tmp, installed_host)

environment = f"export FLUXCATCH_FFMPEG={shlex.quote(str(ffmpeg))}\n" if ffmpeg else ""
launcher_text = f"#!/bin/sh\n{environment}exec {shlex.quote(str(python.resolve()))} {shlex.quote(str(installed_host.resolve()))} \"$@\"\n"
launcher_tmp = launcher.with_name(f".{launcher.name}.tmp")
launcher_tmp.write_text(launcher_text, "utf-8")
launcher_tmp.chmod(0o700)
os.replace(launcher_tmp, launcher)

data = json.loads(template.read_text("utf-8"))
data["path"] = str(launcher.resolve())
fd, manifest_tmp_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
manifest_tmp = pathlib.Path(manifest_tmp_name)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(json.dumps(data, indent=2) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(manifest_tmp, destination)
finally:
    manifest_tmp.unlink(missing_ok=True)
print(f"Installed native host manifest: {destination}")
print(f"Launcher uses: {python.resolve()}")
print(f"Installed host copy: {installed_host.resolve()}")
print(f"FFmpeg: {ffmpeg if ffmpeg else 'not found during installation'}")
PY

echo "Extension ID: gpnojfocoanelgibidlhholjobljefab"
echo "Reload FluxCatch at chrome://extensions after installation."
