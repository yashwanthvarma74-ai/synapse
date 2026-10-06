import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { makeQueryClient } from '@/lib/queries'

// Render a component that fetches with TanStack Query, with a fresh cache per test and no retries
export function renderWithQuery(ui: ReactElement) {
  const client = makeQueryClient()
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
