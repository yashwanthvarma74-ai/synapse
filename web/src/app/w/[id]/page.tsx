import type { Metadata } from 'next'
import WorkspaceView from '@/components/WorkspaceView'

export const metadata: Metadata = { title: 'Workspace' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkspaceView workspaceId={id} />
}
