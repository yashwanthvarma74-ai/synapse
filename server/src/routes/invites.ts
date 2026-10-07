import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { atLeast } from '../access.js'
import { HttpError, idParam, limitFromEnv, parse, rateLimit, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

const INVITE_DAYS = 7
const DAY_MS = 86_400_000

// 16 random bytes are 128 bits, too many to guess. base64url keeps the code safe inside a link.
const newCode = () => randomBytes(16).toString('base64url')

// An invite link gives whoever opens it the chosen role (never owner) until it expires or is revoked.
export function inviteRoutes(ctx: ApiContext) {
  const { c, bus } = ctx
  const { workspaceRole } = guards(ctx)
  const router = Router()
  const publicLimit = rateLimit(limitFromEnv('INVITE_RATE_LIMIT', 60), 60_000)

  router.get('/workspaces/:id/invites', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    const live = await c.invites.find({ workspaceId, revoked: false, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(50).toArray()
    res.json(live.map((i) => ({ code: i.code, role: i.role, expiresAt: i.expiresAt, uses: i.uses })))
  }))

  router.post('/workspaces/:id/invites', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    const { role } = parse(z.object({ role: z.enum(['editor', 'commenter', 'viewer']).default('editor') }), req.body ?? {})
    const invite = {
      _id: new ObjectId(), code: newCode(), workspaceId, role, createdBy: idParam(req.userId),
      createdAt: new Date(), expiresAt: new Date(Date.now() + INVITE_DAYS * DAY_MS), revoked: false, uses: 0,
    }
    await c.invites.insertOne(invite)
    res.status(201).json({ code: invite.code, role, expiresAt: invite.expiresAt })
  }))

  router.delete('/workspaces/:id/invites/:code', needAuth, route(async (req, res) => {
    const workspaceId = idParam(req.params.id as string)
    await workspaceRole(req.userId, workspaceId, 'owner')
    await c.invites.updateOne({ code: String(req.params.code), workspaceId }, { $set: { revoked: true } })
    res.status(204).end()
  }))

  const liveInvite = async (code: string) => {
    const invite = await c.invites.findOne({ code })
    if (!invite || invite.revoked || invite.expiresAt <= new Date()) throw new HttpError(404, 'This invite link is not valid any more. Ask for a new one.')
    return invite
  }

  // Public: what the link is for, so the page can say who invited you and to what
  router.get('/invites/:code', publicLimit, route(async (req, res) => {
    const invite = await liveInvite(String(req.params.code))
    const [workspace, inviter] = await Promise.all([c.workspaces.findOne({ _id: invite.workspaceId }), c.users.findOne({ _id: invite.createdBy })])
    res.json({ workspaceName: workspace?.name ?? 'a workspace', inviterName: inviter?.name ?? 'Someone', role: invite.role })
  }))

  router.post('/invites/:code/accept', publicLimit, needAuth, route(async (req, res) => {
    const invite = await liveInvite(String(req.params.code))
    const userId = idParam(req.userId)
    const existing = await c.memberships.findOne({ workspaceId: invite.workspaceId, userId })
    // someone who already has more access than the link gives keeps it
    if (!existing || !atLeast(existing.role, invite.role)) {
      await c.memberships.updateOne({ workspaceId: invite.workspaceId, userId }, { $set: { role: invite.role }, $setOnInsert: { _id: new ObjectId() } }, { upsert: true })
      bus.publishAccess({ userId: req.userId, workspaceId: invite.workspaceId.toHexString() })
    }
    await c.invites.updateOne({ _id: invite._id }, { $inc: { uses: 1 } })
    const [latest] = await c.documents.find({ workspaceId: invite.workspaceId }).sort({ updatedAt: -1 }).limit(1).toArray()
    res.json({ workspaceId: invite.workspaceId.toHexString(), documentId: latest?._id.toHexString() ?? null })
  }))

  return router
}
