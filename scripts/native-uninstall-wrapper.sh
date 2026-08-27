#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -x "$SCRIPT_DIR/native-host/uninstall-macos.sh" ]]; then
  BUNDLE_ROOT="$SCRIPT_DIR"
elif [[ -x "$SCRIPT_DIR/../native-host/uninstall-macos.sh" ]]; then
  BUNDLE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "FluxCatch native-host uninstaller was not found beside this wrapper." >&2
  exit 1
fi

exec "$BUNDLE_ROOT/native-host/uninstall-macos.sh" "$@"
