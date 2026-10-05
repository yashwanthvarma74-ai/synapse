#!/usr/bin/env python3
"""Builds grafana/dashboards/synapse.json.

The dashboard is generated so it can be reviewed and changed as code: edit this file,
run `python3 observability/build-dashboard.py`, commit both. Grafana loads the JSON
through provisioning (allowUiUpdates is off, so clicking around cannot drift from git).
"""
import json
import pathlib

DS = {"type": "prometheus", "uid": "prometheus"}
R = "$__rate_interval"

panels = []
_id = 0
_y = 0


def nid():
    global _id
    _id += 1
    return _id


def row(title):
    global _y
    panels.append({"id": nid(), "type": "row", "title": title, "collapsed": False, "gridPos": {"h": 1, "w": 24, "x": 0, "y": _y}, "panels": []})
    _y += 1


def q(expr, legend="", ref="A"):
    return {"datasource": DS, "expr": expr, "legendFormat": legend, "refId": ref, "editorMode": "code", "range": True}


def quantile(p, metric, extra="", window=R):
    # `window` is how far back each point looks. Rare events (a reconnect, a keystroke burst)
    # need a longer window than the default, or the panel is empty between events.
    return f"histogram_quantile({p}, sum by (le) (rate({metric}_bucket{extra}[{window}])))"


def stat(title, desc, expr, x, w=4, h=4, unit="short", steps=None, mappings=None, decimals=None, legend=""):
    p = {
        "id": nid(), "type": "stat", "title": title, "description": desc, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": _y},
        "targets": [q(expr, legend)],
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "background", "graphMode": "area", "textMode": "auto", "justifyMode": "center"},
        "fieldConfig": {"defaults": {"unit": unit, "noValue": "no data",
                                     "thresholds": {"mode": "absolute", "steps": steps or [{"color": "blue", "value": None}]},
                                     "mappings": (mappings or []) + [{"type": "special", "options": {"match": "null+nan", "result": {"text": "no data yet", "color": "text"}}}]}, "overrides": []},
    }
    if decimals is not None:
        p["fieldConfig"]["defaults"]["decimals"] = decimals
    panels.append(p)


def ts(title, desc, targets, x, w=12, h=8, unit="short", threshold=None, stack=False, min_=None):
    """Time series. `targets` is a list of (expr, legend). `threshold` draws a red line (the target)."""
    defaults = {
        "unit": unit, "custom": {"drawStyle": "line", "lineWidth": 2, "fillOpacity": 10 if not stack else 40, "showPoints": "never", "spanNulls": True,
                                 "stacking": {"mode": "normal" if stack else "none", "group": "A"}, "thresholdsStyle": {"mode": "line" if threshold else "off"}},
        "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}] + ([{"color": "red", "value": threshold}] if threshold else [])},
        "noValue": "no data yet",
    }
    if min_ is not None:
        defaults["min"] = min_
    panels.append({
        "id": nid(), "type": "timeseries", "title": title, "description": desc, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": _y},
        "targets": [q(e, l, chr(65 + i)) for i, (e, l) in enumerate(targets)],
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True}, "tooltip": {"mode": "multi", "sort": "desc"}},
        "fieldConfig": {"defaults": defaults, "overrides": []},
    })


def advance(h):
    global _y
    _y += h


def pct3(metric, extra="", window=R):
    return [(quantile(0.5, metric, extra, window), "p50"), (quantile(0.95, metric, extra, window), "p95"), (quantile(0.99, metric, extra, window), "p99")]


# ============================ Row 1: at a glance ============================
row("Health at a glance")
stat("Open sockets", "People connected right now (WebSockets open on the gateways).", "sum(synapse_gateway_open_sockets)", 0)
stat("Open documents", "Documents currently held in gateway memory (a room closes 5 s after the last person leaves).", "sum(synapse_gateway_open_rooms)", 4)
stat("Relay (Redis)", "Whether gateways can see each other's edits. DOWN means people on different gateways are not seeing each other live; "
     "rooms repair themselves from the database when it returns. 'no data' means the server runs without Redis (single gateway).",
     "min(synapse_relay_up)", 8, mappings=[{"type": "value", "options": {"0": {"text": "DOWN", "color": "red"}, "1": {"text": "UP", "color": "green"}}}],
     steps=[{"color": "red", "value": None}, {"color": "green", "value": 1}])
stat("Rooms with unsaved edits", "Documents holding edits the database has NOT accepted. Should always be 0. Above 0 means the database is down or failing: "
     "people can still type, but a gateway crash now could lose edits (browsers still hold their copy).",
     "sum(synapse_gateway_dirty_rooms) or vector(0)", 12, steps=[{"color": "green", "value": None}, {"color": "red", "value": 1}])
stat("Connection success (5 min)", "Of the connections that finished, how many reached a synced state: synced / (synced + failed). 'Failed' means a connection that dropped by itself "
     "before syncing; attempts the browser cancelled (leaving the page) are not counted. This is the project's availability proxy; the target is 99.9%. "
     "'no data yet' if no connection finished in the last 5 minutes.",
     'sum(increase(synapse_client_connections_total{outcome="synced"}[5m])) / (sum(increase(synapse_client_connections_total{outcome="synced"}[5m])) + (sum(increase(synapse_client_connections_total{outcome="failed"}[5m])) or vector(0)))',
     16, unit="percentunit", decimals=2, steps=[{"color": "red", "value": None}, {"color": "orange", "value": 0.95}, {"color": "green", "value": 0.99}])
stat("API server errors (5 min)", "Share of API requests that failed with a 5xx error. Should be 0.",
     '(sum(rate(synapse_http_request_duration_count{status_class="5xx"}[5m])) or vector(0)) / sum(rate(synapse_http_request_duration_count[5m]))',
     20, unit="percentunit", decimals=2, steps=[{"color": "green", "value": None}, {"color": "orange", "value": 0.001}, {"color": "red", "value": 0.01}])
advance(4)

# ============================ Row 2: sync latency ============================
row("Sync latency, as people feel it (measured in their browsers)")
ts("Round trip, browser to gateway and back",
   "Each browser asks the gateway to echo a timestamp every 5 seconds; this is how long that took. It covers the browser, the network and the gateway. "
   "Remote edits travel the same path, so this is the best proxy for 'how soon do others see my edit'. Red line: the 250 ms target. "
   "Includes any delay set in the network simulator. Each point looks back 1 minute.",
   pct3("synapse_client_gateway_rtt", window="1m"), 0, unit="ms", threshold=250, min_=0)
ts("Keystroke to paint",
   "From pressing a key to the screen updating, measured in the editor (printable keys, about 10 samples a second at most). Red line: the 50 ms target. Each point looks back 2 minutes.",
   pct3("synapse_client_keystroke_to_paint", window="2m"), 12, unit="ms", threshold=50, min_=0)
advance(8)
ts("Time to sync after (re)connecting",
   "From opening a connection until the document is fully synced (handshake complete). Rises when documents are large or the network is slow.",
   [(quantile(0.5, "synapse_client_time_to_sync", window="5m"), "p50"), (quantile(0.95, "synapse_client_time_to_sync", window="5m"), "p95")], 0, unit="ms", min_=0)
ts("How long people were offline",
   "After a lost connection, the time until the browser was synced again. Long values mean people were disconnected for a while (or used the offline simulator).",
   [(quantile(0.5, "synapse_client_offline_duration", window="5m"), "p50"), (quantile(0.95, "synapse_client_offline_duration", window="5m"), "p95")], 12, unit="s", min_=0)
advance(8)

# ============================ Row 3: connections ============================
row("Connections")
ts("Sockets and documents open", "How many people are connected and how many documents the gateways hold.",
   [("sum(synapse_gateway_open_sockets)", "sockets"), ("sum(synapse_gateway_open_rooms)", "documents")], 0, w=8, min_=0)
ts("Joins per minute", "Attempts to open a document. 'rejected' means the server refused (not signed in, no access, or a removed member).",
   [(f"sum by (result) (rate(synapse_gateway_joins_total[{R}])) * 60", "{{result}}")], 8, w=8, min_=0)
ts("Browser connections per minute", "What browsers report: 'attempt' is every try (including ones the browser cancelled), 'synced' the ones that completed, 'failed' the ones that dropped before syncing.",
   [(f"sum by (outcome) (rate(synapse_client_connections_total[{R}])) * 60", "{{outcome}}")], 16, w=8, min_=0)
advance(8)
ts("Reconnects per minute", "Browsers coming back after losing a good connection.",
   [(f"sum(rate(synapse_client_reconnects_total[{R}])) * 60", "reconnects")], 0, w=8, min_=0)
ts("Access removed, writes refused, bad messages (per minute)",
   "revoked: open connections closed because someone's access was removed. dropped: edits refused (for example from a viewer). bad: malformed messages, whose socket is closed.",
   [(f"(sum(rate(synapse_gateway_revocations_total[{R}])) or vector(0)) * 60", "revoked"),
    (f"sum by (role) (rate(synapse_gateway_writes_dropped_total[{R}])) * 60", "dropped ({{role}})"),
    (f"(sum(rate(synapse_gateway_bad_messages_total[{R}])) or vector(0)) * 60", "bad messages")], 8, w=8, min_=0)
ts("Browser metric events refused", "Browser reports the server rejected as invalid. Should be 0; above 0 means a buggy or hostile client.",
   [(f"(sum(rate(synapse_client_events_rejected_total[{R}])) or vector(0)) * 60", "refused per minute")], 16, w=8, min_=0)
advance(8)

# ============================ Row 4: gateway work ============================
row("Gateway work (measured on the server)")
ts("Messages per second, by kind", "What clients send. sync_update is edits, awareness is cursors and presence, ping is the latency probe, sync_step1/2 are the connect handshake.",
   [(f"sum by (kind) (rate(synapse_gateway_messages_total[{R}]))", "{{kind}}")], 0, unit="ops", min_=0, stack=True)
ts("Time to process one message", "Server time to handle a client message (role check, apply the edit, fan out). Measured in the gateway, so it excludes the network.",
   pct3("synapse_gateway_handle_duration"), 12, unit="ms", min_=0)
advance(8)
ts("Size of edit messages", "Bytes in messages that carry edits. Large values mean big pastes or full-state syncs.",
   [(quantile(0.5, "synapse_gateway_update_size"), "p50"), (quantile(0.95, "synapse_gateway_update_size"), "p95")], 0, unit="bytes", min_=0)
ts("Time to store one edit in the database", "MongoDB write time per edit. Rising values are the first sign the database is struggling.",
   pct3("synapse_gateway_persist_duration"), 12, unit="ms", min_=0)
advance(8)
ts("Database write failures and compactions (per minute)",
   "failures: edits the database refused (the room retries and nothing is lost while the gateway stays up). compactions: merging the edit log into a snapshot.",
   [(f"(sum(rate(synapse_gateway_persist_failures_total[{R}])) or vector(0)) * 60", "write failures"),
    (f"sum by (result) (rate(synapse_gateway_compactions_total[{R}])) * 60", "compactions {{result}}")], 0, min_=0)
ts("Rooms with unsaved edits over time", "Should stay at 0. Any rise lines up with a database outage.",
   [("sum(synapse_gateway_dirty_rooms)", "rooms with unsaved edits")], 12, min_=0)
advance(8)

# ============================ Row 5: relay ============================
row("Relay between gateways (Redis)")
ts("Relay messages per second", "Edits passed between gateways. Only exists when more than one gateway runs.",
   [(f"sum(rate(synapse_relay_published_total[{R}]))", "sent"), (f"sum(rate(synapse_relay_received_total[{R}]))", "received")], 0, unit="ops", min_=0)
ts("Relay trouble and self-repair (per minute)",
   "errors: Redis failures. reconnects: the subscription coming back after being lost. resyncs: rooms re-reading the database to repair edits missed while the relay was down "
   "(reason 'reconnect' right after an outage, 'periodic' every 60 s as a safety net).",
   [(f"(sum(rate(synapse_relay_errors_total[{R}])) or vector(0)) * 60", "errors"),
    (f"(sum(rate(synapse_relay_reconnects_total[{R}])) or vector(0)) * 60", "reconnects"),
    (f"sum by (reason) (rate(synapse_gateway_resyncs_total[{R}])) * 60", "resyncs ({{reason}})")], 12, min_=0)
advance(8)

# ============================ Row 6: API ============================
row("API")
ts("Requests per second, by route", "Busiest API routes (route patterns, so no document ids appear here).",
   [(f"topk(8, sum by (route) (rate(synapse_http_request_duration_count[{R}])))", "{{route}}")], 0, unit="reqps", min_=0)
ts("Slowest routes (p95)", "95th percentile response time for the busiest routes.",
   [(f"histogram_quantile(0.95, sum by (le, route) (rate(synapse_http_request_duration_bucket[{R}]))) and on (route) topk(6, sum by (route) (rate(synapse_http_request_duration_count[{R}])))", "{{route}}")],
   12, unit="ms", min_=0)
advance(8)
ts("Responses by status class", "2xx fine, 3xx not modified, 4xx a client problem (sign-in needed, no access), 5xx a server fault.",
   [(f"sum by (status_class) (rate(synapse_http_request_duration_count[{R}]))", "{{status_class}}")], 0, unit="reqps", min_=0, stack=True)
ts("Sign-in failures and rate limiting (per minute)", "auth: wrong passwords and bad tokens. rate limited: requests refused for coming too fast. A spike can mean password guessing.",
   [(f"sum by (kind) (rate(synapse_auth_failures_total[{R}])) * 60", "failed {{kind}}"), (f"(sum(rate(synapse_rate_limited_total[{R}])) or vector(0)) * 60", "rate limited")], 12, min_=0)
advance(8)

# ============================ Row 7: process ============================
row("Server process")
ts("CPU", "Share of ONE core used by the server process (1.0 = a full core).",
   [("max(synapse_process_cpu_ratio)", "cpu")], 0, w=8, unit="percentunit", min_=0)
ts("Memory", "Memory held by the server process. Grows with open documents.",
   [("max(synapse_process_resident_memory_bytes)", "resident memory")], 8, w=8, unit="bytes", min_=0)
ts("Event loop delay (p99)", "How late the server runs scheduled work. The earliest sign a Node server is overloaded: above ~100 ms people feel lag.",
   [("max(synapse_process_event_loop_lag_p99)", "p99")], 16, w=8, unit="ms", threshold=100, min_=0)
advance(8)

dashboard = {
    "uid": "synapse-overview",
    "title": "Synapse",
    "description": "Sync latency, connections, gateway work, relay, API and process health. Generated by observability/build-dashboard.py.",
    "tags": ["synapse"],
    "timezone": "browser",
    "schemaVersion": 39,
    "version": 1,
    "editable": False,
    "graphTooltip": 1,
    "refresh": "5s",
    "time": {"from": "now-15m", "to": "now"},
    "templating": {"list": []},
    "annotations": {"list": []},
    "panels": panels,
}

out = pathlib.Path(__file__).parent / "grafana" / "dashboards" / "synapse.json"
out.write_text(json.dumps(dashboard, indent=2) + "\n")
print(f"wrote {out} with {len([p for p in panels if p['type'] != 'row'])} panels")
