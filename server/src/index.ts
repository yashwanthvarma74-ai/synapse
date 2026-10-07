// Entry point. SERVICE=gateway | api | both (default both, handy for development).
// In production you would run many gateways and a few API instances separately,
// all sharing MongoDB and Redis.
import { randomUUID } from 'node:crypto'
import { MongoStore } from './mongoStore.js'
import { collections, ensureIndexes, ensureSearchIndex, oid } from './db.js'
import { logger } from './logger.js'
import { ensureBucket, s3Settings, s3Storage } from './storage.js'
import { anthropicSummarizer } from './summarize.js'
import { MongoChatStore } from './chat.js'
import { RedisBus } from './redisBus.js'
import { LocalHub } from './bus.js'
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
const chat = new MongoChatStore(store.db)
await chat.init()
// Atlas Search is on automatically for mongodb+srv:// (Atlas) URLs; ATLAS_SEARCH=false/true overrides
const atlasSearch = process.env.ATLAS_SEARCH ? process.env.ATLAS_SEARCH === 'true' : (process.env.MONGO_URL ?? '').startsWith('mongodb+srv://')
if (atlasSearch) await ensureSearchIndex(c).catch((err) => logger.error({ err: String(err) }, 'could not create the Atlas Search index; search will use the $text index'))
// Without Redis the API and the gateway in THIS process still hear each other (through an in-process hub), so
// removing someone's access closes their open connections at once. With several processes, Redis is needed.
const bus = process.env.REDIS_URL ? new RedisBus(process.env.REDIS_URL, randomUUID().slice(0, 8)) : new LocalHub().connect('local')
if (!process.env.REDIS_URL) logger.warn('REDIS_URL not set: single process only. Access changes reach connections in this process at once; other gateways would not hear them')

const s3 = s3Settings()
if (s3 && process.env.S3_CREATE_BUCKET === 'true') await ensureBucket(s3).catch((err) => logger.error({ err: String(err) }, 'could not create the bucket'))
if (!process.env.ANTHROPIC_API_KEY) logger.info('ANTHROPIC_API_KEY not set: the AI summary action is turned off')
if (!s3) logger.warn('S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set: uploads are turned off')

// Single-port mode: when the host gives us ONE port (the PORT variable, as Render, Railway and Heroku do),
// the API and the WebSocket gateway share it. Needs SERVICE=both (the default).
const singlePort = !!process.env.PORT && service === 'both'

const api = service === 'gateway' ? null : createApi({
  c, store, bus, secret,
  corsOrigin: process.env.WEB_ORIGIN,
  atlasSearch,
  storage: s3 ? s3Storage(s3) : null,
  chat,
  summarize: process.env.ANTHROPIC_API_KEY ? anthropicSummarizer({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.SUMMARY_MODEL }) : null,
  publicUrl: process.env.PUBLIC_API_URL,
  guestsEnabled: process.env.GUESTS_ENABLED !== 'false', // GUESTS_ENABLED=false turns off "Try it now"
  maxGuestsPerHour: Number(process.env.MAX_GUESTS_PER_HOUR ?? 300),
})

if (service === 'gateway' || service === 'both') {
  const gateway = createGateway({
    port: singlePort ? Number(process.env.PORT) : Number(process.env.GATEWAY_PORT ?? 4000),
    fallback: singlePort && api ? (req, res) => api(req, res) : undefined,
    chat,
    versions: store,
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
  logger.info(`gateway listening on :${await gateway.listen()}`)
}

if (api && !singlePort) {
  const port = Number(process.env.API_PORT ?? 4001)
  api.listen(port, () => logger.info(`api listening on :${port}`))
}
