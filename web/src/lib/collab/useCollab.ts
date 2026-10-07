'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { IndexeddbPersistence } from 'y-indexeddb'
import { SynapseProvider, type Status } from './provider'
import { getIdentity, type Identity } from './identity'
import { recordMetric } from '../telemetry'

export interface Collab {
  doc: Y.Doc
  awareness: Awareness
  provider: SynapseProvider
  idb: IndexeddbPersistence
  user: Identity
}

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'ws://localhost:4000'

// Owns the Yjs doc, the IndexedDB copy and the network provider for one document. It is a plain object
// outside React: the effect opens and closes it and components read it through useSyncExternalStore.
class CollabStore {
  private current: Collab | null = null
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  getSnapshot = () => this.current

  open(docId: string, name: string, token: string) {
    const user = getIdentity(name)
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    // Local copy first: the doc is usable (and survives refresh) before any network
    const idb = new IndexeddbPersistence(`synapse:${docId}`, doc)
    // The server decides your role from this signed token, never from the URL
    const q = new URLSearchParams({ token })
    const provider = new SynapseProvider({ url: `${GATEWAY}/collab/${docId}?${q}`, doc, awareness, onMetric: recordMetric })
    this.current = { doc, awareness, provider, idb, user }
    this.emit()
  }

  close() {
    const c = this.current
    if (!c) return
    this.current = null
    c.provider.destroy()
    void c.idb.destroy()
    c.doc.destroy()
    this.emit()
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

export function useCollab(docId: string, opts: { name: string; token: string }) {
  const [store] = useState(() => new CollabStore())
  const { name, token } = opts
  useEffect(() => {
    store.open(docId, name, token)
    return () => store.close()
  }, [store, docId, name, token])
  // null on the server and during the first render, so the page hydrates cleanly
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null)
}

// Re-render when the provider's status changes
export function useStatus(provider: SynapseProvider | null) {
  return useSyncExternalStore(
    (cb) => (provider ? provider.subscribe(cb) : () => {}),
    () => provider?.status ?? ('connecting' as Status),
    () => 'connecting' as Status,
  )
}
