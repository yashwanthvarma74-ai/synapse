// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Tabs from './Tabs'
import { violationsIn } from '@/test/axe'

afterEach(cleanup)

const three = [
  { id: 'a', label: 'Comments', content: <p>comments here</p> },
  { id: 'b', label: 'History', content: <p>history here</p> },
  { id: 'c', label: 'Other', content: <p>other here</p> },
]

describe('Tabs (WAI-ARIA tabs pattern)', () => {
  it('has no axe violations', async () => {
    const { container } = render(<Tabs label="Document tools" tabs={three} />)
    expect(await violationsIn(container)).toEqual([])
  })

  it('puts only the selected tab in the Tab order and wires each tab to its panel', () => {
    render(<Tabs label="Document tools" tabs={three} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    for (const t of tabs) {
      const panel = document.getElementById(t.getAttribute('aria-controls')!)
      expect(panel?.getAttribute('role')).toBe('tabpanel')
      expect(panel?.getAttribute('aria-labelledby')).toBe(t.id)
    }
    expect(screen.getByText('comments here')).toBeTruthy()
    expect(screen.queryByText('history here')).toBeNull() // only the active panel is shown
  })

  it('arrow keys move between tabs, wrap around, and move focus with them', () => {
    render(<Tabs label="Document tools" tabs={three} />)
    const [a, b, c] = screen.getAllByRole('tab')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(b)
    expect(b.getAttribute('aria-selected')).toBe('true')
    expect(b.tabIndex).toBe(0)
    expect(a.tabIndex).toBe(-1)
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    fireEvent.keyDown(c, { key: 'ArrowRight' }) // wraps to the first
    expect(document.activeElement).toBe(a)
    fireEvent.keyDown(a, { key: 'ArrowLeft' }) // wraps to the last
    expect(document.activeElement).toBe(c)
  })

  it('Home and End jump to the first and last tab', () => {
    render(<Tabs label="Document tools" tabs={three} />)
    const [a, , c] = screen.getAllByRole('tab')
    a.focus()
    fireEvent.keyDown(a, { key: 'End' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'Home' })
    expect(document.activeElement).toBe(a)
  })

  it('ignores other keys so typing and Tab keep working', () => {
    render(<Tabs label="Document tools" tabs={three} />)
    const [a, b] = screen.getAllByRole('tab')
    a.focus()
    const notPrevented = fireEvent.keyDown(a, { key: 'Tab' })
    expect(notPrevented).toBe(true)
    expect(b.getAttribute('aria-selected')).toBe('false')
  })
})
