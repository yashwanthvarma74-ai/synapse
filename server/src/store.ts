// Persistence: an append-only update log plus a compacted snapshot.
// Load = snapshot + the updates newer than it. The same shape maps onto the
// MongoDB collections doc_snapshots / doc_updates, so swapping the backend
// later only means writing another class that implements DocStore.
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises'
import path from 'node:path'
import * as Y from 'yjs'

export interface LoadedDoc {
  snapshot: Uint8Array | null
  updates: Uint8Array[]
}

export interface DocStore {
  load(docId: string): Promise<LoadedDoc>
  appendUpdate(docId: string, update: Uint8Array): Promise<void>
  // Merge the stored snapshot + log into one new snapshot and trim the log.
  // Works only from STORED data (never a gateway's in-memory doc), so several
  // gateways can compact safely without losing each other's updates.
  compact(docId: string): Promise<void>
}

// Merge a snapshot and updates into one update, without needing a live Y.Doc
export function mergeStored({ snapshot, updates }: LoadedDoc): Uint8Array {
  return Y.mergeUpdates(snapshot ? [snapshot, ...updates] : updates)
}

export class MemoryStore implements DocStore {
  private snaps = new Map<string, Uint8Array>()
  private logs = new Map<string, Uint8Array[]>()

  async load(docId: string): Promise<LoadedDoc> {
    return {
      snapshot: this.snaps.get(docId) ?? null,
      updates: [...(this.logs.get(docId) ?? [])],
    }
  }
  async appendUpdate(docId: string, update: Uint8Array) {
    const log = this.logs.get(docId) ?? []
    log.push(update)
    this.logs.set(docId, log)
  }
  async compact(docId: string) {
    const stored = await this.load(docId)
    if (stored.updates.length === 0) return
    this.snaps.set(docId, mergeStored(stored))
    this.logs.set(docId, [])
  }
}

// Simple on-disk store for local development.
// <id>.snap holds the snapshot; <id>.log holds [4-byte length][bytes] records.
export class FileStore implements DocStore {
  constructor(private dir: string) {}

  private file(docId: string, ext: string) {
    // docIds come from URLs, so never let them escape the data dir
    const safe = docId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.dir, `${safe}.${ext}`)
  }

  async load(docId: string): Promise<LoadedDoc> {
    await mkdir(this.dir, { recursive: true })
    const snapshot = await readFile(this.file(docId, 'snap')).then(
      (b) => new Uint8Array(b),
      () => null,
    )
    const log = await readFile(this.file(docId, 'log')).catch(() => Buffer.alloc(0))
    const updates: Uint8Array[] = []
    let i = 0
    while (i + 4 <= log.length) {
      const len = log.readUInt32BE(i)
      i += 4
      if (i + len > log.length) break // torn write at the end: ignore it
      updates.push(new Uint8Array(log.subarray(i, i + len)))
      i += len
    }
    return { snapshot, updates }
  }

  async appendUpdate(docId: string, update: Uint8Array) {
    await mkdir(this.dir, { recursive: true })
    const header = Buffer.alloc(4)
    header.writeUInt32BE(update.length)
    await appendFile(this.file(docId, 'log'), Buffer.concat([header, update]))
  }

  async compact(docId: string) {
    const stored = await this.load(docId)
    if (stored.updates.length === 0) return
    await writeFile(this.file(docId, 'snap'), mergeStored(stored))
    await rm(this.file(docId, 'log'), { force: true })
  }
}
