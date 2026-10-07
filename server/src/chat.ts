// Per-document chat. Messages travel over the document's WebSocket (so the same sign-in and role
// checks apply), are saved in MongoDB and relayed between gateways on the same bus as edits. They are
// not part of the shared document: chat is a plain append-only log, so a message can never change the page.
//
// Messages (after the type byte):
//   MSG_CHAT, client to gateway:  [4, text, clientId]
//   MSG_CHAT, gateway to clients: [4, json]  (the saved message; clientId lets the sender recognise it)
//   MSG_CHAT_ERROR, to the sender: [5, clientId, code]
import type { Db, Collection } from 'mongodb'
import { ObjectId } from 'mongodb'

export const MSG_CHAT = 4
export const MSG_CHAT_ERROR = 5

export type ChatErrorCode = 'forbidden' | 'invalid' | 'rate' | 'unavailable'

export interface ChatMessage {
  id: string // sortable: later messages have larger ids
  userId: string
  name: string // taken from the signed-in account on the server, never from the client
  text: string
  at: string // ISO time, set by the server
  cid?: string // the sender's own id for it, so their screen can match the echo
}

export const MAX_CHAT_CHARS = 2000
export const PAGE_SIZE = 50

export interface ChatStore {
  append(docId: string, msg: Omit<ChatMessage, 'id' | 'at'>): Promise<ChatMessage>
  // the newest `limit` messages older than `before` (or the newest overall), oldest first
  list(docId: string, opts?: { before?: string; limit?: number }): Promise<ChatMessage[]>
  deleteDocument(docId: string): Promise<void>
}

// Plain text only. Control characters and the invisible bidirectional overrides (which can make text
// read backwards) are removed, and blank runs are tidied. Returns null if nothing is left.
export function cleanChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return null
  if (Array.from(text).length > MAX_CHAT_CHARS) return null
  return text
}

// A burst of `capacity` messages, then one every 1 / refillPerSec seconds
export class TokenBucket {
  private tokens: number
  private last: number
  constructor(private capacity = 5, private refillPerSec = 0.5, private now: () => number = Date.now) {
    this.tokens = capacity
    this.last = now()
  }
  take(): boolean {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec)
    this.last = t
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

// In memory (tests, and gateways run without a database)
export class MemoryChatStore implements ChatStore {
  private byDoc = new Map<string, ChatMessage[]>()
  private n = 0
  async append(docId: string, msg: Omit<ChatMessage, 'id' | 'at'>) {
    const now = Date.now()
    const full: ChatMessage = { ...msg, id: `${now.toString(16).padStart(12, '0')}${(this.n++).toString(16).padStart(8, '0')}`, at: new Date(now).toISOString() }
    const list = this.byDoc.get(docId) ?? []
    list.push(full)
    this.byDoc.set(docId, list)
    return full
  }
  async list(docId: string, opts: { before?: string; limit?: number } = {}) {
    const all = this.byDoc.get(docId) ?? []
    const older = opts.before ? all.filter((m) => m.id < opts.before!) : all
    return older.slice(-(opts.limit ?? PAGE_SIZE))
  }
  async deleteDocument(docId: string) {
    this.byDoc.delete(docId)
  }
}

// MongoDB
interface ChatDoc { _id: ObjectId; docId: string; userId: string; name: string; text: string; at: Date }

export class MongoChatStore implements ChatStore {
  private col: Collection<ChatDoc>
  constructor(db: Db, private retentionDays = Number(process.env.CHAT_RETENTION_DAYS ?? 180)) {
    this.col = db.collection('chat_messages')
  }
  async init() {
    await this.col.createIndex({ docId: 1, _id: -1 }) // "newest first, for this document, older than X"
    // messages expire on their own, so chat never grows without bound
    await this.col.createIndex({ at: 1 }, { expireAfterSeconds: this.retentionDays * 86_400 })
  }
  private out = (d: ChatDoc): ChatMessage => ({ id: d._id.toHexString(), userId: d.userId, name: d.name, text: d.text, at: d.at.toISOString() })
  async append(docId: string, msg: Omit<ChatMessage, 'id' | 'at'>) {
    const doc: ChatDoc = { _id: new ObjectId(), docId, userId: msg.userId, name: msg.name, text: msg.text, at: new Date() }
    await this.col.insertOne(doc)
    return { ...this.out(doc), cid: msg.cid }
  }
  async list(docId: string, opts: { before?: string; limit?: number } = {}) {
    const q: Record<string, unknown> = { docId }
    if (opts.before && ObjectId.isValid(opts.before) && opts.before.length === 24) q._id = { $lt: new ObjectId(opts.before) }
    const rows = await this.col.find(q).sort({ _id: -1 }).limit(opts.limit ?? PAGE_SIZE).toArray()
    return rows.reverse().map(this.out)
  }
  async deleteDocument(docId: string) {
    await this.col.deleteMany({ docId })
  }
}
