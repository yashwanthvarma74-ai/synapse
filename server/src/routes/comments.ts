import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { atLeast } from '../access.js'
import { HttpError, idParam, parse, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

export function commentRoutes(ctx: ApiContext) {
  const { c } = ctx
  const { documentRole } = guards(ctx)
  const router = Router()

  router.get('/documents/:id/comments', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'viewer')
    const comments = await c.comments.find({ docId }).sort({ createdAt: 1 }).limit(500).toArray()
    res.json(comments.map((x) => ({
      id: x._id.toHexString(), authorId: x.authorId.toHexString(), authorName: x.authorName, body: x.body, quote: x.quote ?? '',
      anchor: x.anchor, parentId: x.parentId?.toHexString() ?? null, resolved: x.resolved, createdAt: x.createdAt,
    })))
  }))

  router.post('/documents/:id/comments', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'commenter') // viewers can read comments but not write them
    const body = parse(z.object({
      body: z.string().trim().min(1).max(4000),
      anchor: z.string().max(2000).nullable().default(null),
      quote: z.string().max(500).default(''),
      parentId: z.string().nullable().default(null),
    }), req.body)
    const author = await c.users.findOne({ _id: idParam(req.userId) })
    const comment = {
      _id: new ObjectId(), docId, authorId: author!._id, authorName: author!.name, body: body.body, anchor: body.anchor, quote: body.quote,
      parentId: body.parentId ? idParam(body.parentId) : null, resolved: false, createdAt: new Date(),
    }
    await c.comments.insertOne(comment)
    res.status(201).json({ id: comment._id.toHexString() })
  }))

  // The author or an editor may change or remove a comment
  const ownCommentOrEditor = async (commentId: string, userId: string, action: string) => {
    const comment = await c.comments.findOne({ _id: idParam(commentId) })
    if (!comment) throw new HttpError(404, 'Not found')
    const role = await documentRole(userId, comment.docId, 'commenter')
    if (!comment.authorId.equals(userId) && !atLeast(role, 'editor')) throw new HttpError(403, `Only the author or an editor can ${action} this`)
    return comment
  }

  router.patch('/comments/:id', needAuth, route(async (req, res) => {
    const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body)
    const comment = await ownCommentOrEditor(req.params.id as string, req.userId, 'resolve')
    await c.comments.updateOne({ _id: comment._id }, { $set: { resolved } })
    res.json({ id: comment._id.toHexString(), resolved })
  }))

  router.delete('/comments/:id', needAuth, route(async (req, res) => {
    const comment = await ownCommentOrEditor(req.params.id as string, req.userId, 'delete')
    await c.comments.deleteMany({ $or: [{ _id: comment._id }, { parentId: comment._id }] })
    res.status(204).end()
  }))

  return router
}
