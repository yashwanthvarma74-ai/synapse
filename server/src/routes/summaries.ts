import { Router } from 'express'
import * as Y from 'yjs'
import { logger } from '../logger.js'
import { mergeStored } from '../store.js'
import { describe } from '../summarize.js'
import { HttpError, idParam, limitFromEnv, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

const HOUR_MS = 3_600_000

// Anyone who can read a document may ask for a summary. Each call costs money, so a person gets a few an hour.
export function summaryRoutes(ctx: ApiContext) {
  const { c, store, summarize } = ctx
  const { documentRole } = guards(ctx)
  const router = Router()
  const perHour = limitFromEnv('SUMMARIES_PER_HOUR', 10)
  const recentByUser = new Map<string, number[]>()

  router.post('/documents/:id/summarize', needAuth, route(async (req, res) => {
    if (!summarize) throw new HttpError(501, 'AI summaries are not turned on for this server')
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'viewer')

    const now = Date.now()
    const recent = (recentByUser.get(req.userId) ?? []).filter((t) => now - t < HOUR_MS)
    if (recent.length >= perHour) throw new HttpError(429, `You can ask for ${perHour} summaries an hour. Try again later.`)

    const meta = await c.documents.findOne({ _id: docId })
    if (!meta) throw new HttpError(404, 'Not found')
    const saved = new Y.Doc()
    Y.applyUpdate(saved, mergeStored(await store.load(docId.toHexString())))
    const content = describe(saved, meta.type)
    const emptyBoard = meta.type === 'canvas' && !/^- /m.test(content)
    if (!content.trim() || emptyBoard) throw new HttpError(400, 'There is nothing to summarize yet. Add some content first.')

    try {
      const summary = await summarize({ kind: meta.type, title: meta.title, content })
      recentByUser.set(req.userId, [...recent, now]) // only a delivered summary counts: an AI outage is not the person's fault
      res.json({ summary })
    } catch (err) {
      logger.error({ err: String(err), docId: docId.toHexString() }, 'summary failed')
      throw new HttpError(502, 'The AI service could not write a summary right now. Try again in a minute.')
    }
  }))

  return router
}
