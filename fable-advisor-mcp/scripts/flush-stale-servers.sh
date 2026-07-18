#!/bin/bash
# Kill fable-advisor MCP server processes running code older than the current
# build. Long-lived Codex runtimes (notably the ChatGPT app's embedded
# app-server) keep MCP server processes alive for days; after rebuilding
# dist/, those stale processes still run the OLD code. Run this after every
# `pnpm build` that changes server behavior.
set -euo pipefail

DIST="$(cd "$(dirname "$0")/.." && pwd)/dist/index.js"
[ -f "$DIST" ] || { echo "no build at $DIST"; exit 1; }
DIST_EPOCH=$(stat -f %m "$DIST")

FOUND=0
while read -r pid lstart_str; do
  [ -z "$pid" ] && continue
  START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$lstart_str" +%s 2>/dev/null) || continue
  if [ "$START_EPOCH" -lt "$DIST_EPOCH" ]; then
    FOUND=1
    echo "killing stale server pid=$pid (started $(date -r "$START_EPOCH" '+%m-%d %H:%M'), build is newer)"
    kill "$pid" 2>/dev/null || true
  else
    echo "keeping current server pid=$pid (started after build)"
  fi
done < <(ps -axo pid=,lstart=,command= | grep "fable-advisor-mcp/dist/index.js" | grep -v grep | awk '{print $1, $2, $3, $4, $5, $6}')

[ "$FOUND" = 0 ] && echo "no stale servers found"
exit 0
