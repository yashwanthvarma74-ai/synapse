import type { ObjectId } from 'mongodb'
import type { NextFunction, Request, Response } from 'express'
import type { Collections } from '../db.js'
import type { Bus } from '../bus.js'
import type { MongoStore } from '../mongoStore.js'
import type { Storage } from '../storage.js'
import type { Summarizer } from '../summarize.js'
import type { ChatStore } from '../chat.js'
import type { Role } from '../room.js'
import { atLeast, roleOnDocument, roleOnWorkspace } from '../access.js'
import { HttpError, type AuthedRequest } from '../http.js'
import { m } from '../telemetry.js'

// Everything a route may need, handed to each route file once
export interface ApiContext {
  c: Collections
  store: MongoStore
  bus: Bus
  secret: string
  storage: Storage | null
  summarize: Summarizer | null
  chat: ChatStore | null
  publicUrl?: string
  atlasSearch: boolean
  guestsEnabled: boolean
  maxGuestsPerHour: number
}

export function needAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as Partial<AuthedRequest>).userId) return next()
  m.authFailures.add(1, { kind: 'token' })
  next(new HttpError(401, 'Sign in required'))
}

// Role checks. Not being a member is a 404, not a 403, so nobody learns that something exists.
export function guards({ c }: Pick<ApiContext, 'c'>) {
  const check = (role: Role | null, min: Role) => {
    if (role === null) throw new HttpError(404, 'Not found')
    if (!atLeast(role, min)) throw new HttpError(403, `Requires ${min} access`)
    return role
  }
  return {
    workspaceRole: async (userId: string, workspaceId: ObjectId, min: Role) => check(await roleOnWorkspace(c, userId, workspaceId.toHexString()), min),
    documentRole: async (userId: string, docId: ObjectId, min: Role) => check(await roleOnDocument(c, userId, docId.toHexString()), min),
  }
}
