'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { keys, useAction, useInvites, type Invite } from '@/lib/queries'
const ROLES = [
  { value: 'editor', label: 'Can edit', help: 'Change documents and boards' },
  { value: 'commenter', label: 'Can comment', help: 'Read, and leave comments' },
  { value: 'viewer', label: 'Can only view', help: 'Read, nothing else' },
] as const

const linkFor = (code: string) => `${window.location.origin}/join/${code}`

// Invite people with a link. Whoever opens it can join with the role you pick.
export default function ShareDialog({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [role, setRole] = useState<Invite['role']>('editor')
  const { data: invites = [], error: loadError } = useInvites(workspaceId, open)
  const [newest, setNewest] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const action = useAction([keys.invites(workspaceId)])
  const error = action.error || loadError?.message || ''
  const busy = action.pending

  // open and close the native <dialog>: it traps focus and closes on Escape for us
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  async function create() {
    setMessage('')
    await action.run(async () => {
      const made = await api<{ code: string }>(`/workspaces/${workspaceId}/invites`, { body: { role } })
      setNewest(made.code)
    })
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code))
      setMessage('Link copied. Paste it into a message.')
    } catch {
      setMessage('Select the link and copy it with Ctrl+C (Cmd+C on a Mac).')
    }
  }

  async function revoke(code: string) {
    if (await action.run(() => api(`/workspaces/${workspaceId}/invites/${code}`, { method: 'DELETE' }))) {
      if (newest === code) setNewest(null)
      setMessage('That link no longer works.')
    }
  }

  const shown = newest ?? invites[0]?.code ?? null

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="share-title">
      <h2 id="share-title">Invite people</h2>
      <p className="muted">Create a link and send it to anyone. They can join in one click, with no account needed.</p>
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>What can they do?</legend>
        <div className="stack">
          {ROLES.map((r) => (
            <label key={r.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="invite-role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} style={{ flex: 'none' }} />
              <span><strong>{r.label}</strong> <span className="muted">{r.help}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create invite link'}</button>

      {shown && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="invite-link">Your link</label>
          <div className="copy-box">
            <input id="invite-link" readOnly value={linkFor(shown)} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn secondary" onClick={() => copy(shown)}>Copy link</button>
          </div>
          <p className="hint">Anyone with this link can join, so share it like you would share the document itself. It stops working after 7 days.</p>
        </div>
      )}

      {invites.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Active links ({invites.length})</summary>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.code} className="row spread">
                <span>{ROLES.find((r) => r.value === i.role)?.label} · used {i.uses} {i.uses === 1 ? 'time' : 'times'}</span>
                <span>
                  <button className="link" onClick={() => copy(i.code)} aria-label={`Copy the ${i.role} link`}>Copy</button>
                  <button className="link" onClick={() => revoke(i.code)} aria-label={`Stop the ${i.role} link from working`}>Stop sharing</button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p role="status" className="muted" style={{ minHeight: '1.5em' }}>{message}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button className="btn secondary" onClick={onClose}>Done</button></div>
    </dialog>
  )
}
