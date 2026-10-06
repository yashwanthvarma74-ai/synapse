'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearch } from '@/lib/queries'

export default function Search() {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const { data: hits, error } = useSearch(submitted)

  function run(e: FormEvent) {
    e.preventDefault()
    setSubmitted(q.trim())
  }

  return (
    <section aria-label="Search documents">
      <form onSubmit={run} className="row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all your documents" aria-label="Search documents" />
        <button className="btn">Search</button>
      </form>
      {error && <p role="alert" className="error">{error.message}</p>}
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
