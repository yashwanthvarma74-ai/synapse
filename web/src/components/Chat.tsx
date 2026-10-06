'use client'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ChatStore, ChatView } from '@/lib/chatStore'
import { EmptyCommentsArt } from './ui/Illustrations'

const MAX = 2000

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fullDate = (iso: string) => new Date(iso).toLocaleString()

// A chat for this document. Messages are plain text (never HTML), the author and time come from the
// server, and viewers can read but not write. Focus is never moved because of someone else's message.
export default function Chat({ store, view, me, canWrite, connected }: {
  store: ChatStore | null; view: ChatView; me: string; canWrite: boolean; connected: boolean
}) {
  const [text, setText] = useState('')
  const [lastNotice, setLastNotice] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // follow new messages only while the reader is at the bottom

  // A refused message comes back into the box, so nothing typed is lost (setState during render is the
  // React-approved way to adjust state when a prop changes)
  if (view.notice && view.notice.id !== lastNotice) {
    setLastNotice(view.notice.id)
    if (!text) setText(view.notice.text)
  }

  useEffect(() => {
    store?.setOpen(true)
    return () => store?.setOpen(false)
  }, [store])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [view.messages.length, view.pending.length])

  function onScroll() {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!store) return
    const result = store.send(text)
    if (result === 'sent') {
      setText('')
      stick.current = true
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a new line (and never while an input method is composing)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const empty = view.loaded && view.messages.length === 0 && view.pending.length === 0
  const offline = !connected
  return (
    <section aria-label="Chat" className="panel chat">
      <h2>Chat</h2>
      <p className="muted chat-hint">Talk with the people in this page. Everyone who can open it can read the chat.</p>
      {view.historyError && <p role="alert" className="error">{view.historyError}</p>}

      <div ref={scroller} onScroll={onScroll} className="chat-scroll" tabIndex={0} role="region" aria-label="Chat messages">
        {view.hasMore && (
          <button type="button" className="link" onClick={() => void store?.loadEarlier()} disabled={view.loadingEarlier}>
            {view.loadingEarlier ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {!view.loaded && <p className="muted">Loading messages…</p>}
        {empty && (
          <div className="empty">
            <EmptyCommentsArt />
            <strong>No messages yet</strong>
            Say hello. Everyone in this document will see it.
          </div>
        )}
        <ul className="chat-list">
          {view.messages.map((m) => (
            <li key={m.id} className={m.userId === me ? 'chat-msg mine' : 'chat-msg'}>
              <span className="chat-meta">
                <strong>{m.userId === me ? 'You' : m.name}</strong>{' '}
                <time dateTime={m.at} title={fullDate(m.at)}>{time(m.at)}</time>
              </span>
              <span className="chat-text">{m.text}</span>
            </li>
          ))}
          {view.pending.map((p) => (
            <li key={p.cid} className="chat-msg mine sending">
              <span className="chat-meta"><strong>You</strong> <span>Sending…</span></span>
              <span className="chat-text">{p.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Spoken politely when someone ELSE writes. Your own messages and old history are never announced. */}
      <div className="sr-only" role="status" aria-live="polite">{view.latest ? `${view.latest.name} wrote: ${view.latest.text}` : ''}</div>

      {view.notice && <p role="alert" className="error">{view.notice.message}</p>}

      {canWrite ? (
        <form onSubmit={submit} className="stack">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <textarea
            id="chat-input"
            value={text}
            onChange={(e) => { setText(e.target.value); store?.dismissNotice() }}
            onKeyDown={onKeyDown}
            placeholder={offline ? "You're offline. Chat needs a connection." : 'Write a message. Enter sends, Shift+Enter adds a line.'}
            maxLength={MAX}
            rows={3}
            disabled={offline}
          />
          <div className="row spread">
            <span className="muted" aria-live="off">{text.length > MAX - 200 ? `${MAX - text.length} characters left` : ''}</span>
            <button className="btn" disabled={offline || !text.trim()}>Send</button>
          </div>
        </form>
      ) : (
        <p className="muted">Viewers can read the chat but can&apos;t write in it.</p>
      )}
    </section>
  )
}
