'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, tokenStore, type User } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { usePageTitle } from '@/lib/usePageTitle'
import { Button, Card, Input, buttonClass } from '@yashwanthvarma74/react'

// Turn a guest into a real account. Everything they made stays theirs.
export default function UpgradeForm() {
  const router = useRouter()
  const { user, ready } = useSession()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  usePageTitle('Save your work')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ token: string; user: User }>('/auth/upgrade', { body: form })
      tokenStore.set(r.token)
      router.replace('/')
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  if (!ready || !user) return <div className="page"><p className="muted">Loading…</p></div>
  if (!user.guest) {
    return <div className="page" style={{ maxWidth: 440 }}><Card padding="lg" className="stack"><h1>You already have an account</h1><Link className={buttonClass({ variant: 'primary', size: 'md' })} href="/">Back to your workspaces</Link></Card></div>
  }
  return (
    <div className="page" style={{ maxWidth: 440 }}>
      <Card padding="lg"><form onSubmit={submit} className="stack" aria-describedby={error ? 'form-error' : undefined}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Keep your work</h1>
        <p className="muted" style={{ margin: 0 }}>Everything you made as {user.name} comes with you. Pick how you want to sign in next time.</p>
        <label>Your name<Input value={form.name} onChange={set('name')} required maxLength={60} autoComplete="name" placeholder={user.name} /></label>
        <label>Email<Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password<Input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" aria-describedby="pw-hint" /></label>
        <p id="pw-hint" className="hint" style={{ margin: 0 }}>At least 8 characters.</p>
        {error && <p role="alert" id="form-error" className="error">{error}</p>}
        <Button variant="primary" size="lg" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create my account'}</Button>
      </form></Card>
    </div>
  )
}
