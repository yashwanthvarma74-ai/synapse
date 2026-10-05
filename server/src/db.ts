// Collections for the app's metadata. Document CONTENT lives in doc_updates /
// doc_snapshots (see mongoStore.ts); everything here is small, server-authoritative data.
import { ObjectId, type Collection, type Db } from 'mongodb'
import type { Role } from './room.js'

export interface User {
  _id: ObjectId
  email: string
  name: string
  passwordHash: string
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

export interface Collections {
  users: Collection<User>
  workspaces: Collection<Workspace>
  memberships: Collection<Membership>
  documents: Collection<DocumentMeta>
  comments: Collection<Comment>
}

export function collections(db: Db): Collections {
  return {
    users: db.collection('users'),
    workspaces: db.collection('workspaces'),
    memberships: db.collection('memberships'),
    documents: db.collection('documents'),
    comments: db.collection('comments'),
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
}

export const oid = (s: string): ObjectId | null => (ObjectId.isValid(s) && s.length === 24 ? new ObjectId(s) : null)
