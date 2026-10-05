// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import NetworkSimulator from './NetworkSimulator'
import type { SynapseProvider } from '@/lib/provider'
import { violationsIn } from '@/test/axe'

afterEach(cleanup)

const fakeProvider = () => {
  let partitioned = false
  return {
    isPartitioned: () => partitioned,
    getLatency: () => 0,
    setPartitioned: vi.fn((on: boolean) => { partitioned = on }),
    setLatency: vi.fn(),
  } as unknown as SynapseProvider
}

describe('NetworkSimulator', () => {
  it('has no axe violations', async () => {
    const { container } = render(<NetworkSimulator provider={fakeProvider()} />)
    expect(await violationsIn(container)).toEqual([])
  })

  it('is a toggle: the name stays the same and aria-pressed carries the state', () => {
    const provider = fakeProvider()
    render(<NetworkSimulator provider={provider} />)
    const toggle = screen.getByRole('button', { name: 'Simulate offline' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    // the same accessible name, now pressed (a changing label + aria-pressed reads as "Go online, pressed")
    const after = screen.getByRole('button', { name: 'Simulate offline' })
    expect(after.getAttribute('aria-pressed')).toBe('true')
    expect(provider.setPartitioned).toHaveBeenCalledWith(true)
  })

  it('also shows the state in text, not only through colour', () => {
    render(<NetworkSimulator provider={fakeProvider()} />)
    const toggle = screen.getByRole('button', { name: 'Simulate offline' })
    expect(toggle.textContent).not.toContain('(on)')
    fireEvent.click(toggle)
    expect(toggle.textContent).toContain('(on)')
  })

  it('groups its controls with a label', () => {
    render(<NetworkSimulator provider={fakeProvider()} />)
    expect(screen.getByRole('group', { name: 'Network simulator' })).toBeTruthy()
    expect(screen.getByLabelText(/delay/i)).toBeTruthy()
  })
})
