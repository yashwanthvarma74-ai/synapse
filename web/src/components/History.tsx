'use client'
import { useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import { api, apiBytes, type Role, type VersionItem } from '@/lib/api'
import { keys, useAction, useVersions } from '@/lib/queries'
import { atLeast } from '@/lib/roles'
import { extractText } from '@/lib/text'
import { canvasText, objectsMap } from '@/lib/canvasModel'
import type { Collab } from '@/lib/useCollab'
import { EmptyDocsArt } from './ui/Illustrations'

export default function History({ docId, collab, role, type }: { docId: string; collab: Collab; role: Role; type: 'doc' | 'canvas' }) {
  const { data: versions = [], error: loadError } = useVersions(docId)
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState<{ version: number; label: string; text: string } | null>(null)
  const [localError, setLocalError] = useState('')
  const action = useAction([keys.versions(docId)])
  const error = localError || action.error || loadError?.message || ''
  const canEdit = atLeast(role, 'editor')

  // The server stores the document's saved state; "Save" snapshots it as a named version.
  // The editor's own edits reach the server through the gateway first, so wait a beat.
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setLocalError('')
    const saved = await action.run(async () => {
      await new Promise((r) => setTimeout(r, 300))
      await api(`/documents/${docId}/versions`, { body: { label } })
    })
    if (saved) setLabel('')
  }

  async function open(v: VersionItem) {
    setLocalError('')
    try {
      const old = new Y.Doc()
      Y.applyUpdate(old, await apiBytes(`/documents/${docId}/versions/${v.version}`))
      setPreview({ version: v.version, label: v.label, text: type === 'canvas' ? canvasText(old) || '(canvas with shapes, no text)' : extractText(old) })
    } catch (err) {
      setLocalError((err as Error).message)
    }
  }

  // Restore = copy the old content into the live doc as a NEW edit. Nothing is
  // erased: everyone sees the change merge in, and it can itself be undone.
  async function restore(v: VersionItem) {
    if (!confirm(`Replace the current content with "${v.label}"? Your current content is saved as a version first.`)) return
    setLocalError('')
    const restored = await action.run(async () => {
      await api(`/documents/${docId}/versions`, { body: { label: `Before restoring "${v.label}"`.slice(0, 80) } })
      const old = new Y.Doc()
      Y.applyUpdate(old, await apiBytes(`/documents/${docId}/versions/${v.version}`))
      if (type === 'canvas') {
        const src = objectsMap(old)
        const dst = objectsMap(collab.doc)
        collab.doc.transact(() => {
          dst.forEach((_, key) => dst.delete(key))
          src.forEach((m, key) => dst.set(key, m.clone()))
        })
      } else {
        const src = old.getXmlFragment('default')
        const dst = collab.doc.getXmlFragment('default')
        collab.doc.transact(() => {
          dst.delete(0, dst.length)
          dst.insert(0, src.toArray().map((n) => (n as Y.XmlElement).clone()))
        })
      }
    })
    if (restored) setPreview(null)
  }

  return (
    <section aria-label="Version history" className="panel">
      <h2>Version history</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {canEdit && (
        <form onSubmit={save} className="row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version" maxLength={80} aria-label="Version name" />
          <button className="btn">Save</button>
        </form>
      )}
      {versions.length === 0 && (
        <div className="empty">
          <EmptyDocsArt />
          <strong>No saved versions yet</strong>
          Name a version before a big change. You can preview it and bring it back any time.
        </div>
      )}
      <ul className="list">
        {versions.map((v) => (
          <li key={v.version}>
            <strong>{v.label}</strong> <time className="muted" dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time>
            <span className="row">
              <button className="link" aria-label={`Preview version ${v.label}`} onClick={() => open(v)}>Preview</button>
              {canEdit && <button className="link" aria-label={`Restore version ${v.label}`} onClick={() => restore(v)}>Restore</button>}
            </span>
          </li>
        ))}
      </ul>
      {preview && (
        <div className="preview" role="region" aria-label={`Preview of ${preview.label}`}>
          <strong>Preview: {preview.label}</strong> <button className="link" onClick={() => setPreview(null)}>Close</button>
          <pre>{preview.text || '(empty)'}</pre>
        </div>
      )}
    </section>
  )
}
