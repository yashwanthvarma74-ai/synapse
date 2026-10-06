'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { api, ApiError, tokenStore, type DocMeta } from '@/lib/api'
import { keys, useDocMeta } from '@/lib/queries'
import { useUi } from '@/lib/uiStore'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/lib/useSession'
import { useCollab, useStatus, type Collab } from '@/lib/useCollab'
import { atLeast } from '@/lib/roles'
import { usePageTitle } from '@/lib/usePageTitle'
import Editor from './Editor'
import EditorToolbar from './EditorToolbar'
import Presence from './Presence'
import OfflineDemo from './OfflineDemo'
import Comments from './Comments'
import History from './History'
import Tabs from './Tabs'
import ShareDialog from './ShareDialog'
import { NotFoundArt } from './ui/Illustrations'

// PixiJS touches `window`, so the canvas only loads in the browser
const CanvasBoard = dynamic(() => import('./CanvasBoard'), { ssr: false, loading: () => <p className="muted">Loading canvas…</p> })

// Words a first-time user understands, not jargon
const STATUS = {
  connecting: { text: 'Connecting…', hint: 'Reaching the server' },
  connected: { text: 'Connected · changes sync as you type', hint: 'Everyone sees your changes right away' },
  offline: { text: 'Offline · saved on this device, will sync when you reconnect', hint: 'Nothing is lost while you are offline' },
  revoked: { text: 'Access removed', hint: 'You no longer have access to this document' },
} as const

function StatusPill({ collab }: { collab: Collab }) {
  const status = useStatus(collab.provider)
  const s = STATUS[status]
  return (
    <span className={`status${status === 'connected' ? ' status-ok' : ''}`} role="status" title={s.hint}>
      <span className={`dot ${status}`} aria-hidden="true" />
      <span className="status-text">{s.text}</span>
    </span>
  )
}

const ROLE_WORDS = { owner: 'You own this', editor: 'You can edit', commenter: 'You can comment', viewer: 'You can read' } as const

export default function Workspace({ docId }: { docId: string }) {
  const { user } = useSession()
  const qc = useQueryClient()
  const { data: meta, error: loadError } = useDocMeta(docId, !!user)
  const error = loadError ? ((loadError as ApiError).status === 404 ? "This document doesn't exist, or you don't have access to it." : loadError.message) : ''
  const setMeta = (m: DocMeta) => qc.setQueryData(keys.doc(docId), m)

  if (error) {
    return (
      <div className="notice">
        <NotFoundArt />
        <h1>We can&apos;t open this</h1>
        <p className="muted">{error}</p>
        <p className="muted">If someone shared it with you, ask them for a new invite link.</p>
        <Link className="btn" href="/">Back to your workspaces</Link>
      </div>
    )
  }
  if (!user || !meta) return <div className="page"><p className="muted">Opening your document…</p></div>
  return <DocView docId={docId} meta={meta} setMeta={setMeta} userId={user.id} userName={user.name} />
}

function DocView({ docId, meta, setMeta, userId, userName }: { docId: string; meta: DocMeta; setMeta: (m: DocMeta) => void; userId: string; userName: string }) {
  usePageTitle(meta.title)
  const collab = useCollab(docId, { name: userName, token: tokenStore.get() ?? '' })
  const [editor, setEditor] = useState<TiptapEditor | null>(null)
  const [title, setTitle] = useState(meta.title)
  const sharing = useUi((s) => s.shareOpen)
  const setSharing = useUi((s) => s.setShareOpen)
  const status = useStatus(collab?.provider ?? null)
  const revoked = status === 'revoked'
  const canEdit = !revoked && atLeast(meta.role, 'editor')

  // Access removed: the offline copy must not outlive the permission
  useEffect(() => {
    if (revoked && collab) void collab.idb.clearData()
  }, [revoked, collab])

  async function saveTitle() {
    const next = title.trim()
    if (!next) return setTitle(meta.title)
    if (next === meta.title) return
    try {
      await api(`/documents/${docId}`, { method: 'PATCH', body: { title: next } })
      setMeta({ ...meta, title: next })
    } catch {
      setTitle(meta.title)
    }
  }

  return (
    <div className="page wide">
      <nav aria-label="Back"><Link className="back-link" href={`/w/${meta.workspaceId}`}>← Back to the workspace</Link></nav>
      <div className="doc-head">
        <div className="doc-title-wrap">
          {/* The visible title is an editable box, which is not a heading. This gives the page its heading for screen readers. */}
          <h1 className="sr-only">{meta.title}</h1>
          <input
            className="doc-title"
            aria-label="Document title"
            value={title}
            readOnly={!canEdit}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="doc-sub">{revoked ? 'Access removed' : ROLE_WORDS[meta.role]} · {meta.type === 'canvas' ? 'Whiteboard' : 'Document'}</div>
        </div>
        <div className="doc-actions">
          {collab && <StatusPill collab={collab} />}
          {collab && <Presence collab={collab} />}
          {meta.role === 'owner' && !revoked && <button className="btn" onClick={() => setSharing(true)}>Share</button>}
        </div>
      </div>
      {revoked && <p role="alert" className="error">Your access to this document was removed. Your local copy has been deleted.</p>}
      <ShareDialog workspaceId={meta.workspaceId} open={sharing} onClose={() => setSharing(false)} />

      {collab ? (
        <div className="layout">
          <div>
            <OfflineDemo provider={collab.provider} />
            {meta.type === 'canvas' ? (
              <CanvasBoard collab={collab} readOnly={!canEdit} />
            ) : (
              <>
                <EditorToolbar editor={editor} disabled={!canEdit} />
                <Editor docId={docId} collab={collab} readOnly={!canEdit} onEditor={setEditor} />
              </>
            )}
          </div>
          <aside>
            <Tabs
              label="Document tools"
              tabs={[
                { id: 'comments', label: 'Comments', content: <Comments docId={docId} collab={collab} editor={editor} role={meta.role} userId={userId} /> },
                { id: 'history', label: 'History', content: <History docId={docId} collab={collab} role={meta.role} type={meta.type} /> },
              ]}
            />
          </aside>
        </div>
      ) : (
        <p className="muted">Opening your document…</p>
      )}
    </div>
  )
}
