import type { Metadata } from 'next'
import JoinInvite from '@/components/JoinInvite'

export const metadata: Metadata = { title: 'You are invited' }

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <JoinInvite code={code} />
}
