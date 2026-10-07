'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

// Deleting a workspace removes everything in it for good, so the person types its name first (as GitHub
// does for repositories). The native <dialog> traps focus and closes on Escape; focus starts on Cancel.
export default function DeleteWorkspaceDialog({ workspaceId, name, items, others, open, onClose, onDeleted }: {
  workspaceId: string; name: string; items: number; others: number; open: boolean; onClose: () => void; onDeleted: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()

  async function remove() {
    if (!matches || busy) return
    setBusy(true)
    setError('')
    try {
      await api(`/workspaces/${workspaceId}`, { method: 'DELETE' })
      setTyped('')
      onDeleted()
    } catch (e) {
      setError((e as Error).message || 'Could not delete the workspace. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setTyped('')
    setError('')
    onClose()
  }

  return (
    <dialog ref={ref} onClose={close} aria-labelledby="delete-ws-title" aria-describedby="delete-ws-desc">
      <h2 id="delete-ws-title">Delete “{name}”?</h2>
      <div id="delete-ws-desc">
        <p>
          This permanently deletes the workspace and everything in it: {items} {items === 1 ? 'document or board' : 'documents and boards'},
          their version history, comments, chat messages, uploaded files and invite links.
          {others > 0 ? ` ${others} ${others === 1 ? 'other person' : 'other people'} will lose access.` : ''}
        </p>
        <p><strong>This cannot be undone.</strong></p>
      </div>
      <label htmlFor="delete-ws-confirm">Type <strong>{name}</strong> to confirm</label>
      <input id="delete-ws-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void remove() } }} />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions">
        <button className="btn secondary" onClick={close} autoFocus>Cancel</button>
        <button className="btn danger" onClick={remove} disabled={!matches || busy}>{busy ? 'Deleting…' : 'Delete workspace'}</button>
      </div>
    </dialog>
  )
}
