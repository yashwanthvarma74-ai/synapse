import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStore, REFUSALS, type Transport } from './chatStore'
import type { ChatEvent, ChatMessage, Status } from './provider'

const msg = (id: string, userId: string, text = id, cid?: string): ChatMessage => ({ id, userId, name: userId.toUpperCase(), text, at: '2026-10-06T10:00:00.000Z', cid })

function fakeTransport() {
  let chat: ((e: ChatEvent) => void) | null = null
  let status: Status = 'connected'
  const statusListeners = new Set<() => void>()
  const sent: Array<{ text: string; cid: string }> = []
  let accept = true
  const t: Transport & { push: (e: ChatEvent) => void; setStatus: (s: Status) => void; sent: typeof sent; refuseSends: () => void } = {
    onChat: (fn) => { chat = fn; return () => { chat = null } },
    sendChat: (text, cid) => { if (!accept) return false; sent.push({ text, cid }); return true },
    subscribe: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn) },
    get status() { return status },
    push: (e) => chat?.(e),
    setStatus: (s) => { status = s; statusListeners.forEach((l) => l()) },
    sent,
    refuseSends: () => { accept = false },
  }
  return t
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ChatStore', () => {
  let t: ReturnType<typeof fakeTransport>
  let pages: ChatMessage[][]
  let fetchPage: ReturnType<typeof vi.fn>
  const make = (opts = {}) => new ChatStore('me', t, fetchPage as never, { pageSize: 3, deliveryTimeoutMs: 50, newId: (() => { let n = 0; return () => `c${++n}` })(), ...opts })

  beforeEach(() => {
    t = fakeTransport()
    pages = [[msg('01', 'ann'), msg('02', 'me'), msg('03', 'ann')]]
    fetchPage = vi.fn(async (before?: string) => (before ? [msg('00', 'ann')] : pages[0]))
  })
  afterEach(() => vi.useRealTimers())

  it('loads the newest page first and says whether there is more', async () => {
    const s = make(); s.start(); await flush()
    expect(s.getSnapshot().messages.map((m) => m.id)).toEqual(['01', '02', '03'])
    expect(s.getSnapshot()).toMatchObject({ loaded: true, hasMore: true, unread: 0 }) // history is not "unread"
  })

  it('has no "load earlier" when the first page is short', async () => {
    pages = [[msg('01', 'ann')]]
    const s = make(); s.start(); await flush()
    expect(s.getSnapshot().hasMore).toBe(false)
  })

  it('loads earlier messages above the current ones, and stops when a page comes back short', async () => {
    const s = make(); s.start(); await flush()
    await s.loadEarlier()
    expect(s.getSnapshot().messages.map((m) => m.id)).toEqual(['00', '01', '02', '03'])
    expect(s.getSnapshot()).toMatchObject({ hasMore: false, loadingEarlier: false })
    expect(fetchPage).toHaveBeenLastCalledWith('01')
  })

  it('shows a message once even if it arrives both as history and live', async () => {
    const s = make(); s.start(); await flush()
    t.push({ type: 'message', message: msg('03', 'ann') })
    t.push({ type: 'message', message: msg('04', 'ann') })
    t.push({ type: 'message', message: msg('04', 'ann') })
    expect(s.getSnapshot().messages.map((m) => m.id)).toEqual(['01', '02', '03', '04'])
  })

  it('keeps messages in order even when a live one arrives before the history', async () => {
    let release!: () => void
    fetchPage = vi.fn(() => new Promise<ChatMessage[]>((r) => { release = () => r([msg('01', 'ann'), msg('02', 'ann')]) }))
    const s = make(); s.start()
    t.push({ type: 'message', message: msg('03', 'ann') }) // history has not come back yet
    release(); await flush()
    expect(s.getSnapshot().messages.map((m) => m.id)).toEqual(['01', '02', '03'])
  })

  it('counts other people\'s new messages as unread while the tab is closed, never your own, and clears on open', async () => {
    const s = make(); s.start(); await flush()
    t.push({ type: 'message', message: msg('04', 'ann') })
    t.push({ type: 'message', message: msg('05', 'me') })
    t.push({ type: 'message', message: msg('06', 'bob') })
    expect(s.getSnapshot().unread).toBe(2)
    s.setOpen(true)
    expect(s.getSnapshot().unread).toBe(0)
    t.push({ type: 'message', message: msg('07', 'ann') }) // tab is open: read as it arrives
    expect(s.getSnapshot().unread).toBe(0)
    s.setOpen(false)
    t.push({ type: 'message', message: msg('08', 'ann') })
    expect(s.getSnapshot().unread).toBe(1)
  })

  it('exposes the newest live message from someone else for screen readers, but never history or your own', async () => {
    const s = make(); s.start(); await flush()
    expect(s.getSnapshot().latest).toBeNull() // loading history announces nothing
    t.push({ type: 'message', message: msg('04', 'me', 'mine') })
    expect(s.getSnapshot().latest).toBeNull()
    t.push({ type: 'message', message: msg('05', 'ann', 'hi there') })
    expect(s.getSnapshot().latest).toMatchObject({ id: '05', text: 'hi there' })
  })

  it('shows a sent message as "sending" until the server echoes it, then shows it once', async () => {
    const s = make(); s.start(); await flush()
    expect(s.send('  hello  ')).toBe('sent')
    expect(t.sent).toEqual([{ text: 'hello', cid: 'c1' }]) // trimmed
    expect(s.getSnapshot().pending).toEqual([{ cid: 'c1', text: 'hello' }])
    t.push({ type: 'message', message: msg('04', 'me', 'hello', 'c1') })
    expect(s.getSnapshot().pending).toEqual([])
    expect(s.getSnapshot().messages.filter((m) => m.text === 'hello')).toHaveLength(1)
  })

  it('does not send empty text, and says so when offline instead of pretending', async () => {
    const s = make(); s.start(); await flush()
    expect(s.send('   ')).toBe('empty')
    t.refuseSends()
    expect(s.send('hi')).toBe('offline')
    expect(s.getSnapshot().pending).toEqual([])
  })

  it('turns a refusal from the server into a plain message and hands the text back', async () => {
    const s = make(); s.start(); await flush()
    s.send('too fast')
    t.push({ type: 'error', cid: 'c1', code: 'rate' })
    const v = s.getSnapshot()
    expect(v.pending).toEqual([])
    expect(v.notice).toMatchObject({ text: 'too fast', message: REFUSALS.rate })
    s.dismissNotice()
    expect(s.getSnapshot().notice).toBeNull()
  })

  it('has a distinct message for every refusal the server can give', () => {
    expect(new Set(Object.values(REFUSALS)).size).toBe(4)
  })

  it('ignores a refusal for something it did not send', async () => {
    const s = make(); s.start(); await flush()
    t.push({ type: 'error', cid: 'nope', code: 'forbidden' })
    expect(s.getSnapshot().notice).toBeNull()
  })

  it('gives up waiting for an echo and says the message was not delivered', async () => {
    const s = make({ deliveryTimeoutMs: 20 }); s.start(); await flush()
    s.send('into the void')
    await new Promise((r) => setTimeout(r, 60))
    expect(s.getSnapshot().pending).toEqual([])
    expect(s.getSnapshot().notice).toMatchObject({ text: 'into the void' })
    expect(s.getSnapshot().notice!.message).toMatch(/wasn't delivered/)
  })

  it('after coming back online, fetches what was said meanwhile (and counts it unread if the tab is closed)', async () => {
    const s = make(); s.start(); await flush()
    t.setStatus('offline')
    pages = [[msg('01', 'ann'), msg('02', 'me'), msg('03', 'ann'), msg('04', 'bob')]] // said while we were away
    t.setStatus('connected'); await flush()
    expect(s.getSnapshot().messages.map((m) => m.id)).toEqual(['01', '02', '03', '04'])
    expect(s.getSnapshot().unread).toBe(1)
  })

  it('reports a history failure without losing what is already shown, and recovers on retry', async () => {
    const s = make(); s.start(); await flush()
    fetchPage.mockRejectedValueOnce(new Error('Server unavailable'))
    await s.loadEarlier()
    expect(s.getSnapshot().historyError).toBe('Server unavailable')
    expect(s.getSnapshot().messages).toHaveLength(3)
    await s.loadEarlier()
    expect(s.getSnapshot().historyError).toBe('')
    expect(s.getSnapshot().messages).toHaveLength(4)
  })

  it('stops reacting after it is disposed', async () => {
    const s = make(); const dispose = s.start(); await flush()
    dispose()
    t.push({ type: 'message', message: msg('09', 'ann') })
    expect(s.getSnapshot().messages.map((m) => m.id)).not.toContain('09')
  })
})
