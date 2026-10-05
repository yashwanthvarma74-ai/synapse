// Metrics (OpenTelemetry). The rest of the code calls `m.something.add(...)` freely.
// Until initTelemetry() registers an SDK those calls hit no-op instruments and cost
// nothing, which is why the gateway, API and tests need no setup. (OpenTelemetry's
// metrics API cannot bind instruments created BEFORE the SDK exists, so initTelemetry
// rebuilds them: `m` is one shared object whose fields are swapped at that point.)
//
// Labels are a small fixed set of words (never a user id, document id or URL), for
// two reasons: Prometheus gets slow when labels have many values, and metrics should
// not carry anything about who is editing what.
import { metrics, type Attributes } from '@opentelemetry/api'
import { AggregationType, MeterProvider, type MetricReader } from '@opentelemetry/sdk-metrics'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { monitorEventLoopDelay } from 'node:perf_hooks'

// Bucket boundaries chosen for what is measured: sub-millisecond server work up to
// multi-second client waits.
const MS_FAST = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000]
const MS_SLOW = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]
const BYTES = [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 8388608]

function createInstruments() {
  const meter = metrics.getMeter('synapse')
  return {
  // ---- gateway ----
  sockets: meter.createUpDownCounter('synapse_gateway_open_sockets', { description: 'WebSockets currently open on this gateway' }),
  joins: meter.createCounter('synapse_gateway_joins', { description: 'Attempts to join a room, by result (accepted or rejected)' }),
  messages: meter.createCounter('synapse_gateway_messages', { description: 'Protocol messages received from clients, by kind' }),
  writesDropped: meter.createCounter('synapse_gateway_writes_dropped', { description: 'Writes refused because the sender lacks write access' }),
  badMessages: meter.createCounter('synapse_gateway_bad_messages', { description: 'Malformed messages (the socket is closed)' }),
  revocations: meter.createCounter('synapse_gateway_revocations', { description: 'Open connections closed because access was removed' }),
  handleDuration: meter.createHistogram('synapse_gateway_handle_duration', { unit: 'ms', description: 'Time to process one client message' }),
  updateSize: meter.createHistogram('synapse_gateway_update_size', { unit: 'By', description: 'Size of messages that carry edits' }),
  persistDuration: meter.createHistogram('synapse_gateway_persist_duration', { unit: 'ms', description: 'Time to store one update in the database' }),
  persistFailures: meter.createCounter('synapse_gateway_persist_failures', { description: 'Updates the database refused (the room retries later)' }),
  dirtyRooms: meter.createUpDownCounter('synapse_gateway_dirty_rooms', { description: 'Rooms holding edits the database has not accepted yet' }),
  compactions: meter.createCounter('synapse_gateway_compactions', { description: 'Log compactions, by result' }),
  resyncs: meter.createCounter('synapse_gateway_resyncs', { description: 'Rooms re-read from the database to repair missed relay messages, by reason' }),
  // ---- relay (Redis) ----
  relayPublished: meter.createCounter('synapse_relay_published', { description: 'Messages this gateway sent to other gateways' }),
  relayReceived: meter.createCounter('synapse_relay_received', { description: 'Messages this gateway received from other gateways' }),
  relayErrors: meter.createCounter('synapse_relay_errors', { description: 'Redis errors' }),
  relayReconnects: meter.createCounter('synapse_relay_reconnects', { description: 'Times the Redis subscription came back after being lost' }),
  // ---- API ----
  httpDuration: meter.createHistogram('synapse_http_request_duration', { unit: 'ms', description: 'API request time, by method, route and status class' }),
  authFailures: meter.createCounter('synapse_auth_failures', { description: 'Rejected logins and tokens, by kind' }),
  rateLimited: meter.createCounter('synapse_rate_limited', { description: 'Requests refused by the rate limiter' }),
  // ---- reported by browsers (see recordClientMetric) ----
  clientRtt: meter.createHistogram('synapse_client_gateway_rtt', { unit: 'ms', description: 'Round trip browser to gateway and back, measured in the browser' }),
  clientTimeToSync: meter.createHistogram('synapse_client_time_to_sync', { unit: 'ms', description: 'From opening a connection until the document is synced' }),
  clientConnections: meter.createCounter('synapse_client_connections', { description: 'Browser connection attempts, by outcome (attempt, synced, failed)' }),
  clientReconnects: meter.createCounter('synapse_client_reconnects', { description: 'Browser reconnections after a lost connection' }),
  clientOffline: meter.createHistogram('synapse_client_offline_duration', { unit: 's', description: 'How long a browser was disconnected before it synced again' }),
  clientKeystroke: meter.createHistogram('synapse_client_keystroke_to_paint', { unit: 'ms', description: 'Key press until the screen updates, measured in the browser' }),
  clientEventsRejected: meter.createCounter('synapse_client_events_rejected', { description: 'Browser metric events refused as invalid' }),
  }
}

export const m = createInstruments()

// ---- browser-reported metrics: a strict allowlist -------------------------------------
// Browsers are untrusted. Only these names, only these label values, and only sane
// numbers are accepted, so nobody can invent new time series or poison the graphs.
type ClientRule = { record: (value: number, labels: Attributes) => void; max: number; labels?: Record<string, readonly string[]> }
const CLIENT_METRICS: Record<string, ClientRule> = {
  rtt: { record: (v) => m.clientRtt.record(v), max: 60_000 },
  time_to_sync: { record: (v) => m.clientTimeToSync.record(v), max: 600_000 },
  offline_seconds: { record: (v) => m.clientOffline.record(v), max: 7 * 24 * 3600 },
  keystroke_to_paint: { record: (v) => m.clientKeystroke.record(v), max: 10_000 },
  reconnect: { record: () => m.clientReconnects.add(1), max: 1 },
  connection: { record: (_v, l) => m.clientConnections.add(1, l), max: 1, labels: { outcome: ['attempt', 'synced', 'failed'] } },
}

export const CLIENT_METRIC_NAMES = Object.keys(CLIENT_METRICS)

// Returns true if the event was accepted
export function recordClientMetric(name: string, value: unknown, labels: Record<string, unknown> = {}): boolean {
  const rule = CLIENT_METRICS[name]
  const ok =
    rule !== undefined &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= rule.max &&
    Object.entries(rule.labels ?? {}).every(([k, allowed]) => typeof labels[k] === 'string' && allowed.includes(labels[k] as string)) &&
    Object.keys(labels).every((k) => rule.labels?.[k] !== undefined)
  if (!ok) {
    m.clientEventsRejected.add(1)
    return false
  }
  rule.record(value as number, labels as Attributes)
  return true
}

// ---- observable values (read when Prometheus scrapes) ----------------------------------
// Returns a function that stops reporting, so a gateway that shuts down cleans up.
export function observeGauge(name: string, description: string, read: () => number): () => void {
  const gauge = metrics.getMeter('synapse').createObservableGauge(name, { description })
  const callback = (r: { observe: (v: number) => void }) => r.observe(read())
  gauge.addCallback(callback)
  return () => gauge.removeCallback(callback)
}

// ---- start-up -------------------------------------------------------------------------
export interface TelemetryHandle {
  reader: MetricReader
  shutdown: () => Promise<void>
}

// Registers the SDK. `port` serves /metrics for Prometheus to scrape; pass
// preventServerStart in tests and read the data some other way.
export function initTelemetry(opts: { serviceName: string; port?: number; reader?: MetricReader }): TelemetryHandle {
  const reader =
    opts.reader ??
    new PrometheusExporter({ port: opts.port ?? 9464, endpoint: '/metrics', host: '127.0.0.1' }, (err) => {
      if (err) console.error('metrics endpoint failed to start:', err.message)
      else console.log(`metrics on http://127.0.0.1:${opts.port ?? 9464}/metrics`)
    })
  const provider = new MeterProvider({
    resource: resourceFromAttributes({ 'service.name': opts.serviceName }),
    readers: [reader],
    // Histograms need boundaries that fit what they measure
    views: [
      { instrumentName: 'synapse_gateway_handle_duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: MS_FAST } } },
      { instrumentName: 'synapse_gateway_persist_duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: MS_FAST } } },
      { instrumentName: 'synapse_http_request_duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: MS_FAST } } },
      { instrumentName: 'synapse_gateway_update_size', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: BYTES } } },
      // a round trip on a bad network can take many seconds: the top bucket must not clamp it to 1 s
      { instrumentName: 'synapse_client_gateway_rtt', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000] } } },
      { instrumentName: 'synapse_client_keystroke_to_paint', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [4, 8, 16, 33, 50, 100, 250, 500, 1000] } } },
      { instrumentName: 'synapse_client_time_to_sync', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: MS_SLOW } } },
      { instrumentName: 'synapse_client_offline_duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [1, 5, 15, 60, 300, 900, 3600, 21600] } } },
    ],
  })
  metrics.setGlobalMeterProvider(provider)
  Object.assign(m, createInstruments()) // now bound to the real SDK

  // Process health: event loop lag is the earliest sign a Node gateway is overloaded
  const loop = monitorEventLoopDelay({ resolution: 10 })
  loop.enable()
  const stopLag = observeGauge('synapse_process_event_loop_lag_p99', 'Event loop delay, 99th percentile over the last scrape (ms)', () => {
    const v = loop.percentile(99) / 1e6
    loop.reset()
    return Number.isFinite(v) ? v : 0
  })
  const stopRss = observeGauge('synapse_process_resident_memory_bytes', 'Memory held by the process', () => process.memoryUsage().rss)
  let lastCpu = process.cpuUsage()
  let lastAt = process.hrtime.bigint()
  const stopCpu = observeGauge('synapse_process_cpu_ratio', 'CPU used since the last scrape, as a share of ONE core', () => {
    const now = process.cpuUsage()
    const at = process.hrtime.bigint()
    const used = (now.user - lastCpu.user + now.system - lastCpu.system) / 1000 // ms
    const wall = Number(at - lastAt) / 1e6
    lastCpu = now
    lastAt = at
    return wall > 0 ? used / wall : 0
  })

  return {
    reader,
    shutdown: async () => {
      loop.disable()
      stopLag()
      stopRss()
      stopCpu()
      await provider.shutdown()
    },
  }
}
