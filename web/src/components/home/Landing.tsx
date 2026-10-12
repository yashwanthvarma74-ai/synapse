'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, buttonClass } from '@yashwanthvarma74/react'
import { startGuest } from '@/lib/guest'
import { CRDT_POST, REPO } from '@/lib/site'
import { ConvergeDiagram, DomainsDiagram, GatewaysDiagram, LatencyDiagram, LocalFirstDiagram, ObservabilityDiagram } from './Diagrams'

const DIFFERENCES = [
  { title: 'Local first', Art: LocalFirstDiagram, stat: '16.6 ms', statLabel: 'keystroke to paint, p95',
    text: 'The copy on your device is the working copy. Edits apply instantly and persist in IndexedDB. The server relays and stores.' },
  { title: 'Convergent by construction', Art: ConvergeDiagram, stat: '10,000 / 10,000', statLabel: 'random runs ended identical',
    text: 'Documents and canvas are Yjs CRDTs, so copies edited apart merge to the same state with no conflicts to resolve.' },
  { title: 'Low latency fan out', Art: LatencyDiagram, stat: '0.82 ms', statLabel: 'server propagation, p95',
    text: 'Every edit is relayed to the room and saved to MongoDB. Measured on loopback on one machine.' },
  { title: 'Two consistency domains', Art: DomainsDiagram, stat: 'Every write', statLabel: 'role checked on the server',
    text: 'Content merges as a CRDT, while access stays with the server. Revoking a role closes the live connection.' },
  { title: 'Stateless gateways', Art: GatewaysDiagram, stat: '200 editors', statLabel: 'in one room, no lost messages',
    text: 'Gateways keep no durable state and coordinate through Redis, so any gateway can serve any room.' },
  { title: 'Measured and observable', Art: ObservabilityDiagram, stat: 'SLO alerts', statLabel: 'tested with promtool',
    text: 'OpenTelemetry metrics, a Grafana dashboard, burn rate alerts and k6 load tests. The report says what was not measured.' },
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
        <h1 id="hero-title">Local first, real time collaborative workspace.</h1>
        <p className="lead">
          Rich text documents and a shared canvas built on CRDTs. Every device keeps a full copy, edits apply locally
          first, and replicas converge without conflicts after any network partition.
        </p>
        <div className="cta-row">
          <Button variant="primary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now'}</Button>
          <a className={buttonClass({ variant: 'secondary', size: 'lg' })} href={REPO} target="_blank" rel="noopener">
            View source<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <p className="meta">No sign up needed. Open source, MIT licence.</p>
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
        <ul className="diffs">
          {DIFFERENCES.map(({ title, Art, stat, statLabel, text }) => (
            <li key={title} className="diff">
              <div className="diff-art"><Art /></div>
              <div className="diff-body">
                <p className="stat"><span className="stat-value">{stat}</span><span className="stat-label">{statLabel}</span></p>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="also">
          Also included: comments anchored to text, named version history with restore, per document chat, full text
          search, role based sharing by link, and export to PDF, Word, Markdown, PNG and SVG.
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
