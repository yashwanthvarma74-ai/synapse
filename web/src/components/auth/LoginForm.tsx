'use client'
import { Suspense, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, tokenStore, type User } from '@/lib/api'
import { startGuest } from '@/lib/guest'
import { usePageTitle } from '@/lib/usePageTitle'

// Only follow a "go back to" address if it stays inside this site
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/')

function Form() {
  const router = useRouter()
  const next = safeNext(useSearchParams().get('next'))
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  usePageTitle(mode === 'login' ? 'Sign in' : 'Create account')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form
      const r = await api<{ token: string; user: User }>(`/auth/${mode}`, { body })
      tokenStore.set(r.token)
      router.replace(next)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // A guest is a brand-new account, so it can't open the page the visitor came from (that belonged to
  // someone else). It goes to its own Welcome document, except for an invite link, which it returns to and accepts.
  const starting = useRef(false)
  async function guest() {
    if (starting.current) return // a double click must not create two guests
    starting.current = true
    setBusy(true)
    setError('')
    try {
      const s = await startGuest()
      router.replace(next.startsWith('/join/') ? next : `/doc/${s.welcomeId}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      starting.current = false
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="page" style={{ maxWidth: 440 }}>
      <form onSubmit={submit} className="card stack" aria-describedby={error ? 'form-error' : undefined}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted" style={{ margin: 0 }}>{mode === 'login' ? 'Sign in to pick up where you left off.' : 'Free, and it takes a few seconds.'}</p>
        {mode === 'register' && (
          <label>Your name<input value={form.name} onChange={set('name')} required maxLength={60} autoComplete="name" placeholder="How others will see you" /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="you@example.com" /></label>
        <label>Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'register' ? 'pw-hint' : undefined} />
        </label>
        {mode === 'register' && <p id="pw-hint" className="hint" style={{ margin: 0 }}>At least 8 characters.</p>}
        {error && <p role="alert" id="form-error" className="error">{error}</p>}
        <button className="btn large" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
        <button type="button" className="btn secondary" onClick={guest} disabled={busy}>Just let me try it, no account</button>
      </form>
    </div>
  )
}

export default function LoginForm() {
  return <Suspense><Form /></Suspense>
}
