#!/usr/bin/env bash
set -euo pipefail
DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.blanchot_alice.fluxcatch.json"
rm -f "$DEST"

clean_runtime() {
  local runtime_dir="$1"
  local host_dir="$runtime_dir/native-host"
  rm -f "$host_dir/launcher"
  rm -f "$host_dir/host.py"
  rmdir "$host_dir" 2>/dev/null || true
  rmdir "$runtime_dir" 2>/dev/null || true
}

clean_runtime "$HOME/Library/Application Support/FluxCatch"

echo "Removed: $DEST"
