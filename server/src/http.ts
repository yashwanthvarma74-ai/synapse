import type { NextFunction, Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { oid } from './db.js'
import { m } from './telemetry.js'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export type AuthedRequest = Request & { userId: string }

// Lets a handler be async: whatever it throws goes to the error middleware
export const route = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req as AuthedRequest, res).catch(next)

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return result.data
}

// A malformed id is a 404, the same as an unknown one
export function idParam(value: string): ObjectId {
  const id = oid(value)
  if (!id) throw new HttpError(404, 'Not found')
  return id
}

export const email = z.string().trim().toLowerCase().email().max(200)
export const roleSchema = z.enum(['owner', 'editor', 'commenter', 'viewer'])

export const publicUser = (u: { _id: ObjectId; email: string; name: string }) => ({ id: u._id.toHexString(), email: u.email, name: u.name })

// Per-IP limiter kept in memory. Fine for one API process; with several, move it to Redis.
export function rateLimit(max: number, windowMs: number) {
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

export const limitFromEnv = (name: string, fallback: number) => Number(process.env[name] ?? fallback)
