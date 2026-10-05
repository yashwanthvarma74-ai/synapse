'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError, type Role } from '@/lib/api'
import { startGuest } from '@/lib/guest'
import { useSession } from '@/lib/useSession'
import { usePageTitle } from '@/lib/usePageTitle'
import { JoinArt, NotFoundArt } from './ui/Illustrations'

interface InviteInfo { workspaceName: string; inviterName: string; role: Exclude<Role, 'owner'> }
const WHAT: Record<InviteInfo['role'], string> = {
  editor: 'edit documents and boards', commenter: 'read and comment', viewer: 'read',
}

// The page behind an invite link: say clearly who invited you to what, then one click to join.
export default function JoinInvite({ code }: { code: string }) {
  const router = useRouter()
  const { user, ready } = useSession({ optional: true })
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  usePageTitle(problem && !info ? 'Invite link not valid' : 'You are invited')

  useEffect(() => {
    api<InviteInfo>(`/invites/${encodeURIComponent(code)}`).then(setInfo).catch((e: ApiError) => setProblem(e.message))
  }, [code])

  async function accept() {
    setBusy(true)
    setProblem('')
    try {
      const r = await api<{ documentId: string | null; workspaceId: string }>(`/invites/${encodeURIComponent(code)}/accept`, { method: 'POST', body: {} })
      router.replace(r.documentId ? `/doc/${r.documentId}` : `/w/${r.workspaceId}`)
    } catch (e) {
      setProblem((e as Error).message)
      setBusy(false)
    }
  }

  async function joinAsGuest() {
    setBusy(true)
    try {
      await startGuest() // a throwaway account, so no sign-up is needed to join
      await accept()
    } catch (e) {
      setProblem((e as Error).message)
      setBusy(false)
    }
  }

  if (problem && !info) {
    return (
      <div className="card join-card">
        <NotFoundArt />
        <h1>This invite link doesn&apos;t work</h1>
        <p className="muted">{problem}</p>
        <Link className="btn" href="/">Go to Synapse</Link>
      </div>
    )
  }
  if (!info || !ready) return <div className="page"><p className="muted">Checking your invite…</p></div>

  return (
    <div className="card join-card">
      <JoinArt />
      <h1>{info.inviterName} invited you</h1>
      <p>to join <strong>{info.workspaceName}</strong>, where you&apos;ll be able to {WHAT[info.role]}.</p>
      {problem && <p role="alert" className="error">{problem}</p>}
      <div className="stack">
        {user ? (
          <button className="btn large" onClick={accept} disabled={busy}>{busy ? 'Joining…' : `Join as ${user.name}`}</button>
        ) : (
          <>
            <button className="btn large" onClick={joinAsGuest} disabled={busy}>{busy ? 'Joining…' : 'Join now, no sign-up'}</button>
            <Link className="btn secondary" href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>I already have an account</Link>
            <p className="hint" style={{ textAlign: 'center' }}>Joining as a guest gives you a temporary name. You can create an account afterwards and keep everything.</p>
          </>
        )}
      </div>
    </div>
  )
}
