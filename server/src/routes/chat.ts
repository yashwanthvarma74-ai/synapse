import { Router } from 'express'
import { z } from 'zod'
import { PAGE_SIZE } from '../chat.js'
import { idParam, parse, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

// Anyone who can read a document can read its chat. Messages are sent over the WebSocket (room.ts),
// where every one is checked against the sender's role. Newest page first: pass `before`, the id of
// the oldest message you have, to go further back.
export function chatRoutes(ctx: ApiContext) {
  const { chat } = ctx
  const { documentRole } = guards(ctx)
  const router = Router()

  router.get('/documents/:id/chat', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'viewer')
    const { before, limit } = parse(z.object({
      before: z.string().regex(/^[a-f0-9]{1,40}$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
    }), req.query)
    res.set('cache-control', 'no-store')
    res.json(chat ? await chat.list(docId.toHexString(), { before, limit }) : [])
  }))

  return router
}
