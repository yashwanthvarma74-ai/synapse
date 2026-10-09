// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const startGuest = vi.fn()
vi.mock('@/lib/guest', () => ({ startGuest: () => startGuest() }))

import Landing from './Landing'
import { violationsIn } from '@/test/axe'

afterEach(() => {
  cleanup()
  push.mockReset()
  startGuest.mockReset()
})

describe('Landing page', () => {
  it('has no axe violations', async () => {
    const { container } = render(<Landing />)
    expect(await violationsIn(container)).toEqual([])
  })

  it('says what Synapse is, in plain words, with one clear heading', () => {
    render(<Landing />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/keep working offline/i)
    expect(screen.getByText(/never costs anyone their work/i)).toBeTruthy()
    for (const t of ['What is in it', 'What happens when you go offline', 'See it for yourself']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  })

  it('lists what it does and walks through the offline story in order', () => {
    render(<Landing />)
    for (const t of ['Real-time editing', 'Offline by default', 'Conflict-free merging', 'Whiteboard', 'Version history', 'Sharing and roles']) {
      expect(screen.getByRole('heading', { name: t })).toBeTruthy()
    }
    for (const t of ['You keep typing', 'You reconnect', 'Everything merges']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  })

  it('shows the product, with a description for screen readers', () => {
    render(<Landing />)
    expect(screen.getByRole('img', { name: /Synapse document open in two windows/ })).toBeTruthy()
  })

  it('one click creates a guest and opens the Welcome document', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'w1', welcomeId: 'welcome1', boardId: 'b1' })
    render(<Landing />)
    fireEvent.click(screen.getAllByRole('button', { name: /try it now/i })[0])
    await waitFor(() => expect(push).toHaveBeenCalledWith('/doc/welcome1'))
  })

  it('shows a helpful message, and lets the person try again, if it fails', async () => {
    startGuest.mockRejectedValueOnce(new Error('Could not reach the server'))
    render(<Landing />)
    const button = screen.getAllByRole('button', { name: /try it now/i })[0]
    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server')
    expect((button as HTMLButtonElement).disabled).toBe(false) // can click again
    expect(push).not.toHaveBeenCalled()
  })

  it('also offers sign in', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })
})
