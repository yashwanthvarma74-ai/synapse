// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), usePathname: () => '/join/abc' }))
const apiMock = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), tokenStore: { get: () => null, set: vi.fn(), clear: vi.fn() } }))
const startGuest = vi.fn()
vi.mock('@/lib/guest', () => ({ startGuest: () => startGuest() }))
let session: { user: { name: string } | null; ready: boolean } = { user: null, ready: true }
vi.mock('@/lib/useSession', () => ({ useSession: () => session }))

import JoinInvite from './JoinInvite'
import { violationsIn } from '@/test/axe'

const INFO = { workspaceName: 'Team Alpha', inviterName: 'Ravi', role: 'editor' }
beforeEach(() => {
  session = { user: null, ready: true }
  apiMock.mockImplementation((path: string) => {
    if (path.endsWith('/accept')) return Promise.resolve({ workspaceId: 'w1', documentId: 'd1' })
    return Promise.resolve(INFO)
  })
})
afterEach(() => {
  cleanup()
  replace.mockReset(); apiMock.mockReset(); startGuest.mockReset()
})

describe('JoinInvite', () => {
  it('says who invited you to what, and what you will be able to do', async () => {
    render(<JoinInvite code="abc" />)
    expect(await screen.findByRole('heading', { name: 'Ravi invited you' })).toBeTruthy()
    expect(screen.getByText('Team Alpha')).toBeTruthy()
    expect(screen.getByText(/edit documents and boards/)).toBeTruthy()
  })

  it('has no axe violations', async () => {
    const { container } = render(<JoinInvite code="abc" />)
    await screen.findByRole('heading', { name: 'Ravi invited you' })
    expect(await violationsIn(container)).toEqual([])
  })

  it('a signed-in person joins with one click and lands in the document', async () => {
    session = { user: { name: 'Sai' }, ready: true }
    render(<JoinInvite code="abc" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Join as Sai' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doc/d1'))
  })

  it('a visitor with no account can join as a guest, in one click', async () => {
    startGuest.mockResolvedValue({})
    render(<JoinInvite code="abc" />)
    fireEvent.click(await screen.findByRole('button', { name: /join now/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doc/d1'))
    expect(startGuest).toHaveBeenCalled()
    // and the accept request really was sent
    expect(apiMock.mock.calls.some((c) => String(c[0]).endsWith('/accept'))).toBe(true)
  })

  it('a person with an account is sent to sign in, then brought back to this invite', async () => {
    render(<JoinInvite code="abc" />)
    const link = await screen.findByRole('link', { name: /already have an account/i })
    expect(decodeURIComponent(link.getAttribute('href')!)).toBe('/login?next=/join/abc')
  })

  it('explains an expired or revoked link instead of showing a blank page', async () => {
    apiMock.mockRejectedValue(new Error('This invite link is not valid any more. Ask for a new one.'))
    render(<JoinInvite code="dead" />)
    expect(await screen.findByRole('heading', { name: /doesn.t work/i })).toBeTruthy()
    expect(screen.getByText(/ask for a new one/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /go to synapse/i })).toBeTruthy()
  })
})
