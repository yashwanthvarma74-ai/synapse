import { Router } from 'express'
import { z } from 'zod'
import { recordClientMetric } from '../telemetry.js'
import { limitFromEnv, parse, rateLimit, route } from '../http.js'
import { needAuth, type ApiContext } from './context.js'

export function systemRoutes({ storage, summarize, chat }: ApiContext) {
  const router = Router()

  router.get('/health', (_req, res) => void res.json({ ok: true }))

  // What this server can do, so the app only offers what will work
  router.get('/config', (_req, res) => void res.json({ uploads: !!storage, summaries: !!summarize, chat: !!chat }))

  // Browsers report timings here. Only known names, known label values and sane numbers get through.
  const limit = rateLimit(limitFromEnv('TELEMETRY_RATE_LIMIT', 60), 60_000)
  const event = z.object({ n: z.string().max(40), v: z.number().optional(), l: z.record(z.string().max(20), z.string().max(20)).optional() })
  router.post('/telemetry', limit, needAuth, route(async (req, res) => {
    const { events } = parse(z.object({ events: z.array(event).max(100) }), req.body)
    const accepted = events.filter((e) => recordClientMetric(e.n, e.v ?? 1, e.l ?? {})).length
    res.json({ accepted, rejected: events.length - accepted })
  }))

  return router
}
