import { Router } from 'express'
import { randomBytes, randomInt } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { hashPassword, signToken, verifyPassword } from '../auth.js'
import { createStarterWorkspace } from '../onboarding.js'
import { m } from '../telemetry.js'
import { email, HttpError, idParam, limitFromEnv, parse, publicUser, rateLimit, route } from '../http.js'
import { needAuth, type ApiContext } from './context.js'

const ADJECTIVES = ['Curious', 'Brave', 'Calm', 'Clever', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lively', 'Mellow', 'Swift', 'Witty']
const ANIMALS = ['Otter', 'Panda', 'Falcon', 'Heron', 'Lynx', 'Koala', 'Fox', 'Owl', 'Dolphin', 'Gecko', 'Badger', 'Robin']
const guestName = () => `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)]}`

// A guest has no password, so an expired token would lock them out of their own work.
// Guests get a month, the same time the cleanup script keeps them for.
const GUEST_TOKEN_DAYS = 30
const DUPLICATE_KEY = 11000

const account = z.object({ email, name: z.string().trim().min(1).max(60), password: z.string().min(8).max(200) })

export function authRoutes({ c, store, secret, guestsEnabled, maxGuestsPerHour }: ApiContext) {
  const router = Router()
  const limit = rateLimit(limitFromEnv('AUTH_RATE_LIMIT', 20), 60_000)

  const taken = (e: unknown) => (e as { code?: number }).code === DUPLICATE_KEY

  router.post('/auth/register', limit, route(async (req, res) => {
    const body = parse(account, req.body)
    const user = { _id: new ObjectId(), email: body.email, name: body.name, passwordHash: await hashPassword(body.password), createdAt: new Date() }
    try {
      await c.users.insertOne(user)
    } catch (e) {
      throw taken(e) ? new HttpError(409, 'That email is already registered') : e
    }
    await createStarterWorkspace(c, store, user._id)
    res.status(201).json({ token: await signToken(user._id.toHexString(), secret), user: publicUser(user) })
  }))

  // One click, no form: a throwaway account with the same starter content
  const recentGuests: number[] = []
  router.post('/auth/guest', limit, route(async (_req, res) => {
    if (!guestsEnabled) throw new HttpError(403, 'Guest accounts are turned off on this server')
    const now = Date.now()
    while (recentGuests.length && now - recentGuests[0] > 3_600_000) recentGuests.shift()
    if (recentGuests.length >= maxGuestsPerHour) throw new HttpError(429, 'Too many new guests right now, please try again in a little while')
    recentGuests.push(now)

    const id = new ObjectId()
    const user = {
      _id: id,
      email: `guest-${id.toHexString()}@guest.invalid`,
      name: guestName(),
      guest: true as const,
      passwordHash: await hashPassword(randomBytes(32).toString('hex')), // nobody knows it, so a guest never signs in by password
      createdAt: new Date(),
    }
    await c.users.insertOne(user)
    const starter = await createStarterWorkspace(c, store, id)
    res.status(201).json({ token: await signToken(id.toHexString(), secret, `${GUEST_TOKEN_DAYS}d`), user: { ...publicUser(user), guest: true }, starter })
  }))

  // Turn a guest into a real account, keeping everything they made
  router.post('/auth/upgrade', limit, needAuth, route(async (req, res) => {
    const body = parse(account, req.body)
    const me = await c.users.findOne({ _id: idParam(req.userId) })
    if (!me?.guest) throw new HttpError(400, 'This account is already a full account')
    try {
      await c.users.updateOne({ _id: me._id }, { $set: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) }, $unset: { guest: '' } })
    } catch (e) {
      throw taken(e) ? new HttpError(409, 'That email is already registered') : e
    }
    res.json({ token: await signToken(me._id.toHexString(), secret), user: { id: me._id.toHexString(), email: body.email, name: body.name } })
  }))

  router.post('/auth/login', limit, route(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body)
    const user = await c.users.findOne({ email: body.email })
    // the same answer for an unknown email and a wrong password, so emails cannot be probed
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      m.authFailures.add(1, { kind: 'login' })
      throw new HttpError(401, 'Wrong email or password')
    }
    res.json({ token: await signToken(user._id.toHexString(), secret), user: publicUser(user) })
  }))

  router.get('/me', needAuth, route(async (req, res) => {
    const user = await c.users.findOne({ _id: idParam(req.userId) })
    if (!user) throw new HttpError(401, 'Sign in required')
    res.json({ ...publicUser(user), guest: user.guest === true })
  }))

  return router
}
