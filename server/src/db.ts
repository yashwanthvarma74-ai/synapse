// Collections for the app's metadata. Document CONTENT lives in doc_updates /
// doc_snapshots (see mongoStore.ts); everything here is small, server-authoritative data.
import { ObjectId, type Collection, type Db } from 'mongodb'
import type { Role } from './room.js'

export interface User {
  _id: ObjectId
  email: string
  name: string
  passwordHash: string
  guest?: boolean // a one-click "try it" account; can be upgraded to a real one
  createdAt: Date
}
export interface Workspace {
  _id: ObjectId
  name: string
  ownerId: ObjectId
  createdAt: Date
}
export interface Membership {
  _id: ObjectId
  workspaceId: ObjectId
  userId: ObjectId
  role: Role
}
export interface DocumentMeta {
  _id: ObjectId
  workspaceId: ObjectId
  title: string
  type: 'doc' | 'canvas'
  text: string // plain text copy used only for search
  updatedAt: Date
  createdAt: Date
}
export interface Comment {
  _id: ObjectId
  docId: ObjectId
  authorId: ObjectId
  authorName: string
  body: string
  quote: string // the text that was selected when commenting, shown in the panel
  anchor: string | null // JSON of two Yjs relative positions {from,to}; they follow the text as it moves
  parentId: ObjectId | null
  resolved: boolean
  createdAt: Date
}

// A shareable link that adds whoever opens it to a workspace with a fixed role.
export interface Invite {
  _id: ObjectId
  code: string // unguessable, travels in the link
  workspaceId: ObjectId
  role: 'editor' | 'commenter' | 'viewer' // never 'owner'
  createdBy: ObjectId
  createdAt: Date
  expiresAt: Date
  revoked: boolean
  uses: number
}

export interface Collections {
  users: Collection<User>
  workspaces: Collection<Workspace>
  memberships: Collection<Membership>
  documents: Collection<DocumentMeta>
  comments: Collection<Comment>
  invites: Collection<Invite>
}

export function collections(db: Db): Collections {
  return {
    users: db.collection('users'),
    workspaces: db.collection('workspaces'),
    memberships: db.collection('memberships'),
    documents: db.collection('documents'),
    comments: db.collection('comments'),
    invites: db.collection('invites'),
  }
}

// Index every field we filter or sort on.
export async function ensureIndexes(c: Collections) {
  await c.users.createIndex({ email: 1 }, { unique: true })
  await c.memberships.createIndex({ workspaceId: 1, userId: 1 }, { unique: true })
  await c.memberships.createIndex({ userId: 1 })
  await c.documents.createIndex({ workspaceId: 1, updatedAt: -1 })
  await c.documents.createIndex({ title: 'text', text: 'text' }, { name: 'doc_text' })
  await c.comments.createIndex({ docId: 1, createdAt: 1 })
  await c.invites.createIndex({ code: 1 }, { unique: true })
  await c.invites.createIndex({ workspaceId: 1, createdAt: -1 })
}

// Atlas Search (Lucene) index. Only Atlas supports it; local MongoDB keeps the $text index above.
export const SEARCH_INDEX = 'doc_search'
export async function ensureSearchIndex(c: Collections) {
  const existing = await c.documents.listSearchIndexes(SEARCH_INDEX).toArray()
  if (existing.length) return
  await c.documents.createSearchIndex({
    name: SEARCH_INDEX,
    definition: { mappings: { dynamic: false, fields: {
      title: { type: 'string' },
      text: { type: 'string' },
      workspaceId: { type: 'objectId' }, // lets us filter to the caller's workspaces inside the search itself
    } } },
  })
}

export const oid = (s: string): ObjectId | null => (ObjectId.isValid(s) && s.length === 24 ? new ObjectId(s) : null)
