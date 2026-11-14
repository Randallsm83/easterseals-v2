#!/usr/bin/env bash
# Drive a disposable Easterseals v2 instance (Express API + Vite SPA) on a scratch SQLite file.
# Usage: control.sh launch | doctor | drive <journey> [--key value ...] | db "<sql>" | cleanup
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/verify-easterseals-v2"
RUN="$STATE/run"
WEB_PORT=41400
API_PORT=41401

die() { echo "ERROR: $*" >&2; exit 1; }

node_bin() {
  local mise d
  mise="$(command -v mise || true)"
  [[ -n "$mise" ]] || mise=/opt/homebrew/bin/mise
  [[ -x "$mise" ]] || die "mise not found; Node 22 is required (better-sqlite3 11.x does not build on Node 26)"
  d="$("$mise" where node@22 2>/dev/null)" || { "$mise" install node@22 >&2; d="$("$mise" where node@22)"; }
  echo "$d/bin"
}

load_instance() {
  [[ -f "$RUN/instance.env" ]] || die "no instance recorded at $RUN/instance.env (run: $0 launch)"
  # shellcheck disable=SC1091
  source "$RUN/instance.env"
}

alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n1; }

cmd_launch() {
  if [[ -f "$RUN/instance.env" ]]; then
    load_instance
    if alive "$SERVER_PID" || alive "$VITE_PID"; then die "instance $RUN_ID already running (run: $0 cleanup)"; fi
    die "stale $RUN from run $RUN_ID (run: $0 cleanup)"
  fi
  for p in $WEB_PORT $API_PORT; do
    [[ -z "$(listener "$p")" ]] || die "port $p already has a listener (pid $(listener "$p")); not ours, refusing to start"
  done

  local nb; nb="$(node_bin)"
  export PATH="$nb:$PATH"
  if ! node -e "new (require('$REPO/node_modules/better-sqlite3'))(':memory:')" 2>/dev/null; then
    echo "installing dependencies with Node $(node -v) (npm ci, lockfile unchanged)" >&2
    (cd "$REPO" && npm ci --no-audit --no-fund >&2)
  fi

  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
  EVID="$STATE/evidence/$RUN_ID"
  DB="$RUN/easterseals.db"
  mkdir -p "$RUN" "$EVID"

  # Same launch shape as tests/fixtures.ts: direct node children, DATABASE_PATH points at scratch.
  # `;` (not `&&`) after cd so `&` backgrounds node itself and $! is the listener's PID.
  (cd "$REPO"; NODE_ENV=test PORT=$API_PORT DATABASE_PATH="$DB" \
    nohup node --import tsx server/src/index.ts >"$EVID/server.log" 2>&1 & echo $! >"$RUN/server.pid")
  (cd "$REPO/client"; NODE_ENV=test VITE_API_URL="http://127.0.0.1:$API_PORT/api" ES_VITE_CACHE="$RUN/vite-cache" \
    nohup node "$REPO/node_modules/vite/bin/vite.js" --config "$SKILL_DIR/scripts/vite.config.mjs" --configLoader runner \
    --host 127.0.0.1 --port $WEB_PORT --strictPort >"$EVID/vite.log" 2>&1 & echo $! >"$RUN/vite.pid")
  SERVER_PID="$(cat "$RUN/server.pid")"; VITE_PID="$(cat "$RUN/vite.pid")"

  cat >"$RUN/instance.env" <<EOF
RUN_ID=$RUN_ID
EVID=$EVID
DB=$DB
NODE_BIN=$nb
SERVER_PID=$SERVER_PID
VITE_PID=$VITE_PID
WEB_URL=http://127.0.0.1:$WEB_PORT
API_URL=http://127.0.0.1:$API_PORT/api
REPO_HEAD=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
EOF

  local deadline=$((SECONDS + 60))
  until curl -fsS "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null | grep -q '"status":"ok"' \
     && [[ "$(curl -fsS "http://127.0.0.1:$API_PORT/api/configurations" 2>/dev/null | head -c1)" == "[" ]] \
     && curl -fsS "http://127.0.0.1:$WEB_PORT/" 2>/dev/null | grep -q 'id="root"' \
     && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/src/main.tsx" 2>/dev/null; do
    alive "$SERVER_PID" || die "API exited during startup; see $EVID/server.log"
    alive "$VITE_PID" || die "Vite exited during startup; see $EVID/vite.log"
    (( SECONDS < deadline )) || die "not ready after 60s; see $EVID/server.log and $EVID/vite.log"
    sleep 0.5
  done
  echo "READY run=$RUN_ID web=http://127.0.0.1:$WEB_PORT api=http://127.0.0.1:$API_PORT/api db=$DB evidence=$EVID"
}

cmd_doctor() {
  load_instance
  local bad=0 lp
  ok() { echo "ok   $*"; }
  no() { echo "FAIL $*"; bad=1; }
  if alive "$SERVER_PID"; then ok "api pid $SERVER_PID alive"; else no "api pid $SERVER_PID not running"; fi
  if alive "$VITE_PID"; then ok "vite pid $VITE_PID alive"; else no "vite pid $VITE_PID not running"; fi
  lp="$(listener $API_PORT)"; [[ "$lp" == "$SERVER_PID" ]] && ok "port $API_PORT owned by our api" || no "port $API_PORT listener is '${lp:-none}', expected $SERVER_PID"
  lp="$(listener $WEB_PORT)"; [[ "$lp" == "$VITE_PID" ]] && ok "port $WEB_PORT owned by our vite" || no "port $WEB_PORT listener is '${lp:-none}', expected $VITE_PID"
  curl -fsS "$API_URL/health" 2>/dev/null | grep -q '"status":"ok"' && ok "GET $API_URL/health" || no "GET $API_URL/health"
  curl -fsS "$WEB_URL/" 2>/dev/null | grep -q 'id="root"' && ok "GET $WEB_URL/ serves the SPA shell" || no "GET $WEB_URL/"
  if lsof -nP -p "$SERVER_PID" 2>/dev/null | grep -qF "$DB"; then ok "api has scratch DB open: $DB"; else no "api does not have $DB open"; fi
  if lsof -nP -p "$SERVER_PID" 2>/dev/null | grep -q "$REPO/server/data/"; then no "api has the checkout's server/data DB open"; else ok "checkout server/data DB not open"; fi
  local head; head="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  [[ "$head" == "$REPO_HEAD" ]] && ok "checkout HEAD $head matches launch" || no "checkout HEAD moved $REPO_HEAD -> $head since launch; relaunch"
  ok "node $("$NODE_BIN/node" -v), run $RUN_ID, evidence $EVID"
  return $bad
}

cmd_drive() {
  load_instance
  [[ $# -ge 1 ]] || die "usage: $0 drive <journey> [--key value ...]"
  ES_WEB="$WEB_URL" ES_API="$API_URL" ES_DB="$DB" ES_EVID="$EVID" \
    "$NODE_BIN/node" "$SKILL_DIR/scripts/drive.mjs" "$@"
}

cmd_db() {
  load_instance
  [[ $# -eq 1 ]] || die "usage: $0 db \"<sql>\""
  sqlite3 -readonly -json "$DB" "$1"
}

cmd_cleanup() {
  if [[ ! -f "$RUN/instance.env" ]]; then echo "nothing to clean (no $RUN/instance.env)"; rm -rf "$RUN"; return 0; fi
  load_instance
  local pid i
  for pid in "$VITE_PID" "$SERVER_PID"; do
    alive "$pid" || continue
    kill "$pid"
    for _ in $(seq 1 50); do alive "$pid" || break; sleep 0.2; done
    alive "$pid" && kill -9 "$pid"
  done
  for p in $WEB_PORT $API_PORT; do
    [[ -z "$(listener "$p")" ]] || echo "WARN port $p still has listener $(listener "$p") (not started by this run; left alone)"
  done
  rm -rf "$RUN"
  echo "stopped run $RUN_ID; removed $RUN; evidence kept at $EVID"
  ls -1 "$EVID"
}

case "${1:-}" in
  launch) shift; cmd_launch "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  drive) shift; cmd_drive "$@" ;;
  db) shift; cmd_db "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  *) die "usage: $0 launch | doctor | drive <journey> [--key value ...] | db \"<sql>\" | cleanup" ;;
esac
