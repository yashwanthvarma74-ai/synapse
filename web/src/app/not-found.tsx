import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonClass } from '@yashwanthvarma74/react'

export const metadata: Metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <div className="notice">
      <h1>Page not found</h1>
      <p className="muted">The link may be old, or the page may have moved.</p>
      <Link className={buttonClass({ variant: 'primary' })} href="/">Back to Synapse</Link>
    </div>
  )
}
