// The REST API. Each feature's routes live in routes/. Every request body is validated with Zod and every
// route checks the caller's role on the server; nothing trusts the client about who it is or what it may do.
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { logger } from './logger.js'
import { verifyToken } from './auth.js'
import { m } from './telemetry.js'
import { HttpError, type AuthedRequest } from './http.js'
import type { Collections } from './db.js'
import type { MongoStore } from './mongoStore.js'
import type { Bus } from './bus.js'
import type { Storage } from './storage.js'
import type { Summarizer } from './summarize.js'
import type { ChatStore } from './chat.js'
import type { ApiContext } from './routes/context.js'
import { authRoutes } from './routes/auth.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { inviteRoutes } from './routes/invites.js'
import { documentRoutes } from './routes/documents.js'
import { commentRoutes } from './routes/comments.js'
import { versionRoutes } from './routes/versions.js'
import { searchRoutes } from './routes/search.js'
import { chatRoutes } from './routes/chat.js'
import { summaryRoutes } from './routes/summaries.js'
import { uploadRoutes } from './routes/uploads.js'
import { systemRoutes } from './routes/system.js'

export interface ApiOptions {
  c: Collections
  store: MongoStore
  bus: Bus
  secret: string
  corsOrigin?: string // comma-separated list of web addresses allowed to call the API
  storage?: Storage | null // where uploads go (S3, R2 or MinIO); null turns uploads off
  summarize?: Summarizer | null // the AI summary; null turns it off
  chat?: ChatStore | null
  publicUrl?: string // this API's public address, used in file links
  atlasSearch?: boolean // search with Atlas Search instead of the plain text index
  guestsEnabled?: boolean
  maxGuestsPerHour?: number
}

export function createApi(options: ApiOptions) {
  const { c, store, bus, secret, corsOrigin } = options
  const ctx: ApiContext = {
    c, store, bus, secret,
    storage: options.storage ?? null,
    summarize: options.summarize ?? null,
    chat: options.chat ?? null,
    publicUrl: options.publicUrl,
    atlasSearch: options.atlasSearch ?? false,
    guestsEnabled: options.guestsEnabled ?? true,
    maxGuestsPerHour: options.maxGuestsPerHour ?? 300,
  }

  const app = express()
  app.use(cors({ origin: (corsOrigin ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',') }))
  app.use(express.json({ limit: '100kb' }))

  // Time every request and log it. Both use the route pattern (/documents/:id), never the real URL,
  // so ids and invite codes stay out of the metrics and the logs.
  app.use((req, res, next) => {
    const started = performance.now()
    res.on('finish', () => {
      const route = req.route?.path ? String(req.route.path) : res.statusCode === 404 ? 'unmatched' : 'other'
      const ms = performance.now() - started
      m.httpDuration.record(ms, { method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` })
      if (route !== '/health' && route !== '/telemetry') logger.info({ method: req.method, route, status: res.statusCode, ms: Math.round(ms) }, 'request')
    })
    next()
  })

  // Work out who is calling from the bearer token. Routes that need a user add needAuth.
  app.use(async (req, _res, next) => {
    const header = req.headers.authorization
    const userId = await verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : null, secret)
    ;(req as Partial<AuthedRequest>).userId = userId ?? undefined
    next()
  })

  for (const routes of [authRoutes, workspaceRoutes, inviteRoutes, documentRoutes, commentRoutes, versionRoutes, searchRoutes, chatRoutes, summaryRoutes, uploadRoutes, systemRoutes]) {
    app.use(routes(ctx))
  }

  app.use((_req, res) => void res.status(404).json({ error: 'Not found' }))
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message })
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON' })
    logger.error({ err }, 'unhandled error in a request')
    res.status(500).json({ error: 'Something went wrong' }) // never leak internals
  })

  return app
}
