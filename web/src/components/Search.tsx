'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

interface Hit { id: string; title: string; snippet: string }

export default function Search() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [error, setError] = useState('')

  async function run(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setError('')
    try {
      setHits(await api<Hit[]>(`/search?q=${encodeURIComponent(q.trim())}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section aria-label="Search documents">
      <form onSubmit={run} className="row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all your documents" aria-label="Search documents" />
        <button className="btn">Search</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {hits && (
        <ul className="list" aria-live="polite">
          {hits.length === 0 && <li className="muted">No results.</li>}
          {hits.map((h) => (
            <li key={h.id}><Link href={`/doc/${h.id}`}>{h.title}</Link><div className="muted">{h.snippet}</div></li>
          ))}
        </ul>
      )}
    </section>
  )
}
