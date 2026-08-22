#!/usr/bin/env bash
set -euo pipefail
APP_SUPPORT="$HOME/Library/Application Support"
HOST_NAME="io.github.blanchot_alice.fluxcatch"
DESTINATIONS=(
  "$APP_SUPPORT/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
  "$APP_SUPPORT/Google/Chrome for Testing/NativeMessagingHosts/$HOST_NAME.json"
  "$APP_SUPPORT/Chromium/NativeMessagingHosts/$HOST_NAME.json"
)
for destination in "${DESTINATIONS[@]}"; do
  rm -f "$destination"
done

clean_runtime() {
  local runtime_dir="$1"
  local host_dir="$runtime_dir/native-host"
  rm -f "$host_dir/launcher"
  rm -f "$host_dir/host.py"
  rm -f "$host_dir/fluxcatch_network_policy.py"
  rmdir "$host_dir" 2>/dev/null || true
  rmdir "$runtime_dir" 2>/dev/null || true
}

clean_runtime "$HOME/Library/Application Support/FluxCatch"

printf 'Removed native host registration: %s\n' "${DESTINATIONS[@]}"
