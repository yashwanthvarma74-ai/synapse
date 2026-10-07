import { Router } from 'express'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'
import { SEARCH_INDEX } from '../db.js'
import { logger } from '../logger.js'
import { idParam, parse, route } from '../http.js'
import { needAuth, type ApiContext } from './context.js'

interface Hit {
  _id: ObjectId
  title: string
  workspaceId: ObjectId
  text: string
}

function snippet(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0])
  const start = Math.max(0, at - 40)
  return (start > 0 ? '…' : '') + text.slice(start, start + 140).trim()
}

// Only searches the workspaces the caller belongs to. Atlas Search tolerates typos and ranks results;
// anywhere else (or while its index is still building) the plain MongoDB text index answers instead.
export function searchRoutes({ c, atlasSearch }: ApiContext) {
  const router = Router()

  router.get('/search', needAuth, route(async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query)
    const memberships = await c.memberships.find({ userId: idParam(req.userId) }).toArray()
    const workspaceIds = memberships.map((m) => m.workspaceId)

    let hits: Hit[] | null = null
    if (atlasSearch) {
      try {
        hits = await c.documents.aggregate<Hit>([
          { $search: { index: SEARCH_INDEX, compound: {
            must: [{ text: { query: q, path: ['title', 'text'], fuzzy: { maxEdits: 1, prefixLength: 2 } } }],
            filter: [{ in: { path: 'workspaceId', value: workspaceIds } }],
          } } },
          { $limit: 20 },
          { $project: { title: 1, workspaceId: 1, text: 1 } },
        ]).toArray()
      } catch (err) {
        logger.warn({ err: String(err) }, 'atlas search failed, using the text index')
      }
    }
    hits ??= await c.documents
      .find({ workspaceId: { $in: workspaceIds }, $text: { $search: q } }, { projection: { score: { $meta: 'textScore' }, title: 1, workspaceId: 1, text: 1 } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(20)
      .toArray()

    res.json(hits.map((d) => ({ id: d._id.toHexString(), title: d.title, workspaceId: d.workspaceId.toHexString(), snippet: snippet(d.text, q) })))
  }))

  return router
}
