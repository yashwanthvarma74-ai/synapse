// REST API: accounts, workspaces, documents, members, comments, versions, search.
// Every request body is validated with Zod; every route checks the caller's role
// ON THE SERVER. Nothing here trusts the client about who it is or what it may do.
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { randomBytes, randomInt } from 'node:crypto'
import type { Collections } from './db.js'
import { oid, SEARCH_INDEX } from './db.js'
import { logger } from './logger.js'
import type { MongoStore } from './mongoStore.js'
import type { Bus } from './bus.js'
import type { Role } from './room.js'
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js'
import { atLeast, roleOnDocument, roleOnWorkspace } from './access.js'
import { m, recordClientMetric } from './telemetry.js'
import { createStarterWorkspace } from './onboarding.js'
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, type Storage } from './storage.js'

export interface ApiOptions {
  c: Collections
  store: MongoStore
  bus: Bus
  secret: string
  corsOrigin?: string
  storage?: Storage | null // object storage for uploads (S3 / R2 / MinIO); null = uploads off
  publicUrl?: string // the public address of this API, used in file links
  atlasSearch?: boolean // use Atlas Search for /search (needs MongoDB Atlas); otherwise the $text index
  guestsEnabled?: boolean // one-click guest accounts (default on)
  maxGuestsPerHour?: number // simple ceiling against abuse
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type AuthedReq = Request & { userId: string }
type Handler = (req: AuthedReq, res: Response) => Promise<unknown>
// Wrap async handlers so a thrown error reaches the error middleware
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req as AuthedReq, res).catch(next)

const ROLES = z.enum(['owner', 'editor', 'commenter', 'viewer'])
const email = z.string().trim().toLowerCase().email().max(200)

// Tiny in-memory rate limiter for login/register (per IP). Fine for one API
// instance; a shared limiter (Redis) is the next step when scaling out.
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown'
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      m.rateLimited.add(1)
      return next(new HttpError(429, 'Too many attempts, try again later'))
    }
    recent.push(now)
    hits.set(key, recent)
    next()
  }
}

const ADJECTIVES = ['Curious', 'Brave', 'Calm', 'Clever', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lively', 'Mellow', 'Swift', 'Witty']
const ANIMALS = ['Otter', 'Panda', 'Falcon', 'Heron', 'Lynx', 'Koala', 'Fox', 'Owl', 'Dolphin', 'Gecko', 'Badger', 'Robin']
const guestName = () => `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)]}`
// 16 random bytes = 128 bits: not guessable. base64url keeps it safe inside a link.
const newInviteCode = () => randomBytes(16).toString('base64url')
const INVITE_DAYS = 7

export function createApi({ c, store, bus, secret, corsOrigin, storage = null, publicUrl, atlasSearch = false, guestsEnabled = true, maxGuestsPerHour = 300 }: ApiOptions) {
  const app = express()
  // comma-separated list of allowed web origins
  app.use(cors({ origin: (corsOrigin ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',') }))
  app.use(express.json({ limit: '100kb' }))

  // Time every request. The label is the ROUTE PATTERN (/documents/:id), never the real
  // URL, so the number of time series stays small and ids never reach the metrics.
  app.use((req, res, next) => {
    const t0 = performance.now()
    res.on('finish', () => {
      const route = req.route?.path ? String(req.route.path) : res.statusCode === 404 ? 'unmatched' : 'other'
      const ms = performance.now() - t0
      m.httpDuration.record(ms, { method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` })
      // access log: the route pattern, never the real URL (invite codes live in paths)
      if (route !== '/health' && route !== '/telemetry') logger.info({ method: req.method, route, status: res.statusCode, ms: Math.round(ms) }, 'request')
    })
    next()
  })

  const authLimit = rateLimit(Number(process.env.AUTH_RATE_LIMIT ?? 20), 60_000)

  // ---- auth middleware ------------------------------------------------------
  app.use(async (req, _res, next) => {
    const header = req.headers.authorization
    const userId = await verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : null, secret)
    ;(req as Partial<AuthedReq>).userId = userId ?? undefined
    next()
  })
  const needAuth = (req: Request, _res: Response, next: NextFunction) =>
    (req as Partial<AuthedReq>).userId
      ? next()
      : (m.authFailures.add(1, { kind: 'token' }), next(new HttpError(401, 'Sign in required')))

  const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
    const r = schema.safeParse(data)
    if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return r.data
  }
  const idParam = (v: string) => {
    const id = oid(v)
    if (!id) throw new HttpError(404, 'Not found')
    return id
  }
  // 404 (not 403) when you aren't a member: don't reveal that the thing exists
  const needWorkspaceRole = async (userId: string, workspaceId: ObjectId, min: Role) => {
    const role = await roleOnWorkspace(c, userId, workspaceId.toHexString())
    if (role === null) throw new HttpError(404, 'Not found')
    if (!atLeast(role, min)) throw new HttpError(403, `Requires ${min} access`)
    return role
  }
  const needDocRole = async (userId: string, docId: ObjectId, min: Role) => {
    const role = await roleOnDocument(c, userId, docId.toHexString())
    if (role === null) throw new HttpError(404, 'Not found')
    if (!atLeast(role, min)) throw new HttpError(403, `Requires ${min} access`)
    return role
  }
  const publicUser = (u: { _id: ObjectId; email: string; name: string }) => ({ id: u._id.toHexString(), email: u.email, name: u.name })

  // ---- accounts ------------------------------------------------------------------
  app.post('/auth/register', authLimit, h(async (req, res) => {
    const body = parse(z.object({ email, name: z.string().trim().min(1).max(60), password: z.string().min(8).max(200) }), req.body)
    const user = { _id: new ObjectId(), email: body.email, name: body.name, passwordHash: await hashPassword(body.password), createdAt: new Date() }
    try {
      await c.users.insertOne(user)
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new HttpError(409, 'That email is already registered')
      throw e
    }
    await createStarterWorkspace(c, store, user._id) // a Welcome document and a sample board, so the first screen is not empty
    res.status(201).json({ token: await signToken(user._id.toHexString(), secret), user: publicUser(user) })
  }))

  // One click, no form: a throwaway account with the same starter content. It can be
  // upgraded to a real account later without losing anything (POST /auth/upgrade).
  const guestWindow: number[] = []
  app.post('/auth/guest', authLimit, h(async (_req, res) => {
    if (!guestsEnabled) throw new HttpError(403, 'Guest accounts are turned off on this server')
    const now = Date.now()
    while (guestWindow.length && now - guestWindow[0] > 3_600_000) guestWindow.shift()
    if (guestWindow.length >= maxGuestsPerHour) throw new HttpError(429, 'Too many new guests right now, please try again in a little while')
    guestWindow.push(now)
    const id = new ObjectId()
    const user = {
      _id: id, email: `guest-${id.toHexString()}@guest.invalid`, name: guestName(), guest: true as const,
      passwordHash: await hashPassword(randomBytes(32).toString('hex')), // nobody knows it: a guest cannot sign in again by password
      createdAt: new Date(),
    }
    await c.users.insertOne(user)
    const starter = await createStarterWorkspace(c, store, id)
    res.status(201).json({ token: await signToken(id.toHexString(), secret), user: { ...publicUser(user), guest: true }, starter })
  }))

  // Turn a guest into a real account, keeping everything they made.
  app.post('/auth/upgrade', authLimit, needAuth, h(async (req, res) => {
    const body = parse(z.object({ email, name: z.string().trim().min(1).max(60), password: z.string().min(8).max(200) }), req.body)
    const me = await c.users.findOne({ _id: idParam(req.userId) })
    if (!me?.guest) throw new HttpError(400, 'This account is already a full account')
    try {
      await c.users.updateOne({ _id: me._id }, { $set: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) }, $unset: { guest: '' } })
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new HttpError(409, 'That email is already registered')
      throw e
    }
    res.json({ token: await signToken(me._id.toHexString(), secret), user: { id: me._id.toHexString(), email: body.email, name: body.name } })
  }))

  app.post('/auth/login', authLimit, h(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body)
    const user = await c.users.findOne({ email: body.email })
    // same error for "no such user" and "wrong password": don't leak which emails exist
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      m.authFailures.add(1, { kind: 'login' })
      throw new HttpError(401, 'Wrong email or password')
    }
    res.json({ token: await signToken(user._id.toHexString(), secret), user: publicUser(user) })
  }))

  app.get('/me', needAuth, h(async (req, res) => {
    const user = await c.users.findOne({ _id: idParam(req.userId) })
    if (!user) throw new HttpError(401, 'Sign in required')
    res.json({ ...publicUser(user), guest: user.guest === true })
  }))

  // ---- workspaces and members --------------------------------------------------------
  app.get('/workspaces', needAuth, h(async (req, res) => {
    const ms = await c.memberships.find({ userId: idParam(req.userId) }).toArray()
    const ws = await c.workspaces.find({ _id: { $in: ms.map((m) => m.workspaceId) } }).toArray()
    const roleOf = new Map(ms.map((m) => [m.workspaceId.toHexString(), m.role]))
    res.json(ws.map((w) => ({ id: w._id.toHexString(), name: w.name, role: roleOf.get(w._id.toHexString()) })))
  }))

  app.post('/workspaces', needAuth, h(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body)
    const userId = idParam(req.userId)
    const w = { _id: new ObjectId(), name, ownerId: userId, createdAt: new Date() }
    await c.workspaces.insertOne(w)
    await c.memberships.insertOne({ _id: new ObjectId(), workspaceId: w._id, userId, role: 'owner' })
    res.status(201).json({ id: w._id.toHexString(), name, role: 'owner' })
  }))

  app.get('/workspaces/:id/members', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'viewer')
    const ms = await c.memberships.find({ workspaceId: wid }).toArray()
    const users = await c.users.find({ _id: { $in: ms.map((m) => m.userId) } }).toArray()
    const byId = new Map(users.map((u) => [u._id.toHexString(), u]))
    res.json(ms.map((m) => ({ ...publicUser(byId.get(m.userId.toHexString())!), role: m.role })))
  }))

  // Add or change a member (owner only). Changing a role pushes an access event so
  // open sockets are re-checked immediately.
  app.put('/workspaces/:id/members', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'owner')
    const body = parse(z.object({ email, role: ROLES }), req.body)
    const target = await c.users.findOne({ email: body.email })
    if (!target) throw new HttpError(404, 'No user with that email')
    const ws = await c.workspaces.findOne({ _id: wid })
    if (ws!.ownerId.equals(target._id) && body.role !== 'owner') throw new HttpError(400, "The workspace owner's role can't be lowered")
    await c.memberships.updateOne(
      { workspaceId: wid, userId: target._id },
      { $set: { role: body.role }, $setOnInsert: { _id: new ObjectId() } },
      { upsert: true },
    )
    bus.publishAccess({ userId: target._id.toHexString(), workspaceId: wid.toHexString() })
    res.json({ ...publicUser(target), role: body.role })
  }))

  app.delete('/workspaces/:id/members/:userId', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    const uid = idParam(req.params.userId as string)
    await needWorkspaceRole(req.userId, wid, 'owner')
    const ws = await c.workspaces.findOne({ _id: wid })
    if (ws!.ownerId.equals(uid)) throw new HttpError(400, "The workspace owner can't be removed")
    await c.memberships.deleteOne({ workspaceId: wid, userId: uid })
    bus.publishAccess({ userId: uid.toHexString(), workspaceId: wid.toHexString() })
    res.status(204).end()
  }))

  // ---- invite links --------------------------------------------------------------------
  // The owner makes a link; anyone who opens it and joins gets the chosen role (never owner).
  // Links expire after 7 days and can be revoked. Whoever holds the link can join, so share it
  // like you would share a document link.
  app.get('/workspaces/:id/invites', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'owner')
    const live = await c.invites.find({ workspaceId: wid, revoked: false, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(50).toArray()
    res.json(live.map((i) => ({ code: i.code, role: i.role, expiresAt: i.expiresAt, uses: i.uses })))
  }))

  app.post('/workspaces/:id/invites', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'owner')
    const { role } = parse(z.object({ role: z.enum(['editor', 'commenter', 'viewer']).default('editor') }), req.body ?? {})
    const invite = { _id: new ObjectId(), code: newInviteCode(), workspaceId: wid, role, createdBy: idParam(req.userId),
      createdAt: new Date(), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), revoked: false, uses: 0 }
    await c.invites.insertOne(invite)
    res.status(201).json({ code: invite.code, role, expiresAt: invite.expiresAt })
  }))

  app.delete('/workspaces/:id/invites/:code', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'owner')
    await c.invites.updateOne({ code: String(req.params.code), workspaceId: wid }, { $set: { revoked: true } })
    res.status(204).end()
  }))

  // Public: what the link is for, so the page can say "Ravi invited you to Team Alpha as an editor".
  const inviteLimit = rateLimit(Number(process.env.INVITE_RATE_LIMIT ?? 60), 60_000)
  const liveInvite = async (code: string) => {
    const inv = await c.invites.findOne({ code })
    if (!inv || inv.revoked || inv.expiresAt <= new Date()) throw new HttpError(404, 'This invite link is not valid any more. Ask for a new one.')
    return inv
  }
  app.get('/invites/:code', inviteLimit, h(async (req, res) => {
    const inv = await liveInvite(String(req.params.code))
    const [ws, inviter] = await Promise.all([c.workspaces.findOne({ _id: inv.workspaceId }), c.users.findOne({ _id: inv.createdBy })])
    res.json({ workspaceName: ws?.name ?? 'a workspace', inviterName: inviter?.name ?? 'Someone', role: inv.role })
  }))

  app.post('/invites/:code/accept', inviteLimit, needAuth, h(async (req, res) => {
    const inv = await liveInvite(String(req.params.code))
    const userId = idParam(req.userId)
    const existing = await c.memberships.findOne({ workspaceId: inv.workspaceId, userId })
    // never downgrade someone who already has more access than the link gives
    if (!existing || !atLeast(existing.role, inv.role)) {
      await c.memberships.updateOne({ workspaceId: inv.workspaceId, userId }, { $set: { role: inv.role }, $setOnInsert: { _id: new ObjectId() } }, { upsert: true })
      bus.publishAccess({ userId: req.userId, workspaceId: inv.workspaceId.toHexString() })
    }
    await c.invites.updateOne({ _id: inv._id }, { $inc: { uses: 1 } })
    const first = await c.documents.find({ workspaceId: inv.workspaceId }).sort({ updatedAt: -1 }).limit(1).toArray()
    res.json({ workspaceId: inv.workspaceId.toHexString(), documentId: first[0]?._id.toHexString() ?? null })
  }))

  // ---- documents ---------------------------------------------------------------------
  app.get('/workspaces/:id/documents', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'viewer')
    const docs = await c.documents.find({ workspaceId: wid }, { projection: { text: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray()
    res.json(docs.map((d) => ({ id: d._id.toHexString(), title: d.title, type: d.type, updatedAt: d.updatedAt })))
  }))

  app.post('/workspaces/:id/documents', needAuth, h(async (req, res) => {
    const wid = idParam(req.params.id as string)
    await needWorkspaceRole(req.userId, wid, 'editor')
    const body = parse(z.object({ title: z.string().trim().min(1).max(120), type: z.enum(['doc', 'canvas']).default('doc') }), req.body)
    const now = new Date()
    const d = { _id: new ObjectId(), workspaceId: wid, title: body.title, type: body.type, text: '', createdAt: now, updatedAt: now }
    await c.documents.insertOne(d)
    res.status(201).json({ id: d._id.toHexString(), title: d.title, type: d.type })
  }))

  app.get('/documents/:id', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    const role = await needDocRole(req.userId, did, 'viewer')
    const d = await c.documents.findOne({ _id: did }, { projection: { text: 0 } })
    res.json({ id: did.toHexString(), title: d!.title, type: d!.type, workspaceId: d!.workspaceId.toHexString(), role })
  }))

  app.patch('/documents/:id', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'editor')
    const { title } = parse(z.object({ title: z.string().trim().min(1).max(120) }), req.body)
    await c.documents.updateOne({ _id: did }, { $set: { title } })
    res.json({ id: did.toHexString(), title })
  }))

  // ---- comments -------------------------------------------------------------------------
  app.get('/documents/:id/comments', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'viewer')
    const cs = await c.comments.find({ docId: did }).sort({ createdAt: 1 }).limit(500).toArray()
    res.json(cs.map((x) => ({ id: x._id.toHexString(), authorId: x.authorId.toHexString(), authorName: x.authorName,
      body: x.body, quote: x.quote ?? '', anchor: x.anchor, parentId: x.parentId?.toHexString() ?? null, resolved: x.resolved, createdAt: x.createdAt })))
  }))

  app.post('/documents/:id/comments', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'commenter') // viewers can read comments but not write them
    const body = parse(z.object({ body: z.string().trim().min(1).max(4000), anchor: z.string().max(2000).nullable().default(null), quote: z.string().max(500).default(''),
      parentId: z.string().nullable().default(null) }), req.body)
    const author = await c.users.findOne({ _id: idParam(req.userId) })
    const doc = { _id: new ObjectId(), docId: did, authorId: author!._id, authorName: author!.name, body: body.body,
      anchor: body.anchor, quote: body.quote, parentId: body.parentId ? idParam(body.parentId) : null, resolved: false, createdAt: new Date() }
    await c.comments.insertOne(doc)
    res.status(201).json({ id: doc._id.toHexString() })
  }))

  app.patch('/comments/:id', needAuth, h(async (req, res) => {
    const cm = await c.comments.findOne({ _id: idParam(req.params.id as string) })
    if (!cm) throw new HttpError(404, 'Not found')
    const role = await needDocRole(req.userId, cm.docId, 'commenter')
    const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body)
    if (!cm.authorId.equals(req.userId) && !atLeast(role, 'editor')) throw new HttpError(403, 'Only the author or an editor can resolve this')
    await c.comments.updateOne({ _id: cm._id }, { $set: { resolved } })
    res.json({ id: cm._id.toHexString(), resolved })
  }))

  app.delete('/comments/:id', needAuth, h(async (req, res) => {
    const cm = await c.comments.findOne({ _id: idParam(req.params.id as string) })
    if (!cm) throw new HttpError(404, 'Not found')
    const role = await needDocRole(req.userId, cm.docId, 'commenter')
    if (!cm.authorId.equals(req.userId) && !atLeast(role, 'editor')) throw new HttpError(403, 'Only the author or an editor can delete this')
    await c.comments.deleteMany({ $or: [{ _id: cm._id }, { parentId: cm._id }] })
    res.status(204).end()
  }))

  // ---- version history -----------------------------------------------------------------------
  app.get('/documents/:id/versions', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'viewer')
    res.json(await store.listVersions(did.toHexString()))
  }))

  app.post('/documents/:id/versions', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'editor')
    const { label } = parse(z.object({ label: z.string().trim().min(1).max(80) }), req.body)
    res.status(201).json({ version: await store.saveNamedVersion(did.toHexString(), label, req.userId) })
  }))

  // The raw Yjs state of a named version, so the browser can preview or restore it
  app.get('/documents/:id/versions/:version', needAuth, h(async (req, res) => {
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'viewer')
    const state = await store.getVersionState(did.toHexString(), Number(req.params.version))
    if (!state) throw new HttpError(404, 'Not found')
    res.type('application/octet-stream').send(Buffer.from(state))
  }))

  // ---- search -----------------------------------------------------------------------------------
  // Searches only workspaces the caller belongs to. On Atlas this uses Atlas Search (typo
  // tolerant, ranked); anywhere else, or while the Atlas index is still building, it falls back
  // to the plain MongoDB $text index.
  app.get('/search', needAuth, h(async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query)
    const ms = await c.memberships.find({ userId: idParam(req.userId) }).toArray()
    const workspaceIds = ms.map((m) => m.workspaceId)
    let found: Array<{ _id: ObjectId; title: string; workspaceId: ObjectId; text: string }> | null = null
    if (atlasSearch) {
      try {
        found = await c.documents.aggregate<{ _id: ObjectId; title: string; workspaceId: ObjectId; text: string }>([
          { $search: { index: SEARCH_INDEX, compound: {
            must: [{ text: { query: q, path: ['title', 'text'], fuzzy: { maxEdits: 1, prefixLength: 2 } } }],
            filter: [{ in: { path: 'workspaceId', value: workspaceIds } }],
          } } },
          { $limit: 20 },
          { $project: { title: 1, workspaceId: 1, text: 1 } },
        ]).toArray()
      } catch (err) {
        logger.warn({ err: String(err) }, 'atlas search failed, using $text')
      }
    }
    found ??= await c.documents
      .find({ workspaceId: { $in: workspaceIds }, $text: { $search: q } },
        { projection: { score: { $meta: 'textScore' }, title: 1, workspaceId: 1, text: 1 } })
      .sort({ score: { $meta: 'textScore' } }).limit(20).toArray()
    res.json(found.map((d) => ({ id: d._id.toHexString(), title: d.title, workspaceId: d.workspaceId.toHexString(),
      snippet: snippet(d.text, q) })))
  }))

  // ---- uploads (pre-signed, straight to object storage) ----------------------------------------------
  // 1. The editor asks for permission to upload ONE file: name, type, size. Editors only.
  // 2. We answer with a short-lived URL signed for exactly that key, type and size.
  // 3. The browser PUTs the bytes to the bucket itself. Our server never sees them.
  // 4. The document stores the file's link, /files/<doc>/<random-name>. That link is a capability:
  //    the 128-bit random name cannot be guessed, and it redirects to a fresh short-lived download URL.
  const uploadLimit = rateLimit(Number(process.env.UPLOAD_RATE_LIMIT ?? 60), 60_000)
  app.post('/documents/:id/uploads', uploadLimit, needAuth, h(async (req, res) => {
    if (!storage) throw new HttpError(501, 'Uploads are not set up on this server')
    const did = idParam(req.params.id as string)
    await needDocRole(req.userId, did, 'editor')
    const { name, contentType, size } = parse(z.object({
      name: z.string().trim().min(1).max(200),
      contentType: z.string().max(100),
      size: z.number().int().positive(),
    }), req.body)
    const kind = ALLOWED_TYPES[contentType]
    if (!kind) throw new HttpError(415, 'That kind of file is not allowed. Use PNG, JPEG, GIF, WebP, PDF or plain text.')
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `That file is too big. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
    const fileName = `${randomBytes(16).toString('hex')}.${kind.ext}`
    const key = `${did.toHexString()}/${fileName}`
    const base = publicUrl ?? `${req.protocol}://${req.get('host')}`
    res.status(201).json({ uploadUrl: await storage.presignPut(key, contentType, size), url: `${base}/files/${key}`, name, image: kind.image })
  }))

  // Public by design (see above). Redirects to a download URL that expires in minutes.
  app.get('/files/:doc/:name', h(async (req, res) => {
    if (!storage) throw new HttpError(404, 'Not found')
    const doc = String(req.params.doc), name = String(req.params.name)
    if (!/^[a-f0-9]{24}$/.test(doc) || !/^[a-f0-9]{32}\.(png|jpg|gif|webp|pdf|txt)$/.test(name)) throw new HttpError(404, 'Not found')
    const image = /\.(png|jpg|gif|webp)$/.test(name)
    res.set('cache-control', 'private, max-age=300')
    res.redirect(302, await storage.presignGet(`${doc}/${name}`, image ? undefined : { download: name }))
  }))

  // Browsers report timings here (round trip, time to sync, key-to-paint, reconnects).
  // Strictly validated: only known names, only known label values, only sane numbers.
  const telemetryLimit = rateLimit(Number(process.env.TELEMETRY_RATE_LIMIT ?? 60), 60_000)
  app.post('/telemetry', telemetryLimit, needAuth, h(async (req, res) => {
    const { events } = parse(
      z.object({ events: z.array(z.object({ n: z.string().max(40), v: z.number().optional(), l: z.record(z.string().max(20), z.string().max(20)).optional() })).max(100) }),
      req.body,
    )
    let accepted = 0
    for (const e of events) if (recordClientMetric(e.n, e.v ?? 1, e.l ?? {})) accepted++
    res.json({ accepted, rejected: events.length - accepted })
  }))

  app.get('/health', (_req, res) => void res.json({ ok: true }))
  app.use((_req, res) => void res.status(404).json({ error: 'Not found' })) // unknown routes

  // ---- errors ----------------------------------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message })
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON' })
    logger.error({ err }, 'unhandled error in a request')
    res.status(500).json({ error: 'Something went wrong' }) // never leak internals
  })

  return app
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0])
  const start = Math.max(0, i - 40)
  return (start > 0 ? '…' : '') + text.slice(start, start + 140).trim()
}
