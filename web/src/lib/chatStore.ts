// The state behind the Chat tab, for one document. A plain class (no React) so it can be tested
// on its own; the component reads it through useSyncExternalStore.
//
// Where messages come from:
//   - saved history, fetched over HTTP (the newest page, and older pages on request)
//   - live messages, pushed over the WebSocket
// They are merged by id, so a message that arrives both ways is shown once. After a lost connection
// the newest page is fetched again, so nothing sent while you were offline is missed.
import type { ChatErrorCode, ChatEvent, ChatMessage, Status } from './provider'

export interface Transport {
  onChat(fn: (e: ChatEvent) => void): () => void
  sendChat(text: string, cid: string): boolean
  subscribe(fn: () => void): () => void
  readonly status: Status
}

export interface Pending { cid: string; text: string }
export interface Notice { id: number; text: string; message: string } // what to tell the person; `text` is what they typed, so they can retry
export interface ChatView {
  messages: ChatMessage[]
  pending: Pending[]
  hasMore: boolean
  loadingEarlier: boolean
  loaded: boolean
  historyError: string
  unread: number
  latest: ChatMessage | null // newest message from someone else that arrived live (never old history): announced to screen readers
  notice: Notice | null
}

export const REFUSALS: Record<ChatErrorCode, string> = {
  forbidden: 'Viewers can read the chat but not write in it.',
  invalid: 'That message is empty or too long (2,000 characters at most).',
  rate: "You're sending messages too quickly. Wait a moment and try again.",
  unavailable: "Chat isn't available right now. Try again in a moment.",
}

const EMPTY: ChatView = { messages: [], pending: [], hasMore: false, loadingEarlier: false, loaded: false, historyError: '', unread: 0, latest: null, notice: null }

export class ChatStore {
  private view: ChatView = EMPTY
  private listeners = new Set<() => void>()
  private open = false
  private known = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private noticeId = 0
  private wasConnected = false
  private disposers: Array<() => void> = []
  private disposed = false

  constructor(
    private me: string,
    private transport: Transport,
    private fetchPage: (before?: string) => Promise<ChatMessage[]>,
    private opts: { pageSize?: number; deliveryTimeoutMs?: number; newId?: () => string } = {},
  ) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  getSnapshot = () => this.view
  private set(patch: Partial<ChatView>) {
    this.view = { ...this.view, ...patch }
    this.listeners.forEach((l) => l())
  }

  start() {
    this.wasConnected = this.transport.status === 'connected'
    this.disposers.push(this.transport.onChat((e) => this.onEvent(e)))
    this.disposers.push(this.transport.subscribe(() => this.onStatus()))
    void this.loadLatest(false)
    return () => this.dispose()
  }
  dispose() {
    this.disposed = true
    this.disposers.splice(0).forEach((d) => d())
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.listeners.clear()
  }

  // ---- history --------------------------------------------------------------------------------
  private pageSize = () => this.opts.pageSize ?? 50

  private async loadLatest(countUnread: boolean) {
    try {
      const page = await this.fetchPage()
      if (this.disposed) return
      const first = !this.view.loaded
      this.merge(page, countUnread)
      this.set({ loaded: true, historyError: '', ...(first ? { hasMore: page.length >= this.pageSize() } : {}) })
    } catch (e) {
      if (!this.disposed) this.set({ loaded: true, historyError: (e as Error).message || "Couldn't load earlier messages." })
    }
  }

  async loadEarlier() {
    const oldest = this.view.messages[0]
    if (!oldest || this.view.loadingEarlier) return
    this.set({ loadingEarlier: true })
    try {
      const page = await this.fetchPage(oldest.id)
      if (this.disposed) return
      this.merge(page, false)
      this.set({ loadingEarlier: false, hasMore: page.length >= this.pageSize(), historyError: '' })
    } catch (e) {
      if (!this.disposed) this.set({ loadingEarlier: false, historyError: (e as Error).message || "Couldn't load earlier messages." })
    }
  }

  // Add messages we have not seen. Messages from other people that arrive while the tab is closed count as unread.
  private merge(incoming: ChatMessage[], countUnread: boolean) {
    const fresh = incoming.filter((m) => !this.known.has(m.id))
    if (fresh.length === 0) return
    fresh.forEach((m) => this.known.add(m.id))
    const messages = [...this.view.messages, ...fresh].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const fromOthers = countUnread ? fresh.filter((m) => m.userId !== this.me) : []
    const others = this.open ? 0 : fromOthers.length
    // anything of mine that came back from the server is no longer "sending"
    const echoed = new Set(fresh.filter((m) => m.userId === this.me && m.cid).map((m) => m.cid!))
    echoed.forEach((cid) => this.clearTimer(cid))
    this.set({ messages, unread: this.view.unread + others, latest: fromOthers.length ? fromOthers[fromOthers.length - 1] : this.view.latest, pending: this.view.pending.filter((p) => !echoed.has(p.cid)) })
  }

  // ---- live ----------------------------------------------------------------------------------------
  private onEvent(e: ChatEvent) {
    if (e.type === 'message') return this.merge([e.message], true)
    // the server refused something we sent
    const p = this.view.pending.find((x) => x.cid === e.cid)
    if (!p) return
    this.clearTimer(p.cid)
    this.set({ pending: this.view.pending.filter((x) => x.cid !== p.cid), notice: { id: ++this.noticeId, text: p.text, message: REFUSALS[e.code] ?? REFUSALS.unavailable } })
  }

  private onStatus() {
    const connected = this.transport.status === 'connected'
    // back online: pick up whatever was said while we were away
    if (connected && !this.wasConnected && this.view.loaded) void this.loadLatest(true)
    this.wasConnected = connected
  }

  // ---- actions ---------------------------------------------------------------------------------
  send(text: string): 'sent' | 'offline' | 'empty' {
    const t = text.trim()
    if (!t) return 'empty'
    const cid = this.opts.newId?.() ?? Math.random().toString(36).slice(2, 12)
    if (!this.transport.sendChat(t, cid)) return 'offline'
    this.set({ pending: [...this.view.pending, { cid, text: t }], notice: null })
    // if no answer arrives, say so instead of leaving "sending" forever
    this.timers.set(cid, setTimeout(() => {
      this.timers.delete(cid)
      const p = this.view.pending.find((x) => x.cid === cid)
      if (!p || this.disposed) return
      this.set({ pending: this.view.pending.filter((x) => x.cid !== cid), notice: { id: ++this.noticeId, text: p.text, message: "That message wasn't delivered. Check your connection and try again." } })
    }, this.opts.deliveryTimeoutMs ?? 10_000))
    return 'sent'
  }

  // The Chat tab is on screen (or not). Opening it reads everything.
  setOpen(open: boolean) {
    this.open = open
    if (open && this.view.unread > 0) this.set({ unread: 0 })
  }
  dismissNotice() {
    if (this.view.notice) this.set({ notice: null })
  }
  private clearTimer(cid: string) {
    const t = this.timers.get(cid)
    if (t) clearTimeout(t)
    this.timers.delete(cid)
  }
}
