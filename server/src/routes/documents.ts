import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { idParam, parse, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

const title = z.string().trim().min(1).max(120)

export function documentRoutes(ctx: ApiContext) {
  const { c } = ctx
  const { workspaceRole, documentRole } = guards(ctx)
  const router = Router()

  router.get('/workspaces/:id/documents', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'viewer')
    const docs = await c.documents.find({ workspaceId }, { projection: { text: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray()
    res.json(docs.map((d) => ({ id: d._id.toHexString(), title: d.title, type: d.type, updatedAt: d.updatedAt })))
  }))

  router.post('/workspaces/:id/documents', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'editor')
    const body = parse(z.object({ title, type: z.enum(['doc', 'canvas']).default('doc') }), req.body)
    const now = new Date()
    const doc = { _id: new ObjectId(), workspaceId, title: body.title, type: body.type, text: '', createdAt: now, updatedAt: now }
    await c.documents.insertOne(doc)
    res.status(201).json({ id: doc._id.toHexString(), title: doc.title, type: doc.type })
  }))

  router.get('/documents/:id', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    const role = await documentRole(req.userId, docId, 'viewer')
    const doc = await c.documents.findOne({ _id: docId }, { projection: { text: 0 } })
    res.json({ id: docId.toHexString(), title: doc!.title, type: doc!.type, workspaceId: doc!.workspaceId.toHexString(), role })
  }))

  router.patch('/documents/:id', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'editor')
    const body = parse(z.object({ title }), req.body)
    await c.documents.updateOne({ _id: docId }, { $set: { title: body.title } })
    res.json({ id: docId.toHexString(), title: body.title })
  }))

  return router
}
