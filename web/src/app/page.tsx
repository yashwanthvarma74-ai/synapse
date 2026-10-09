import type { Metadata } from 'next'
import Dashboard from '@/components/home/Dashboard'

// the layout's title template does not apply to the page in the same segment, so spell it out
export const metadata: Metadata = { title: 'Synapse – local-first, real-time collaborative workspace' }

export default function Home() {
  return <Dashboard />
}
