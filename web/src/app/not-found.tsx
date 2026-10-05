import type { Metadata } from 'next'
import Link from 'next/link'
import { NotFoundArt } from '@/components/ui/Illustrations'

export const metadata: Metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <div className="notice">
      <NotFoundArt />
      <h1>We can&apos;t find that page</h1>
      <p className="muted">The link may be old, or the page may have moved. Nothing is wrong with your work.</p>
      <Link className="btn" href="/">Back to Synapse</Link>
    </div>
  )
}
