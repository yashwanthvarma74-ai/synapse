import type { Metadata } from 'next'
import Dashboard from '@/components/Dashboard'

// the layout's title template does not apply to the page in the SAME segment, so spell it out
export const metadata: Metadata = { title: 'Synapse – write together, even offline' }

export default function Home() {
  return <Dashboard />
}
