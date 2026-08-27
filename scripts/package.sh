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
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: Python 3.9 or newer is required to validate and package FluxCatch" >&2
  exit 2
fi
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else "error: Python 3.9 or newer is required to validate and package FluxCatch")'

python3 scripts/validate.py
npm run test:coverage
python3 -m unittest discover -s native-host/tests -v
if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
  python3 scripts/build_packages.py --allow-dirty
else
  python3 scripts/build_packages.py
fi
