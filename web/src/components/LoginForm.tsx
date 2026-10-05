'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, tokenStore, type User } from '@/lib/api'
import { usePageTitle } from '@/lib/usePageTitle'

export default function LoginForm() {
  const router = useRouter()
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
      router.replace('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="shell narrow">
      <h1>Synapse</h1>
      <form onSubmit={submit} className="card stack" aria-describedby={error ? 'form-error' : undefined}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        {mode === 'register' && (
          <label>Name<input value={form.name} onChange={set('name')} required maxLength={60} autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <p role="alert" id="form-error" className="error">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
