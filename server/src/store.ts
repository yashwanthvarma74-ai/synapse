// Persistence: an append-only update log plus a compacted snapshot. Loading merges the snapshot with the
// updates after it. The same shape maps onto the MongoDB collections doc_snapshots and doc_updates.
import * as Y from 'yjs'

export interface LoadedDoc {
  snapshot: Uint8Array | null
  updates: Uint8Array[]
}

export interface DocStore {
  load(docId: string): Promise<LoadedDoc>
  appendUpdate(docId: string, update: Uint8Array): Promise<void>
  // Merge the stored snapshot and log into one new snapshot and trim the log. It only works from stored
  // data (never a gateway's in-memory doc), so several gateways can compact without losing each other's updates.
  compact(docId: string): Promise<void>
}

// Named versions are saved from the room's live document, so they hold the very latest edits
export interface VersionStore {
  saveNamedVersion(docId: string, label: string, userId: string, liveState?: Uint8Array): Promise<number>
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
