#!/usr/bin/env bash
# One command to run Synapse locally:  ./dev.sh
#
# It installs dependencies if they are missing, starts MongoDB and Redis if nothing is
# already listening on their ports, then starts the server and the web app, and tells you
# where to open it. Press Ctrl+C to stop everything it started. Data is kept in .infra/.
#
# Optional settings (all have sensible defaults):
#   WEB_PORT=3000  GATEWAY_PORT=4000  API_PORT=4001  MONGO_PORT=27017  REDIS_PORT=6379
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB_PORT="${WEB_PORT:-3000}"
GATEWAY_PORT="${GATEWAY_PORT:-4000}"
API_PORT="${API_PORT:-4001}"
MONGO_PORT="${MONGO_PORT:-27017}"
REDIS_PORT="${REDIS_PORT:-6379}"
PIDS=()

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_port() { # wait_port <port> <name> <seconds>
  for _ in $(seq 1 "$3"); do port_open "$1" && return 0; sleep 1; done
  fail "$2 did not start on port $1 within $3 seconds. See the log in .infra/."
}

command -v node >/dev/null || fail "Node.js is not installed. Get Node 22 or newer from https://nodejs.org"
command -v mongod >/dev/null || fail "MongoDB is not installed.
  macOS:  brew tap mongodb/brew && brew install mongodb-community
  Linux:  see https://www.mongodb.com/docs/manual/installation/"
command -v redis-server >/dev/null || fail "Redis is not installed.
  macOS:  brew install redis
  Linux:  sudo apt install redis-server"

cleanup() {
  trap - EXIT INT TERM
  if [ ${#PIDS[@]} -gt 0 ]; then
    say "Stopping..."
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$ROOT/.infra/mongo" "$ROOT/.infra/redis"

for app in server web; do
  if [ ! -d "$ROOT/$app/node_modules" ]; then
    say "Installing $app dependencies (first run only)..."
    (cd "$ROOT/$app" && npm ci --no-audit --no-fund >/dev/null)
  fi
done

if port_open "$MONGO_PORT"; then say "MongoDB already running on :$MONGO_PORT, using it"; else
  say "Starting MongoDB on :$MONGO_PORT"
  mongod --dbpath "$ROOT/.infra/mongo" --port "$MONGO_PORT" --bind_ip 127.0.0.1 >"$ROOT/.infra/mongo.log" 2>&1 &
  PIDS+=($!)
  wait_port "$MONGO_PORT" MongoDB 30
fi
if port_open "$REDIS_PORT"; then say "Redis already running on :$REDIS_PORT, using it"; else
  say "Starting Redis on :$REDIS_PORT"
  redis-server --port "$REDIS_PORT" --dir "$ROOT/.infra/redis" --save "" --appendonly no >"$ROOT/.infra/redis.log" 2>&1 &
  PIDS+=($!)
  wait_port "$REDIS_PORT" Redis 15
fi

say "Starting the server (gateway :$GATEWAY_PORT, API :$API_PORT)"
(
  cd "$ROOT/server"
  MONGO_URL="mongodb://127.0.0.1:$MONGO_PORT" REDIS_URL="redis://127.0.0.1:$REDIS_PORT" \
  GATEWAY_PORT="$GATEWAY_PORT" API_PORT="$API_PORT" METRICS_PORT="${METRICS_PORT:-0}" \
  WEB_ORIGIN="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT" \
  exec npx tsx src/index.ts
) >"$ROOT/.infra/server.log" 2>&1 &
PIDS+=($!)
wait_port "$API_PORT" "The server" 60

say "Starting the web app on :$WEB_PORT"
(
  cd "$ROOT/web"
  NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" NEXT_PUBLIC_GATEWAY_URL="ws://localhost:$GATEWAY_PORT" \
  exec npx next dev -p "$WEB_PORT"
) >"$ROOT/.infra/web.log" 2>&1 &
PIDS+=($!)
wait_port "$WEB_PORT" "The web app" 90

echo
say "Synapse is running. Open  http://localhost:$WEB_PORT  and press \"Try it now\"."
echo "Logs are in .infra/*.log. Press Ctrl+C to stop."
wait
