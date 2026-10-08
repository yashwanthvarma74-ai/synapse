import Link from 'next/link'
import { NotFoundArt } from '../ui/Illustrations'
import { buttonClass } from '@yashwanthvarma74/react'

// Shown when a page asks for something that is missing or that the person may not open
export default function CantOpen({ message }: { message: string }) {
  return (
    <div className="notice">
      <NotFoundArt />
      <h1>We can&apos;t open this</h1>
      <p className="muted">{message}</p>
      <p className="muted">If someone shared it with you, ask them for a new invite link.</p>
      <Link className={buttonClass({ variant: 'primary', size: 'md' })} href="/">Back to your workspaces</Link>
    </div>
  )
}
