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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/write together/i)
    expect(screen.getByText(/nothing is lost/i)).toBeTruthy()
    // the three ideas, in order
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(8)
    for (const t of ['Write together', 'Keep going offline', 'Everything merges']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  })

  it('one click creates a guest and opens the Welcome document', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'w1', welcomeId: 'welcome1', boardId: 'b1' })
    render(<Landing />)
    fireEvent.click(screen.getAllByRole('button', { name: /try it now/i })[0])
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/w1'))
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
