// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import Presence from './Presence'
import type { Collab } from '@/lib/useCollab'
import { violationsIn } from '@/test/axe'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  awareness.setLocalState({ user: { name: 'Ravi', color: '#c2255c' } })
  const view = render(<Presence collab={{ awareness } as unknown as Collab} />)
  // another person appears (a remote awareness state)
  const join = (id: number, name: string) =>
    act(() => {
      awareness.states.set(id, { user: { name, color: '#1971c2' } })
      awareness.emit('change', [{ added: [id], updated: [], removed: [] }, 'remote'])
    })
  const leave = (id: number) =>
    act(() => {
      awareness.states.delete(id)
      awareness.emit('change', [{ added: [], updated: [], removed: [id] }, 'remote'])
    })
  return { ...view, join, leave }
}

describe('Presence', () => {
  it('has no axe violations', async () => {
    vi.useRealTimers()
    const { container } = setup()
    expect(await violationsIn(container)).toEqual([])
  })

  it('gives screen readers real names and hides the decorative initials', () => {
    const { container, join } = setup()
    join(2, 'Sai')
    const list = screen.getByRole('list', { name: 'People in this document' })
    expect(list.textContent).toContain('Ravi')
    expect(list.textContent).toContain('Sai')
    const initials = container.querySelectorAll('.avatar')
    expect(initials.length).toBe(2)
    for (const el of initials) expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('announces joins and leaves politely, but not the people already here on arrival', () => {
    const { join, leave } = setup()
    const status = screen.getByRole('status')
    join(2, 'Sai') // arrives during the first 2 seconds: part of the initial burst
    expect(status.textContent).toBe('')
    act(() => void vi.advanceTimersByTime(2100))
    join(3, 'Mira')
    expect(status.textContent).toBe('Mira joined')
    leave(3)
    expect(status.textContent).toBe('Mira left')
  })

  it('never takes focus when people join', () => {
    const { join } = setup()
    const before = document.activeElement
    act(() => void vi.advanceTimersByTime(2100))
    join(4, 'Someone')
    expect(document.activeElement).toBe(before)
  })
})
