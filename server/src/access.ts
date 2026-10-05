// Who may do what. The ONE place that answers "what is this user's role on this
// document?". The gateway asks it on join, on a timer and whenever access changes.
import type { Collections } from './db.js'
import { oid } from './db.js'
import { verifyToken } from './auth.js'
import type { Role } from './room.js'
import type { Authorize } from './gateway.js'

export const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 }
export const atLeast = (role: Role | null, min: Role) => role !== null && ROLE_RANK[role] >= ROLE_RANK[min]

export async function roleOnWorkspace(c: Collections, userId: string, workspaceId: string): Promise<Role | null> {
  const u = oid(userId)
  const w = oid(workspaceId)
  if (!u || !w) return null
  const m = await c.memberships.findOne({ workspaceId: w, userId: u })
  return m?.role ?? null
}

export async function roleOnDocument(c: Collections, userId: string, docId: string): Promise<Role | null> {
  const d = oid(docId)
  if (!d) return null
  const doc = await c.documents.findOne({ _id: d }, { projection: { workspaceId: 1 } })
  return doc ? roleOnWorkspace(c, userId, doc.workspaceId.toHexString()) : null
}

// Gateway auth: a valid signed token AND a membership. Anything else is rejected
// before the WebSocket upgrade, so strangers never get a socket.
export function makeAuthorize(c: Collections, secret: string): Authorize {
  return async ({ docId, url }) => {
    const userId = await verifyToken(url.searchParams.get('token'), secret)
    if (!userId) return null
    const role = await roleOnDocument(c, userId, docId)
    return role ? { userId, role } : null
  }
}
