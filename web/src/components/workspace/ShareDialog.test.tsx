// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery as render } from '@/test/wrap'
import { stubDialog } from '@/test/dom'

const apiMock = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a) }))

import ShareDialog from './ShareDialog'

const calls = () => apiMock.mock.calls.map((c) => `${(c[1] as { method?: string } | undefined)?.method ?? (c[1] ? 'POST' : 'GET')} ${c[0]}`)

beforeEach(() => {
  stubDialog()
  apiMock.mockImplementation((path: string, init?: { method?: string; body?: { role: string } }) => {
    if (path.endsWith('/invites') && init?.body) return Promise.resolve({ code: 'CODE123456789012345678', role: init.body.role })
    if (path.endsWith('/invites')) return Promise.resolve([{ code: 'OLD', role: 'viewer', expiresAt: '2030-01-01', uses: 2 }])
    return Promise.resolve(undefined)
  })
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  cleanup()
  apiMock.mockReset()
})

describe('ShareDialog', () => {
  it('opens as a dialog with plain-language choices, defaulting to editor', async () => {
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeTruthy()
    expect((screen.getByLabelText(/can edit/i) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText(/can comment/i)).toBeTruthy()
    expect(screen.getByLabelText(/can only view/i)).toBeTruthy()
  })

  it('creates a link for the chosen role and shows it', async () => {
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText(/can comment/i))
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
    const input = (await screen.findByLabelText('Your link')) as HTMLInputElement
    expect(input.value).toMatch(/\/join\/CODE123456789012345678$/)
    const createCall = apiMock.mock.calls.find((c) => (c[1] as { body?: unknown })?.body)
    expect((createCall![1] as { body: { role: string } }).body.role).toBe('commenter')
  })

  it('copies the link and says so', async () => {
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
    await screen.findByLabelText('Your link')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/copied/i))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/join/CODE123456789012345678'))
  })

  it('tells the person to copy by hand if the browser refuses clipboard access', async () => {
    ;(navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'))
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
    await screen.findByLabelText('Your link')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/ctrl\+c/i))
  })

  it('lists active links and can stop one from working', async () => {
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    fireEvent.click(await screen.findByText(/active links/i))
    fireEvent.click(await screen.findByRole('button', { name: /stop the viewer link/i }))
    await waitFor(() => expect(calls()).toContain('DELETE /workspaces/w1/invites/OLD'))
  })

  it('warns that anyone with the link can join, and that it expires', async () => {
    render(<ShareDialog workspaceId="w1" open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
    expect(await screen.findByText(/anyone with this link can join/i)).toBeTruthy()
    expect(screen.getByText(/7 days/)).toBeTruthy()
  })
})
