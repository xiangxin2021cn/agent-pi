#!/usr/bin/env bash
set -euo pipefail

matches="$(
  git grep -n -E "webContents\.send\(" -- \
    apps packages \
    ':(exclude)**/__tests__/**' \
    ':(exclude)**/dist/**' \
    ':(exclude)apps/electron/resources/**' \
    || true
)"

if [[ -z "$matches" ]]; then
  exit 0
fi

violations="$(
  printf '%s\n' "$matches" \
    | grep -Ev 'apps[\/\\]electron[\/\\]src[\/\\]main[\/\\](window-manager|browser-pane-manager)\.ts' \
    || true
)"

if [[ -n "$violations" ]]; then
  cat <<'EOF'
Raw webContents.send calls must go through the typed main-window bridge unless
they are scoped browser-pane toolbar messages.

Violations:
EOF
  printf '%s\n' "$violations"
  exit 1
fi
