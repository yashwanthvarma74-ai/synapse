'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from './api'
import { ChatStore, type ChatView } from './chatStore'
import type { ChatMessage, SynapseProvider } from './provider'

const NOTHING: ChatView = { messages: [], pending: [], hasMore: false, loadingEarlier: false, loaded: false, historyError: '', unread: 0, latest: null, notice: null }
const noop = () => () => {}

// Holds the ChatStore for the open document. Like useCollab: a plain object outside React that an
// effect starts and stops, read through useSyncExternalStore.
class Holder {
  private current: ChatStore | null = null
  private stop: (() => void) | null = null
  private listeners = new Set<() => void>()
  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l))
  getSnapshot = () => this.current
  open(docId: string, userId: string, provider: SynapseProvider) {
    const fetchPage = (before?: string) => api<ChatMessage[]>(`/documents/${docId}/chat${before ? `?before=${before}` : ''}`)
    this.current = new ChatStore(userId, provider, fetchPage)
    this.stop = this.current.start()
    this.listeners.forEach((l) => l())
  }
  close() {
    this.stop?.()
    this.stop = null
    this.current = null
    this.listeners.forEach((l) => l())
  }
}

export function useChat(docId: string, userId: string, provider: SynapseProvider | null, enabled: boolean) {
  const [holder] = useState(() => new Holder())
  useEffect(() => {
    if (!enabled || !provider) return
    holder.open(docId, userId, provider)
    return () => holder.close()
  }, [holder, docId, userId, provider, enabled])
  const store = useSyncExternalStore(holder.subscribe, holder.getSnapshot, () => null)
  const view = useSyncExternalStore(store ? store.subscribe : noop, store ? store.getSnapshot : () => NOTHING, () => NOTHING)
  return { store, view }
}
