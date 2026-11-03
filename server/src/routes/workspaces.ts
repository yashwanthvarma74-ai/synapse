import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { logger } from '../logger.js'
import { email, HttpError, idParam, parse, publicUser, roleSchema, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

export function workspaceRoutes(ctx: ApiContext) {
  const { c, store, bus, storage, chat } = ctx
  const { workspaceRole } = guards(ctx)
  const router = Router()

  router.get('/workspaces', needAuth, route(async (req, res) => {
    const memberships = await c.memberships.find({ userId: idParam(req.userId) }).toArray()
    const workspaces = await c.workspaces.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).toArray()
    const roleOf = new Map(memberships.map((m) => [m.workspaceId.toHexString(), m.role]))
    res.json(workspaces.map((w) => ({ id: w._id.toHexString(), name: w.name, role: roleOf.get(w._id.toHexString()) })))
  }))

  router.post('/workspaces', needAuth, route(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body)
    const userId = idParam(req.userId)
    const workspace = { _id: new ObjectId(), name, ownerId: userId, createdAt: new Date() }
    await c.workspaces.insertOne(workspace)
    await c.memberships.insertOne({ _id: new ObjectId(), workspaceId: workspace._id, userId, role: 'owner' })
    res.status(201).json({ id: workspace._id.toHexString(), name, role: 'owner' })
  }))

  // Deletes the workspace and everything in it. Owner only, and it cannot be undone.
  // The order lets a failure halfway be retried: content first, then access, then the workspace itself.
  router.delete('/workspaces/:id', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    const docs = await c.documents.find({ workspaceId }, { projection: { _id: 1 } }).toArray()
    const members = await c.memberships.find({ workspaceId }).toArray()

    const wipeContent = async () => {
      for (const { _id } of docs) {
        const id = _id.toHexString()
        await store.deleteDocument(id)
        await chat?.deleteDocument(id)
        await storage?.deletePrefix(`${id}/`).catch((err) => logger.warn({ err: String(err), docId: id }, 'could not delete uploaded files'))
      }
    }
    await c.comments.deleteMany({ docId: { $in: docs.map((d) => d._id) } })
    await wipeContent()
    await c.documents.deleteMany({ workspaceId })
    await c.invites.deleteMany({ workspaceId })
    await c.memberships.deleteMany({ workspaceId })
    await c.workspaces.deleteOne({ _id: workspaceId })

    // gateways close the open connections to these documents when they hear about the change
    for (const member of members) bus.publishAccess({ userId: member.userId.toHexString(), workspaceId: workspaceId.toHexString() })
    // a gateway may still save one last edit while its connections close, so sweep once more shortly after
    setTimeout(() => void wipeContent().catch(() => {}), 5000).unref()
    res.status(204).end()
  }))

  router.get('/workspaces/:id/members', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'viewer')
    const memberships = await c.memberships.find({ workspaceId }).toArray()
    const users = await c.users.find({ _id: { $in: memberships.map((m) => m.userId) } }).toArray()
    const byId = new Map(users.map((u) => [u._id.toHexString(), u]))
    res.json(memberships.map((m) => ({ ...publicUser(byId.get(m.userId.toHexString())!), role: m.role })))
  }))

  // Add someone, or change their role (owner only)
  router.put('/workspaces/:id/members', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    const body = parse(z.object({ email, role: roleSchema }), req.body)
    const target = await c.users.findOne({ email: body.email })
    if (!target) throw new HttpError(404, 'No user with that email')
    const workspace = await c.workspaces.findOne({ _id: workspaceId })
    if (workspace!.ownerId.equals(target._id) && body.role !== 'owner') throw new HttpError(400, "The workspace owner's role can't be lowered")
    await c.memberships.updateOne(
      { workspaceId, userId: target._id },
      { $set: { role: body.role }, $setOnInsert: { _id: new ObjectId() } },
      { upsert: true },
    )
    bus.publishAccess({ userId: target._id.toHexString(), workspaceId: workspaceId.toHexString() })
    res.json({ ...publicUser(target), role: body.role })
  }))

  router.delete('/workspaces/:id/members/:userId', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    const userId = idParam(req.params.userId as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    const workspace = await c.workspaces.findOne({ _id: workspaceId })
    if (workspace!.ownerId.equals(userId)) throw new HttpError(400, "The workspace owner can't be removed")
    await c.memberships.deleteOne({ workspaceId, userId })
    bus.publishAccess({ userId: userId.toHexString(), workspaceId: workspaceId.toHexString() })
    res.status(204).end()
  }))

  return router
}
