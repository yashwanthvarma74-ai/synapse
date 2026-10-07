import type { Metadata } from 'next'
import WorkspacePage from '@/components/workspace/WorkspacePage'

export const metadata: Metadata = { title: 'Workspace' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkspacePage workspaceId={id} />
}
