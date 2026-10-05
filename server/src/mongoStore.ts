// MongoDB implementation of DocStore.
//   doc_updates:   one record per edit, ordered by a per-document sequence number
//   doc_snapshots: compacted state (label = null) and named versions (label set)
// Load = latest unlabeled snapshot + updates newer than it.
import { MongoClient, Binary, type Db, type Collection } from 'mongodb'
import * as Y from 'yjs'
import { mergeStored, type DocStore, type LoadedDoc } from './store.js'

interface UpdateRecord {
  docId: string
  seq: number
  update: Binary
  userId?: string
  createdAt: Date
}
interface SnapshotRecord {
  docId: string
  version: number
  label: string | null
  state: Binary
  createdAt: Date
  createdBy?: string
}

const bytes = (b: Binary) => new Uint8Array(b.buffer)

export class MongoStore implements DocStore {
  private client: MongoClient
  readonly db: Db
  readonly updates: Collection<UpdateRecord>
  readonly snapshots: Collection<SnapshotRecord>
  private counters: Collection<{ _id: string; seq: number }>

  constructor(url: string, dbName: string) {
    // Give up on an unreachable database after 5 s (the default is 30 s), so a start-up
    // against a dead database fails fast and requests during an outage fail quickly.
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 })
    this.db = this.client.db(dbName)
    this.updates = this.db.collection('doc_updates')
    this.snapshots = this.db.collection('doc_snapshots')
    this.counters = this.db.collection('counters')
  }

  async init() {
    await this.client.connect()
    // Every field we filter or sort on is indexed
    await this.updates.createIndex({ docId: 1, seq: 1 }, { unique: true })
    await this.snapshots.createIndex({ docId: 1, version: -1 })
  }

  async close() {
    await this.client.close()
  }

  // Atomic per-document counter, so several gateways never reuse a sequence number
  private async nextSeq(docId: string) {
    const r = await this.counters.findOneAndUpdate(
      { _id: docId },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    return r!.seq
  }

  // CRDT updates are idempotent: applying the same update twice changes nothing.
  // That lets us skip locks entirely. Rules that make it safe with many writers:
  //   load    = merge ALL unlabeled snapshots + ALL remaining updates
  //   compact = merge what it read, insert the result, then delete ONLY the exact
  //             records it read (never "everything up to seq N", which could
  //             delete an update that was still being written)
  async load(docId: string): Promise<LoadedDoc> {
    const snaps = await this.snapshots.find({ docId, label: null }).toArray()
    const updates = await this.updates.find({ docId }).sort({ seq: 1 }).toArray()
    const snapshot = snaps.length ? Y.mergeUpdates(snaps.map((s) => bytes(s.state))) : null
    return { snapshot, updates: updates.map((u) => bytes(u.update)) }
  }

  async appendUpdate(docId: string, update: Uint8Array, userId?: string) {
    await this.updates.insertOne({
      docId,
      seq: await this.nextSeq(docId),
      update: new Binary(update),
      userId,
      createdAt: new Date(),
    })
  }

  async compact(docId: string) {
    const snaps = await this.snapshots.find({ docId, label: null }).toArray()
    const pending = await this.updates.find({ docId }).toArray()
    if (pending.length === 0 && snaps.length <= 1) return
    const merged = mergeStored({
      snapshot: snaps.length ? Y.mergeUpdates(snaps.map((s) => bytes(s.state))) : null,
      updates: pending.map((u) => bytes(u.update)),
    })
    const last = await this.snapshots.findOne({ docId }, { sort: { version: -1 } })
    // Write the new snapshot BEFORE deleting anything: a crash in between leaves
    // duplicates (harmless), never missing data.
    await this.snapshots.insertOne({
      docId,
      version: (last?.version ?? 0) + 1,
      label: null,
      state: new Binary(merged),
      createdAt: new Date(),
    })
    await this.updates.deleteMany({ _id: { $in: pending.map((u) => u._id) } })
    await this.snapshots.deleteMany({ _id: { $in: snaps.map((s) => s._id) } })
  }

  // Remove everything stored for a document (edits, snapshots, named versions). Used by pruning.
  async deleteDocument(docId: string) {
    await Promise.all([
      this.updates.deleteMany({ docId }),
      this.snapshots.deleteMany({ docId }),
      this.counters.deleteOne({ _id: docId }),
    ])
  }

  // ---- named versions (used by version history) --------------------------------

  // Save the document's CURRENT stored state as a named, permanent snapshot.
  async saveNamedVersion(docId: string, label: string, userId: string) {
    const merged = mergeStored(await this.load(docId))
    const last = await this.snapshots.findOne({ docId }, { sort: { version: -1 } })
    const version = (last?.version ?? 0) + 1
    await this.snapshots.insertOne({
      docId,
      version,
      label,
      state: new Binary(merged),
      createdAt: new Date(),
      createdBy: userId,
    })
    return version
  }

  async listVersions(docId: string) {
    const rows = await this.snapshots
      .find({ docId, label: { $ne: null } }, { projection: { state: 0 } })
      .sort({ version: -1 })
      .toArray()
    return rows.map((r) => ({ version: r.version, label: r.label!, createdAt: r.createdAt, createdBy: r.createdBy }))
  }

  async getVersionState(docId: string, version: number): Promise<Uint8Array | null> {
    const r = await this.snapshots.findOne({ docId, version, label: { $ne: null } })
    return r ? bytes(r.state) : null
  }

  // Current text of a doc, for search indexing and tests
  async currentText(docId: string, field = 'body'): Promise<string> {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, mergeStored(await this.load(docId)))
    return doc.getText(field).toString()
  }
}
