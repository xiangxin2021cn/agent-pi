#!/usr/bin/env bash
set -euo pipefail

helper="packages/shared/src/utils/toolNames.ts"

if [[ ! -f "$helper" ]]; then
  echo "Missing $helper. Parent task tool checks must use the shared helper."
  exit 1
fi

if ! git grep -q "isParentTaskTool" -- "$helper"; then
  echo "$helper must export isParentTaskTool."
  exit 1
fi

violations="$(
  git grep -n -E "toolName[[:space:]]*(===|!==)[[:space:]]*['\"](Task|Agent)['\"]|['\"](Task|Agent)['\"][[:space:]]*\.includes\(.*toolName" -- \
    apps packages \
    ':(exclude)**/__tests__/**' \
    ':(exclude)apps/electron/resources/**' \
    ':(exclude)apps/electron/src/renderer/playground/**' \
    ":(exclude)$helper" \
    || true
)"

if [[ -n "$violations" ]]; then
  cat <<'EOF'
Parent task tool checks must use isParentTaskTool() so SDK renames such as
Task -> Agent are handled consistently.

Violations:
EOF
  printf '%s\n' "$violations"
  exit 1
fi
