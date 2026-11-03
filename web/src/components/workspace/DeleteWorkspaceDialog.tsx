'use client'
import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Button, Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from '@yashwanthvarma74/react'

// Deleting a workspace removes everything in it for good, so the person types its name first (as GitHub
// does for repositories). The design system's dialog traps focus and closes on Escape; focus starts on Cancel.
export default function DeleteWorkspaceDialog({ workspaceId, name, items, others, open, onClose, onDeleted }: {
  workspaceId: string; name: string; items: number; others: number; open: boolean; onClose: () => void; onDeleted: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }} role="alertdialog" initialFocusRef={cancel}>
      <DialogHeader>
        <DialogTitle>Delete “{name}”?</DialogTitle>
        <DialogDescription>
          This permanently deletes the workspace and everything in it: {items} {items === 1 ? 'document or board' : 'documents and boards'},
          their version history, comments, chat messages, uploaded files and invite links.
          {others > 0 ? ` ${others} ${others === 1 ? 'other person' : 'other people'} will lose access.` : ''}{' '}
          <strong>This cannot be undone.</strong>
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <label htmlFor="delete-ws-confirm">Type <strong>{name}</strong> to confirm</label>
        <Input id="delete-ws-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void remove() } }} />
        {error && <p role="alert" className="error">{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button ref={cancel} variant="secondary" onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={remove} disabled={!matches || busy}>{busy ? 'Deleting…' : 'Delete workspace'}</Button>
      </DialogFooter>
    </Dialog>
  )
}
