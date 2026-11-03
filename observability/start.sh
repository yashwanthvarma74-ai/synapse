#!/usr/bin/env bash
# Starts Prometheus (http://localhost:9090) and Grafana (http://localhost:3030) for local
# development. Data goes in ../.infra, nothing runs at login. Stop with ./stop.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
mkdir -p "$ROOT/.infra/prometheus" "$ROOT/.infra/grafana/data" "$ROOT/.infra/grafana/logs" "$ROOT/.infra/grafana/plugins"

if [ ! -f "$ROOT/.infra/prometheus.pid" ] || ! kill -0 "$(cat "$ROOT/.infra/prometheus.pid")" 2>/dev/null; then
  nohup prometheus --config.file="$HERE/prometheus.yml" --storage.tsdb.path="$ROOT/.infra/prometheus" \
    --storage.tsdb.retention.time=7d --web.listen-address=127.0.0.1:9090 \
    > "$ROOT/.infra/prometheus.log" 2>&1 &
  echo $! > "$ROOT/.infra/prometheus.pid"
fi

if [ ! -f "$ROOT/.infra/grafana.pid" ] || ! kill -0 "$(cat "$ROOT/.infra/grafana.pid")" 2>/dev/null; then
  GRAFANA_HOME="$(brew --prefix grafana)/share/grafana"
  export SYNAPSE_OBS_DIR="$HERE"
  export GF_PATHS_DATA="$ROOT/.infra/grafana/data" GF_PATHS_LOGS="$ROOT/.infra/grafana/logs"
  export GF_PATHS_PLUGINS="$ROOT/.infra/grafana/plugins" GF_PATHS_PROVISIONING="$HERE/grafana/provisioning"
  export GF_SERVER_HTTP_ADDR=127.0.0.1 GF_SERVER_HTTP_PORT=3030
  # local viewing without logging in (still bound to 127.0.0.1 only); admin login is admin/admin
  export GF_AUTH_ANONYMOUS_ENABLED=true GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
  export GF_ANALYTICS_REPORTING_ENABLED=false GF_ANALYTICS_CHECK_FOR_UPDATES=false
  nohup grafana server --homepath "$GRAFANA_HOME" --config "$(brew --prefix)/etc/grafana/grafana.ini" \
    > "$ROOT/.infra/grafana.log" 2>&1 &
  echo $! > "$ROOT/.infra/grafana.pid"
fi
echo "Prometheus: http://localhost:9090   Grafana: http://localhost:3030 (dashboard: Synapse)"
