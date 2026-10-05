import type { Metadata } from 'next'
import { Suspense } from 'react'
import Workspace from '@/components/Workspace'

export const metadata: Metadata = { title: 'Document' }

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <Workspace docId={id} />
    </Suspense>
  )
}
