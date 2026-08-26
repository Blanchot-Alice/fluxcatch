#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -x "$SCRIPT_DIR/native-host/install-macos.sh" ]]; then
  BUNDLE_ROOT="$SCRIPT_DIR"
elif [[ -x "$SCRIPT_DIR/../native-host/install-macos.sh" ]]; then
  BUNDLE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "FluxCatch native-host installer was not found beside this wrapper." >&2
  exit 1
fi

PYTHON_COMMAND="$(command -v python3 || true)"
if [[ -z "$PYTHON_COMMAND" ]]; then
  echo "FluxCatch requires Python 3.9 or newer; python3 was not found in PATH." >&2
  exit 1
fi
"$PYTHON_COMMAND" - <<'PY'
import sys

required = (3, 9)
if sys.version_info < required:
    found = ".".join(str(item) for item in sys.version_info[:3])
    raise SystemExit(f"FluxCatch requires Python 3.9 or newer; found {found}.")
PY

exec "$BUNDLE_ROOT/native-host/install-macos.sh" "$@"
