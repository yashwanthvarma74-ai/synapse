'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { startGuest } from '@/lib/guest'
import { BoardIcon, CheckIcon, CommentIcon, DocumentIcon, HistoryIcon, LinkIcon, SearchIcon } from '../ui/Icons'
import { HeroArt, MergeArt, OfflineArt, WriteTogetherArt } from '../ui/Illustrations'
import { Button, Card, buttonClass } from '@yashwanthvarma74/react'

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
      router.push(`/doc/${s.welcomeId}`)
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
          <h1 id="hero-title">Write together, <span className="grad">even when the internet doesn&apos;t.</span></h1>
          <p className="lead">
            Synapse is a shared notebook and whiteboard. Everyone edits at the same time and you see each other&apos;s
            cursors. If your connection drops, nothing is lost: it all merges when you&apos;re back.
          </p>
          <div className="cta-row">
            <Button variant="primary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now, no sign-up'}</Button>
            <Link className={buttonClass({ variant: 'secondary', size: 'lg' })} href="/login">Sign in</Link>
          </div>
          <p className="cta-note">One click. You&apos;ll get a sample document and board to play with. You can create an account later and keep everything.</p>
          {error && <p role="alert" className="error">{error}</p>}
          <ul className="proof" aria-label="Why people use it">
            <li><CheckIcon size={16} />Free and open source</li>
            <li><CheckIcon size={16} />No account needed</li>
            <li><CheckIcon size={16} />Works without internet</li>
          </ul>
        </div>
        <div className="hero-visual">
          <HeroArt className="hero-art" />
        </div>
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="section-title">How it works</h2>
        <p className="section-sub">Three ideas, and you already know how to use all of them.</p>
        <ol className="steps">
          <li className="step"><Card padding="none">
            <div className="step-art"><WriteTogetherArt /></div>
            <h3>Write together</h3>
            <p>Open a page with a friend. You each get a coloured cursor with your name, and changes show up as they happen.</p>
          </Card></li>
          <li className="step"><Card padding="none">
            <div className="step-art"><OfflineArt /></div>
            <h3>Keep going offline</h3>
            <p>Lost your signal on a train? Keep typing. Your work is saved on your own device, not just on a server.</p>
          </Card></li>
          <li className="step"><Card padding="none">
            <div className="step-art"><MergeArt /></div>
            <h3>Everything merges</h3>
            <p>When you reconnect, everyone&apos;s changes combine automatically. No conflicts to sort out, nothing overwritten.</p>
          </Card></li>
        </ol>
      </section>

      <section aria-labelledby="more-title">
        <h2 id="more-title" className="section-title">Everything you need to work as a team</h2>
        <p className="section-sub">Not a demo: a complete little workspace.</p>
        <ul className="features">
          <li><span className="feature-icon"><DocumentIcon size={22} /></span><strong>Documents</strong><span>Headings, lists, quotes and code, with a toolbar and keyboard shortcuts.</span></li>
          <li><span className="feature-icon"><BoardIcon size={22} /></span><strong>Whiteboard</strong><span>Sticky notes, shapes and connectors on a canvas you can pan and zoom.</span></li>
          <li><span className="feature-icon"><CommentIcon size={22} /></span><strong>Comments</strong><span>Attach a comment to a sentence. It stays with that sentence as the text changes.</span></li>
          <li><span className="feature-icon"><HistoryIcon size={22} /></span><strong>Version history</strong><span>Save a named version, preview it, and bring it back whenever you like.</span></li>
          <li><span className="feature-icon"><LinkIcon size={22} /></span><strong>Share with a link</strong><span>Invite people as editors, commenters or viewers. Remove access at any time.</span></li>
          <li><span className="feature-icon"><SearchIcon size={22} /></span><strong>Search</strong><span>Find any document in your workspaces, including text on the whiteboard.</span></li>
        </ul>
      </section>

      <section className="cta-card" aria-labelledby="ready-title">
        <h2 id="ready-title">Ready to try it?</h2>
        <p>It takes one click, and there is nothing to install. Guest work is kept for a month, and you can save it any time.</p>
        <Button variant="secondary" size="lg" onClick={tryIt} disabled={busy}>{busy ? 'Setting things up…' : 'Try it now, no sign-up'}</Button>
      </section>
    </div>
  )
}
