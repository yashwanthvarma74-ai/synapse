import type { Metadata } from 'next'
import UpgradeForm from '@/components/UpgradeForm'

export const metadata: Metadata = { title: 'Save your work' }

export default function UpgradePage() {
  return <UpgradeForm />
}
