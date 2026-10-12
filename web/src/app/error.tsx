'use client'
import { Button } from '@yashwanthvarma74/react'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="notice" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">Try again. If it keeps happening, reload the page.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  )
}
