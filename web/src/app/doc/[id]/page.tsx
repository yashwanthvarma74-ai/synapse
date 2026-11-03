import type { Metadata } from 'next'
import { Suspense } from 'react'
import DocumentPage from '@/components/document/DocumentPage'

export const metadata: Metadata = { title: 'Document' }

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <DocumentPage docId={id} />
    </Suspense>
  )
}
