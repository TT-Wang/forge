#!/usr/bin/env bash
# Forge status line script
# Reads /tmp/forge-status.json and renders a one-line progress bar.
#
# Usage:
#   claude statusline set "bash /path/to/forge-status.sh"
#   # or in tmux: set -g status-right '#(bash /path/to/forge-status.sh)'

set -euo pipefail

STATUS_FILE="/tmp/forge-status.json"

# Exit silently if no status file
[[ -f "$STATUS_FILE" ]] || exit 0

# Staleness check — skip if older than 5 minutes
if [[ "$(uname)" == "Darwin" ]]; then
  file_age=$(( $(date +%s) - $(stat -f %m "$STATUS_FILE") ))
else
  file_age=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE") ))
fi
(( file_age > 300 )) && exit 0

# Colors
BOLD_CYAN='\033[1;36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
GRAY='\033[90m'
RESET='\033[0m'

# Parse JSON — prefer jq, fall back to python3
if command -v jq &>/dev/null; then
  total=$(jq -r '.totalModules // 0' "$STATUS_FILE")
  completed=$(jq -r '.completed // 0' "$STATUS_FILE")
  running=$(jq -r '.running // 0' "$STATUS_FILE")
  failed=$(jq -r '.failed // 0' "$STATUS_FILE")
  started_at=$(jq -r '.startedAt // empty' "$STATUS_FILE")
  running_module=$(jq -r '
    [.modules // {} | to_entries[] | select(.value.status == "running") | .value.title]
    | first // empty
  ' "$STATUS_FILE")
elif command -v python3 &>/dev/null; then
  eval "$(python3 -c "
import json, sys
d = json.load(open('$STATUS_FILE'))
print(f'total={d.get(\"totalModules\", 0)}')
print(f'completed={d.get(\"completed\", 0)}')
print(f'running={d.get(\"running\", 0)}')
print(f'failed={d.get(\"failed\", 0)}')
print(f'started_at={d.get(\"startedAt\", \"\")}')
mods = d.get('modules', {})
rm = [v['title'] for v in mods.values() if v.get('status') == 'running']
print(f'running_module={rm[0] if rm else \"\"}')
")"
else
  echo "[forge] status (install jq for details)"
  exit 0
fi

# Nothing to show
(( total == 0 )) && exit 0

# Progress bar (10 chars wide)
BAR_WIDTH=10
if (( total > 0 )); then
  filled=$(( completed * BAR_WIDTH / total ))
else
  filled=0
fi
empty=$(( BAR_WIDTH - filled ))

bar=""
for ((i=0; i<filled; i++)); do bar+="█"; done
for ((i=0; i<empty; i++)); do bar+="░"; done

# Elapsed time
elapsed=""
if [[ -n "$started_at" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${started_at%%.*}" +%s 2>/dev/null || echo "")
  else
    start_epoch=$(date -d "$started_at" +%s 2>/dev/null || echo "")
  fi
  if [[ -n "$start_epoch" ]]; then
    now=$(date +%s)
    secs=$(( now - start_epoch ))
    mins=$(( secs / 60 ))
    remaining_secs=$(( secs % 60 ))
    elapsed="${mins}m${remaining_secs}s"
  fi
fi

# Status color for the bar
if (( failed > 0 )); then
  BAR_COLOR="$RED"
elif (( running > 0 )); then
  BAR_COLOR="$GREEN"
else
  BAR_COLOR="$GREEN"
fi

# Build output
output="${BOLD_CYAN}[forge]${RESET} ${BAR_COLOR}${bar}${RESET} ${completed}/${total}"

if [[ -n "$running_module" ]]; then
  output+=" ${GRAY}|${RESET} ${YELLOW}${running_module}${RESET}"
fi

if (( failed > 0 )); then
  output+=" ${GRAY}|${RESET} ${RED}${failed} failed${RESET}"
fi

if [[ -n "$elapsed" ]]; then
  output+=" ${GRAY}|${RESET} ${elapsed}"
fi

echo -e "$output"
