'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { startGuest } from '@/lib/guest'
import { EmptyDocsArt, HeroArt, MergeArt, OfflineArt, WriteTogetherArt } from './ui/Illustrations'

// What a first-time visitor sees: what this is, why it is different, and one big button.
export default function Landing() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function tryIt() {
    setBusy(true)
    setError('')
    try {
      const s = await startGuest()
      router.push(`/w/${s.workspaceId}`) // your workspace, with the Welcome document and a sample board to choose from
    } catch (e) {
      setError((e as Error).message || 'Could not start. Is the server running?')
      setBusy(false)
    }
  }

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <span className="eyebrow">Open source · works offline</span>
          <h1 id="hero-title">Write together, even when the internet doesn&apos;t.</h1>
          <p className="lead">
            Synapse is a shared notebook and whiteboard. Everyone edits at the same time and you see each other&apos;s
            cursors. If your connection drops, nothing is lost: it all merges when you&apos;re back.
          </p>
          <div className="cta-row">
            <button className="btn large" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now, no sign-up'}</button>
            <Link className="btn secondary large" href="/login">Sign in</Link>
          </div>
          <p className="cta-note">One click. You&apos;ll get a sample document and board to play with. You can create an account later and keep everything.</p>
          {error && <p role="alert" className="error">{error}</p>}
        </div>
        <HeroArt className="hero-art" />
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="section-title">How it works</h2>
        <p className="section-sub">Three ideas, and you already know how to use all of them.</p>
        <ol className="steps">
          <li className="step card">
            <div className="step-art"><WriteTogetherArt /></div>
            <h3>Write together</h3>
            <p>Open a page with a friend. You each get a coloured cursor with your name, and changes show up as they happen.</p>
          </li>
          <li className="step card">
            <div className="step-art"><OfflineArt /></div>
            <h3>Keep going offline</h3>
            <p>Lost your signal on a train? Keep typing. Your work is saved on your own device, not just on a server.</p>
          </li>
          <li className="step card">
            <div className="step-art"><MergeArt /></div>
            <h3>Everything merges</h3>
            <p>When you reconnect, everyone&apos;s changes combine automatically. No conflicts to sort out, nothing overwritten.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="more-title">
        <h2 id="more-title" className="section-title">Everything you need to work as a team</h2>
        <p className="section-sub">Not a demo: a complete little workspace.</p>
        <ul className="features">
          <li><strong>Documents</strong><span>Headings, lists, quotes and code, with a toolbar and keyboard shortcuts.</span></li>
          <li><strong>Whiteboard</strong><span>Sticky notes, shapes and connectors on a canvas you can pan and zoom.</span></li>
          <li><strong>Comments</strong><span>Attach a comment to a sentence. It stays with that sentence as the text changes.</span></li>
          <li><strong>Version history</strong><span>Save a named version, preview it, and bring it back whenever you like.</span></li>
          <li><strong>Share with a link</strong><span>Invite people as editors, commenters or viewers. Remove access at any time.</span></li>
          <li><strong>Search</strong><span>Find any document in your workspaces, including text on the whiteboard.</span></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: 40, textAlign: 'center' }} aria-labelledby="ready-title">
        <div style={{ width: 120, margin: '0 auto' }}><EmptyDocsArt /></div>
        <h2 id="ready-title" style={{ marginTop: 0 }}>Ready to try it?</h2>
        <p className="muted">It takes one click, and there is nothing to install.</p>
        <button className="btn large" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now, no sign-up'}</button>
      </section>

      <footer className="site-footer">
        <span>Synapse is open source. Built with Yjs, Next.js, MongoDB and Redis.</span>
        <span>Guest accounts are temporary: create an account whenever you want to keep your work.</span>
      </footer>
    </div>
  )
}
