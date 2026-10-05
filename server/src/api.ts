// REST API: accounts, workspaces, documents, members, comments, versions, search.
// Every request body is validated with Zod; every route checks the caller's role
// ON THE SERVER. Nothing here trusts the client about who it is or what it may do.
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import type { Collections } from './db.js'
import { oid } from './db.js'
import type { MongoStore } from './mongoStore.js'
import type { Bus } from './bus.js'
import type { Role } from './room.js'
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js'
import { atLeast, roleOnDocument, roleOnWorkspace } from './access.js'
import { m, recordClientMetric } from './telemetry.js'

export interface ApiOptions {
  c: Collections
  store: MongoStore
  bus: Bus
  secret: string
  corsOrigin?: string
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

export function createApi({ c, store, bus, secret, corsOrigin }: ApiOptions) {
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
      m.httpDuration.record(performance.now() - t0, { method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` })
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
    res.status(201).json({ token: await signToken(user._id.toHexString(), secret), user: publicUser(user) })
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
    res.json(publicUser(user))
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
  // Searches only workspaces the caller belongs to. (Atlas Search would replace this
  // $text query in production; same shape, better relevance.)
  app.get('/search', needAuth, h(async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query)
    const ms = await c.memberships.find({ userId: idParam(req.userId) }).toArray()
    const found = await c.documents
      .find({ workspaceId: { $in: ms.map((m) => m.workspaceId) }, $text: { $search: q } },
        { projection: { score: { $meta: 'textScore' }, title: 1, workspaceId: 1, text: 1 } })
      .sort({ score: { $meta: 'textScore' } }).limit(20).toArray()
    res.json(found.map((d) => ({ id: d._id.toHexString(), title: d.title, workspaceId: d.workspaceId.toHexString(),
      snippet: snippet(d.text, q) })))
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
    console.error(err)
    res.status(500).json({ error: 'Something went wrong' }) // never leak internals
  })

  return app
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0])
  const start = Math.max(0, i - 40)
  return (start > 0 ? '…' : '') + text.slice(start, start + 140).trim()
}
