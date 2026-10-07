'use client'
import { useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/react'
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import { api, type CommentItem, type Role } from '@/lib/api'
import { keys, useAction, useComments } from '@/lib/queries'
import { atLeast } from '@/lib/roles'
import type { Collab } from '@/lib/collab/useCollab'
import { EmptyCommentsArt } from '../ui/Illustrations'

// A comment is anchored with Yjs relative positions. Unlike a character offset, a relative position
// follows the text it was attached to, so the comment keeps its place while others type before it.
function syncState(editor: Editor) {
  return ySyncPluginKey.getState(editor.state) as { type: Y.XmlFragment; binding: { mapping: Map<Y.AbstractType<unknown>, unknown> } } | undefined
}

export default function Comments({ docId, collab, editor, role, userId }: {
  docId: string; collab: Collab; editor: Editor | null; role: Role; userId: string
}) {
  const { data: comments = [], error: loadError } = useComments(docId) // polled, so others' comments appear
  const [text, setText] = useState('')
  const [localError, setLocalError] = useState('')
  const action = useAction([keys.comments(docId)])
  const error = localError || action.error || loadError?.message || ''
  const canComment = atLeast(role, 'commenter')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setLocalError('')
    action.reset()
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
    if (await action.run(() => api(`/documents/${docId}/comments`, { body: { body: text, anchor, quote } }))) setText('')
  }

  // Where is this comment's text now? Convert the relative positions back.
  function locate(c: CommentItem) {
    if (!c.anchor || !editor) return
    const ys = syncState(editor)
    if (!ys) return
    const { from, to } = JSON.parse(c.anchor)
    const f = relativePositionToAbsolutePosition(collab.doc, ys.type, Y.createRelativePositionFromJSON(from), ys.binding.mapping as never)
    const t = relativePositionToAbsolutePosition(collab.doc, ys.type, Y.createRelativePositionFromJSON(to), ys.binding.mapping as never)
    if (f === null || t === null) return setLocalError('The text this comment was attached to was deleted.')
    editor.chain().focus().setTextSelection({ from: f, to: t }).scrollIntoView().run()
  }

  const act = (fn: () => Promise<unknown>) => () => void action.run(fn)

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
