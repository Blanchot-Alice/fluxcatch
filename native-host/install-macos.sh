#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="$ROOT/host.py"
NETWORK_POLICY="$ROOT/fluxcatch_network_policy.py"
APP_SUPPORT="$HOME/Library/Application Support"
HOST_NAME="io.github.blanchot_alice.fluxcatch"
RUNTIME_DIR="$APP_SUPPORT/FluxCatch"
HOST_DIR="$RUNTIME_DIR/native-host"
INSTALLED_HOST="$HOST_DIR/host.py"
INSTALLED_NETWORK_POLICY="$HOST_DIR/fluxcatch_network_policy.py"
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

# Manifest destinations. Google Chrome is always registered; Chrome for
# Testing and Chromium are only registered when their profile directory
# exists, so the installer never litters browsers the user does not run.
# (Chrome for Testing reads NativeMessagingHosts from its own profile root,
# which is why e2e/development installs silently failed before.)
DESTINATIONS=()
register_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    DESTINATIONS+=("$dir/NativeMessagingHosts")
  fi
}
DESTINATIONS+=("$APP_SUPPORT/Google/Chrome/NativeMessagingHosts")
register_dir "$APP_SUPPORT/Google/Chrome for Testing"
register_dir "$APP_SUPPORT/Chromium"

mkdir -p "$HOST_DIR"
chmod 700 "$RUNTIME_DIR"
chmod 700 "$HOST_DIR"

DEST_ARGS=()
for destination in "${DESTINATIONS[@]}"; do
  mkdir -p "$destination"
  DEST_ARGS+=("$destination/$HOST_NAME.json")
done

"$PYTHON_EXECUTABLE" - "$ROOT/$HOST_NAME.json.in" "$HOST" "$NETWORK_POLICY" "$INSTALLED_HOST" "$INSTALLED_NETWORK_POLICY" "$LAUNCHER" "$PYTHON_COMMAND" "$FFMPEG_COMMAND" "${DEST_ARGS[@]}" <<'PY'
import json, os, pathlib, shlex, sys, tempfile

template, source_host, source_policy, installed_host, installed_policy, launcher, python = map(pathlib.Path, sys.argv[1:8])
ffmpeg = pathlib.Path(sys.argv[8]) if sys.argv[8] else None
destinations = [pathlib.Path(item) for item in sys.argv[9:]]

for source, destination in ((source_host, installed_host), (source_policy, installed_policy)):
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.write_bytes(source.read_bytes())
    temporary.chmod(0o700)
    with temporary.open("rb") as stream:
        os.fsync(stream.fileno())
    os.replace(temporary, destination)

# Both the interpreter and FFmpeg are pinned by their stable Homebrew symlink
# paths (e.g. /opt/homebrew/bin/python3, /opt/homebrew/bin/ffmpeg) rather than
# the versioned Cellar paths they resolve to: upgrades such as python@3.14
# 3.14.6 -> 3.14.7 would otherwise orphan the pinned paths the next time
# `brew cleanup` removes an old Cellar version.
environment = f"export FLUXCATCH_FFMPEG={shlex.quote(str(ffmpeg))}\n" if ffmpeg else ""
launcher_text = f"#!/bin/sh\n{environment}exec {shlex.quote(str(python))} {shlex.quote(str(installed_host.resolve()))} \"$@\"\n"
launcher_tmp = launcher.with_name(f".{launcher.name}.tmp")
launcher_tmp.write_text(launcher_text, "utf-8")
launcher_tmp.chmod(0o700)
os.replace(launcher_tmp, launcher)

data = json.loads(template.read_text("utf-8"))
data["path"] = str(launcher.resolve())
for destination in destinations:
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
print(f"Launcher uses: {python}")
print(f"Installed host copy: {installed_host.resolve()}")
print(f"Installed network policy: {installed_policy.resolve()}")
print(f"FFmpeg: {ffmpeg if ffmpeg else 'not found during installation'}")
PY

echo ""
echo "Extension ID: gpnojfocoanelgibidlhholjobljefab"
echo "This package registers the current development build only."
echo "A future Chrome Web Store build must ship a manifest generated for its official Item ID."
echo "Reload FluxCatch at chrome://extensions after installation."
