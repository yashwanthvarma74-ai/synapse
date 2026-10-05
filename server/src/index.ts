// Entry point. SERVICE=gateway | api | both (default both, handy for development).
// In production you would run many gateways and a few API instances separately,
// all sharing MongoDB and Redis.
import { randomUUID } from 'node:crypto'
import { MongoStore } from './mongoStore.js'
import { collections, ensureIndexes, oid } from './db.js'
import { RedisBus } from './redisBus.js'
import { NoBus } from './bus.js'
import { createGateway } from './gateway.js'
import { createApi } from './api.js'
import { makeAuthorize, roleOnDocument } from './access.js'
import { extractText } from './text.js'
import { initTelemetry } from './telemetry.js'

const service = process.env.SERVICE ?? 'both'
// Metrics for Prometheus on :9464/metrics. METRICS_PORT=0 turns the endpoint off.
if (process.env.METRICS_PORT !== '0') {
  initTelemetry({ serviceName: `synapse-${service}`, port: Number(process.env.METRICS_PORT ?? 9464) })
}
const secret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me-please-0123456789')
if (secret.length < 32) throw new Error('JWT_SECRET must be set (32+ characters)')

const store = new MongoStore(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017', process.env.MONGO_DB ?? 'synapse')
await store.init()
const c = collections(store.db)
await ensureIndexes(c)
const bus = process.env.REDIS_URL ? new RedisBus(process.env.REDIS_URL, randomUUID().slice(0, 8)) : new NoBus()
if (!process.env.REDIS_URL) console.warn('REDIS_URL not set: running a single gateway, access changes apply on the 30s re-check')

if (service === 'gateway' || service === 'both') {
  const gateway = createGateway({
    port: Number(process.env.GATEWAY_PORT ?? 4000),
    store,
    bus,
    authorize: makeAuthorize(c, secret),
    resolveRole: (userId, docId) => roleOnDocument(c, userId, docId),
    // keep the search copy of the text fresh when edits settle
    onSettled: (docId, doc) => {
      const id = oid(docId)
      if (id) void c.documents.updateOne({ _id: id }, { $set: { text: extractText(doc), updatedAt: new Date() } }).catch(() => {})
    },
  })
  console.log(`gateway listening on :${await gateway.listen()}`)
}

if (service === 'api' || service === 'both') {
  const api = createApi({
    c, store, bus, secret,
    corsOrigin: process.env.WEB_ORIGIN,
    guestsEnabled: process.env.GUESTS_ENABLED !== 'false', // GUESTS_ENABLED=false turns off "Try it now"
    maxGuestsPerHour: Number(process.env.MAX_GUESTS_PER_HOUR ?? 300),
  })
  const port = Number(process.env.API_PORT ?? 4001)
  api.listen(port, () => console.log(`api listening on :${port}`))
}
