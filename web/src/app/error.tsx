'use client'
import { NotFoundArt } from '@/components/ui/Illustrations'
import { Button } from '@yashwanthvarma74/react'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="notice" role="alert">
      <NotFoundArt />
      <h1>Something went wrong</h1>
      <p className="muted">This page hit a problem. Your documents are safe. Try again, and if it keeps happening, reload the page.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  )
}
