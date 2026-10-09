'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, buttonClass } from '@yashwanthvarma74/react'
import { startGuest } from '@/lib/guest'
import { CRDT_POST, REPO } from '@/lib/site'

const FEATURES = [
  { title: 'Real-time editing', text: 'Everyone edits the same page at once. Coloured cursors with names show who is where.' },
  { title: 'Offline by default', text: 'Changes are written to the browser first and sync when the connection comes back.' },
  { title: 'Conflict-free merging', text: 'Concurrent edits to the same sentence merge deterministically. Nothing is overwritten.' },
  { title: 'Whiteboard', text: 'Sticky notes, shapes and connectors on a canvas you can pan and zoom, with the same live cursors.' },
  { title: 'Version history', text: 'Save a named version, preview it exactly as it was, and restore it when you need it.' },
  { title: 'Sharing and roles', text: 'Invite by link as an editor, commenter or viewer. Remove access at any time.' },
]

const STEPS = [
  { title: 'You keep typing', text: 'Edits are applied on your device and saved to the browser’s storage, so a closed tab or a dead connection loses nothing.' },
  { title: 'You reconnect', text: 'The browser and the server exchange only the changes the other side is missing.' },
  { title: 'Everything merges', text: 'Each edit carries enough information to be applied in any order, so every copy ends up as the same document.' },
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
        <h1 id="hero-title">Documents and whiteboards that keep working offline.</h1>
        <p className="lead">
          Synapse is a real-time collaborative workspace. Edits are merged with CRDTs, so a dropped connection never
          costs anyone their work.
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
        <h2 id="features-title">What is in it</h2>
        <ul className="grid">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="band split" aria-labelledby="offline-title">
        <div>
          <h2 id="offline-title">What happens when you go offline</h2>
          <p className="muted-lead">
            Synapse treats the copy on your device as the real one. The server is how copies find each other.
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
        <h2 id="ready-title">See it for yourself</h2>
        <p>One click gives you a sample document and board. There is nothing to install, and you can create an account later and keep everything.</p>
        <div className="cta-row">
          <Button variant="primary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now'}</Button>
          <Link className={buttonClass({ variant: 'secondary', size: 'lg' })} href="/login">Sign in</Link>
        </div>
      </section>
    </div>
  )
}
