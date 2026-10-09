'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, buttonClass } from '@yashwanthvarma74/react'
import { startGuest } from '@/lib/guest'
import { CRDT_POST, REPO } from '@/lib/site'

const DIFFERENCES = [
  { title: 'Local-first', text: 'The copy on your device is the working copy. Edits apply instantly and persist in IndexedDB. The server is a sync relay and durable store, not a gatekeeper.' },
  { title: 'Convergent by construction', text: 'Documents and canvas are Yjs CRDTs. A randomised harness ran 10,000 concurrent-edit scenarios, and every one ended with identical state on all replicas.' },
  { title: 'Low-latency fan-out', text: 'Server-side update propagation p95 of 0.82 ms on one gateway and 1.25 ms across two via Redis pub/sub, with every edit persisted to MongoDB. Loopback, one machine.' },
  { title: 'Two consistency domains', text: 'Content merges as a CRDT, while access control stays server-authoritative. Revoking a role closes the live socket, and a viewer’s writes are dropped on the server.' },
  { title: 'Stateless gateways', text: 'WebSocket gateways hold no durable state and coordinate through Redis. 200 editors in one room were measured with no lost messages.' },
  { title: 'Measured and observable', text: 'OpenTelemetry traces, Prometheus metrics, structured logs and k6 load tests. The benchmark report states what was measured and what was not.' },
]

const STEPS = [
  { title: 'Apply locally', text: 'Each edit is applied to the local Yjs document at once and persisted to IndexedDB. Nothing waits on the network.' },
  { title: 'Sync state vectors', text: 'On reconnect, client and server exchange state vectors and send only the updates the other side is missing.' },
  { title: 'Merge deterministically', text: 'Every update has a unique ID and a causal position, so concurrent edits merge in any order and every replica converges.' },
]

// What a first-time visitor sees: what this is, a real look at it, and one clear way in.
export default function Landing() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function tryIt() {
    setBusy(true)
    setError('')
    try {
      const s = await startGuest()
      router.push(`/doc/${s.welcomeId}`)
    } catch (e) {
      setError((e as Error).message || 'Could not start. Is the server running?')
      setBusy(false)
    }
  }

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Local-first, real-time collaborative workspace.</h1>
        <p className="lead">
          Rich-text documents and a shared canvas built on CRDTs. Every device keeps a full copy, edits apply locally
          first, and replicas converge without conflicts after any network partition.
        </p>
        <div className="cta-row">
          <Button variant="primary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now'}</Button>
          <a className={buttonClass({ variant: 'secondary', size: 'lg' })} href={REPO} target="_blank" rel="noopener">
            View source<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <p className="meta">No sign-up needed. Open source, MIT licence.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <figure className="product">
          <Image
            src="/product.jpg"
            width={2560}
            height={1500}
            priority
            sizes="(max-width: 1200px) 100vw, 1120px"
            alt="A Synapse document open in two windows at once, with each person’s cursor and name visible in the text."
          />
        </figure>
      </section>

      <section className="band" aria-labelledby="features-title">
        <h2 id="features-title">What sets it apart</h2>
        <ul className="grid">
          {DIFFERENCES.map((f) => (
            <li key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
        <p className="also">
          Also included: comments anchored to text, named version history with restore, per-document chat, full-text
          search, role-based sharing by link, and export to PDF, Word, Markdown, PNG and SVG.
        </p>
      </section>

      <section className="band split" aria-labelledby="offline-title">
        <div>
          <h2 id="offline-title">How offline editing merges</h2>
          <p className="muted-lead">
            Replicas are peers. The server relays updates between them and stores the log, but it does not decide the result.
          </p>
          <a href={CRDT_POST} target="_blank" rel="noopener">Why CRDTs and not operational transform<span className="sr-only"> (opens in a new tab)</span></a>
        </div>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="closing" aria-labelledby="ready-title">
        <h2 id="ready-title">Try it</h2>
        <p>One click opens a sample document and board as a guest. Open the share link in a second window, switch on offline mode, and watch both copies merge.</p>
        <div className="cta-row">
          <Button variant="primary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now'}</Button>
          <Link className={buttonClass({ variant: 'secondary', size: 'lg' })} href="/login">Sign in</Link>
        </div>
      </section>
    </div>
  )
}
