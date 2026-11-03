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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/local first, real time collaborative workspace/i)
    expect(screen.getByText(/converge without conflicts/i)).toBeTruthy()
    for (const t of ['What sets it apart', 'And everything around it', 'How offline editing merges', 'Try it']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  })

  it('lists what sets it apart and walks through the offline merge in order', () => {
    render(<Landing />)
    for (const t of ['Local first', 'Convergent by construction', 'Low latency fan out', 'Two consistency domains', 'Stateless gateways', 'Measured and observable']) {
      expect(screen.getByRole('heading', { name: t })).toBeTruthy()
    }
    for (const t of ['Apply locally', 'Sync state vectors', 'Merge deterministically']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  })

  it('backs each point with a key figure, and keeps the diagrams out of the accessibility tree', () => {
    const { container } = render(<Landing />)
    const figures = [...container.querySelectorAll('.stat-value')].map((e) => e.textContent)
    for (const t of ['16.6 ms', '10,000 / 10,000', '0.82 ms', '200 editors']) expect(figures).toContain(t)
    const diagrams = container.querySelectorAll('svg.diagram')
    expect(diagrams.length).toBe(6)
    for (const d of diagrams) expect(d.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws the offline timeline for sighted readers and describes it in words', () => {
    const { container } = render(<Landing />)
    expect(container.querySelector('.tl-grid')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(/44 to 58 ms and every copy matched/)).toBeTruthy()
    for (const t of ['Comments', 'Version history', 'Whiteboard', 'Search', 'Sharing and roles', 'Export']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
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
