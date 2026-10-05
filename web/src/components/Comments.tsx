'use client'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/react'
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import { api, type CommentItem, type Role } from '@/lib/api'
import { atLeast } from '@/lib/roles'
import type { Collab } from '@/lib/useCollab'
import { EmptyCommentsArt } from './ui/Illustrations'

// A comment is anchored with Yjs RELATIVE positions. Unlike a plain character
// offset, a relative position follows the text it was attached to, so the comment
// keeps its place while other people type before it.
function syncState(editor: Editor) {
  return ySyncPluginKey.getState(editor.state) as { type: Y.XmlFragment; binding: { mapping: Map<Y.AbstractType<unknown>, unknown> } } | undefined
}

export default function Comments({ docId, collab, editor, role, userId }: {
  docId: string; collab: Collab; editor: Editor | null; role: Role; userId: string
}) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const canComment = atLeast(role, 'commenter')

  const load = useCallback(() => api<CommentItem[]>(`/documents/${docId}/comments`).then(setComments).catch((e) => setError(e.message)), [docId])
  useEffect(() => {
    void load()
    const t = setInterval(load, 5000) // simple polling keeps the list fresh across users
    return () => clearInterval(t)
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setError('')
    let anchor: string | null = null
    let quote = ''
    const { from, to } = editor?.state.selection ?? { from: 0, to: 0 }
    const ys = editor ? syncState(editor) : undefined
    if (editor && ys && from !== to) {
      const a = absolutePositionToRelativePosition(from, ys.type, ys.binding.mapping as never)
      const b = absolutePositionToRelativePosition(to, ys.type, ys.binding.mapping as never)
      anchor = JSON.stringify({ from: Y.relativePositionToJSON(a), to: Y.relativePositionToJSON(b) })
      quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 300)
    }
    try {
      await api(`/documents/${docId}/comments`, { body: { body: text, anchor, quote } })
      setText('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Where is this comment's text NOW? Convert the relative positions back.
  function locate(c: CommentItem) {
    if (!c.anchor || !editor) return
    const ys = syncState(editor)
    if (!ys) return
    const { from, to } = JSON.parse(c.anchor)
    const f = relativePositionToAbsolutePosition(collab.doc, ys.type, Y.createRelativePositionFromJSON(from), ys.binding.mapping as never)
    const t = relativePositionToAbsolutePosition(collab.doc, ys.type, Y.createRelativePositionFromJSON(to), ys.binding.mapping as never)
    if (f === null || t === null) return setError('The text this comment was attached to was deleted.')
    editor.chain().focus().setTextSelection({ from: f, to: t }).scrollIntoView().run()
  }

  const act = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn()
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const roots = comments.filter((c) => !c.parentId)
  return (
    <section aria-label="Comments" className="panel">
      <h2>Comments</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {roots.length === 0 && (
        <div className="empty">
          <EmptyCommentsArt />
          <strong>No comments yet</strong>
          {editor ? 'Select some text in the page, then write a comment here. It stays attached to those words.' : 'Write a comment to start a conversation.'}
        </div>
      )}
      <ul className="list">
        {roots.map((c) => (
          <li key={c.id} className={c.resolved ? 'resolved' : ''}>
            {c.resolved && <span className="sr-only">Resolved. </span>}
            {c.quote && <blockquote className="quote">{c.quote}</blockquote>}
            <strong>{c.authorName}</strong> <time className="muted" dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
            <p>{c.body}</p>
            <span className="row">
              {c.anchor && <button className="link" onClick={() => locate(c)} aria-label={`Show in text: comment by ${c.authorName}`}>Show in text</button>}
              {(c.authorId === userId || atLeast(role, 'editor')) && (
                <>
                  <button className="link" aria-label={`${c.resolved ? 'Reopen' : 'Resolve'} comment by ${c.authorName}`} onClick={act(() => api(`/comments/${c.id}`, { method: 'PATCH', body: { resolved: !c.resolved } }))}>
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button className="link" aria-label={`Delete comment by ${c.authorName}`} onClick={act(() => api(`/comments/${c.id}`, { method: 'DELETE' }))}>Delete</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canComment ? (
        <form onSubmit={add} className="stack">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={editor ? 'Select text in the document first to attach your comment to it' : 'Write a comment'} maxLength={4000} rows={3} aria-label="New comment" />
          <button className="btn">Comment</button>
        </form>
      ) : <p className="muted">Viewers can read comments but not write them.</p>}
    </section>
  )
}
