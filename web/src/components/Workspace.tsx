'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { api, ApiError, tokenStore, type DocMeta } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { useCollab, useStatus, type Collab } from '@/lib/useCollab'
import { atLeast } from '@/lib/roles'
import dynamic from 'next/dynamic'
import Editor from './Editor'
import Presence from './Presence'
import NetworkSimulator from './NetworkSimulator'
import Comments from './Comments'
import History from './History'
import Tabs from './Tabs'
import { usePageTitle } from '@/lib/usePageTitle'

// PixiJS touches `window`, so the canvas only loads in the browser
const CanvasBoard = dynamic(() => import('./CanvasBoard'), { ssr: false, loading: () => <p className="muted">Loading canvas…</p> })

const LABEL = { connecting: 'Connecting…', connected: 'Synced', offline: 'Offline (saved locally)', revoked: 'Access removed' }

function StatusPill({ collab }: { collab: Collab }) {
  const status = useStatus(collab.provider)
  return (
    <span className="status" role="status">
      <span className={`dot ${status}`} />
      {LABEL[status]}
    </span>
  )
}

export default function Workspace({ docId }: { docId: string }) {
  const { user } = useSession()
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api<DocMeta>(`/documents/${docId}`).then(setMeta).catch((e: ApiError) => setError(e.status === 404 ? "This document doesn't exist, or you don't have access." : e.message))
  }, [user, docId])

  if (error) return <div className="shell"><p role="alert" className="error">{error}</p><nav aria-label="Back"><Link className="back-link" href="/">← Back</Link></nav></div>
  if (!user || !meta) return <div className="shell"><p className="muted">Loading…</p></div>
  return <DocView docId={docId} meta={meta} userId={user.id} userName={user.name} />
}

function DocView({ docId, meta, userId, userName }: { docId: string; meta: DocMeta; userId: string; userName: string }) {
  usePageTitle(meta.title)
  const collab = useCollab(docId, { name: userName, token: tokenStore.get() ?? '' })
  const [editor, setEditor] = useState<TiptapEditor | null>(null)
  const status = useStatus(collab?.provider ?? null)
  const revoked = status === 'revoked'
  const readOnly = revoked || !atLeast(meta.role, 'editor')

  // Access removed: the offline copy must not outlive the permission
  useEffect(() => {
    if (revoked && collab) void collab.idb.clearData()
  }, [revoked, collab])

  return (
    <div className="shell wide">
      <nav aria-label="Back"><Link className="back-link" href={`/w/${meta.workspaceId}`}>← Workspace</Link></nav>
      <div className="topbar">
        <div>
          <h1>{meta.title}</h1>
          <span className="muted">your role: <span className="badge">{meta.role}</span>{readOnly ? ' · read only' : ''}</span>
        </div>
        {collab && <StatusPill collab={collab} />}
        {collab && <Presence collab={collab} />}
      </div>
      {revoked && <p role="alert" className="error">Your access to this document was removed. Your local copy has been deleted.</p>}
      {collab ? (
        <div className="layout">
          <div>
            <NetworkSimulator provider={collab.provider} />
            {meta.type === 'canvas'
              ? <CanvasBoard collab={collab} readOnly={readOnly} />
              : <Editor collab={collab} readOnly={readOnly} onEditor={setEditor} />}
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
        <p className="muted">Loading…</p>
      )}
    </div>
  )
}
