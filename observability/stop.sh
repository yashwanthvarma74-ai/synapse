#!/usr/bin/env bash
ROOT="$(dirname "$(cd "$(dirname "$0")" && pwd)")"
for svc in prometheus grafana; do
  if [ -f "$ROOT/.infra/$svc.pid" ]; then kill "$(cat "$ROOT/.infra/$svc.pid")" 2>/dev/null || true; rm -f "$ROOT/.infra/$svc.pid"; fi
done
echo stopped
