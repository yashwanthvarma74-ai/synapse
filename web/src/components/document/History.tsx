'use client'
import { useState, type FormEvent } from 'react'
import { apiBytes, type Role, type VersionItem } from '@/lib/api'
import { atLeast } from '@/lib/roles'
import { keys, useAction, useVersions } from '@/lib/queries'
import { restoreInto, stateToDoc, type DocType } from '@/lib/collab/versions'
import { fullDate, timeAgo } from '@/lib/time'
import type { Collab } from '@/lib/collab/useCollab'
import VersionPreview from './VersionPreview'
import { EmptyDocsArt } from '../ui/Illustrations'

interface Props {
  docId: string
  collab: Collab
  role: Role
  type: DocType
  connected: boolean
}

// Named versions: save one before a big change, preview it later, and put the page back to that point.
export default function History({ docId, collab, role, type, connected }: Props) {
  const { data: versions = [], error: loadError } = useVersions(docId)
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState<{ version: VersionItem; state: Uint8Array } | null>(null)
  const [notice, setNotice] = useState('')
  const [localError, setLocalError] = useState('')
  const action = useAction([keys.versions(docId)])
  const error = localError || action.error || loadError?.message || ''
  const canEdit = atLeast(role, 'editor')

  async function save(e: FormEvent) {
    e.preventDefault()
    const name = label.trim()
    if (!name) return
    setNotice('')
    setLocalError('')
    if (await action.run(() => collab.provider.saveVersion(name))) {
      setLabel('')
      setNotice(`Saved “${name}”.`)
    }
  }

  async function open(version: VersionItem) {
    setNotice('')
    setLocalError('')
    try {
      setPreview({ version, state: await apiBytes(`/documents/${docId}/versions/${version.version}`) })
    } catch (err) {
      setLocalError((err as Error).message)
    }
  }

  async function restore({ version, state }: { version: VersionItem; state: Uint8Array }) {
    const backup = `Before restoring ${version.label}`.slice(0, 80)
    const done = await action.run(async () => {
      await collab.provider.saveVersion(backup) // keep what is there now, so this can be undone
      restoreInto(collab.doc, stateToDoc(state), type)
    })
    if (done) {
      setPreview(null)
      setNotice(`Restored “${version.label}”. Where you were before is saved as “${backup}”.`)
    }
  }

  return (
    <section aria-label="Version history" className="panel">
      <h2>Version history</h2>
      <p className="muted">Save the {type === 'canvas' ? 'board' : 'document'} as it is now. You can come back to it any time.</p>
      {canEdit && (
        <form onSubmit={save} className="row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version" maxLength={80} aria-label="Version name" disabled={!connected} />
          <button className="btn" disabled={!connected || !label.trim() || action.pending}>{action.pending ? 'Saving…' : 'Save'}</button>
        </form>
      )}
      {canEdit && !connected && <p className="hint">You&apos;re offline. Saving a version needs a connection.</p>}
      <p role="status" className="notice-line">{notice}</p>
      {error && <p role="alert" className="error">{error}</p>}

      {versions.length === 0 ? (
        <div className="empty">
          <EmptyDocsArt />
          <strong>No saved versions yet</strong>
          Name a version before a big change. You can preview it and bring it back whenever you like.
        </div>
      ) : (
        <ul className="list versions">
          {versions.map((v) => (
            <li key={v.version}>
              <strong>{v.label}</strong>
              <span className="muted">Saved by {v.savedBy} · <time dateTime={v.createdAt} title={fullDate(v.createdAt)}>{timeAgo(v.createdAt)}</time></span>
              <button type="button" className="link" aria-label={`Preview version ${v.label}`} onClick={() => open(v)}>Preview</button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <VersionPreview
          version={preview.version}
          state={preview.state}
          type={type}
          canRestore={canEdit && connected}
          restoring={action.pending}
          onRestore={() => restore(preview)}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}
