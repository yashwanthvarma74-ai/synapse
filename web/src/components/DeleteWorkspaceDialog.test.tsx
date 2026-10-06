// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { stubDialog } from '@/test/dom'

const apiMock = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a) }))

import DeleteWorkspaceDialog from './DeleteWorkspaceDialog'

const props = { workspaceId: 'w1', name: 'My workspace', items: 2, others: 0, open: true }
beforeEach(() => stubDialog())
afterEach(() => { cleanup(); apiMock.mockReset() })

describe('DeleteWorkspaceDialog', () => {
  it('says exactly what will be lost, and that it cannot be undone', () => {
    render(<DeleteWorkspaceDialog {...props} others={3} items={5} onClose={() => {}} onDeleted={() => {}} />)
    const text = screen.getByRole('dialog', { hidden: true }).textContent!
    expect(text).toContain('5 documents and boards')
    expect(text).toMatch(/version history, comments, chat messages, uploaded files and invite links/)
    expect(text).toContain('3 other people will lose access')
    expect(text).toContain('This cannot be undone')
  })

  it('uses singular wording for one item and one other person, and says nothing about others when alone', () => {
    const { rerender } = render(<DeleteWorkspaceDialog {...props} items={1} others={1} onClose={() => {}} onDeleted={() => {}} />)
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('1 document or board')
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('1 other person will lose access')
    rerender(<DeleteWorkspaceDialog {...props} others={0} onClose={() => {}} onDeleted={() => {}} />)
    expect(screen.getByRole('dialog', { hidden: true }).textContent).not.toContain('lose access')
  })

  it('keeps Delete off until the name is typed (any capitalisation, extra spaces ignored)', () => {
    render(<DeleteWorkspaceDialog {...props} onClose={() => {}} onDeleted={() => {}} />)
    const del = screen.getByRole('button', { name: 'Delete workspace', hidden: true }) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    const box = screen.getByLabelText(/Type .* to confirm/)
    fireEvent.change(box, { target: { value: 'My work' } })
    expect(del.disabled).toBe(true)
    fireEvent.change(box, { target: { value: '  my WORKSPACE ' } })
    expect(del.disabled).toBe(false)
  })

  it('deletes through the API and tells the page, only after the name matches', async () => {
    apiMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    render(<DeleteWorkspaceDialog {...props} onClose={() => {}} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace', hidden: true })) // disabled: nothing happens
    expect(apiMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Type .* to confirm/), { target: { value: 'My workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace', hidden: true }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(apiMock).toHaveBeenCalledWith('/workspaces/w1', { method: 'DELETE' })
  })

  it('can confirm with Enter in the box', async () => {
    apiMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    render(<DeleteWorkspaceDialog {...props} onClose={() => {}} onDeleted={onDeleted} />)
    const box = screen.getByLabelText(/Type .* to confirm/)
    fireEvent.change(box, { target: { value: 'my workspace' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('shows the server\'s message when it fails, and does not claim success', async () => {
    apiMock.mockRejectedValue(new Error('Requires owner access'))
    const onDeleted = vi.fn()
    render(<DeleteWorkspaceDialog {...props} onClose={() => {}} onDeleted={onDeleted} />)
    fireEvent.change(screen.getByLabelText(/Type .* to confirm/), { target: { value: 'My workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace', hidden: true }))
    expect((await screen.findByRole('alert')).textContent).toBe('Requires owner access')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('Cancel closes without calling the API, and forgets what was typed', () => {
    const onClose = vi.fn()
    render(<DeleteWorkspaceDialog {...props} onClose={onClose} onDeleted={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Type .* to confirm/), { target: { value: 'My workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }))
    expect(onClose).toHaveBeenCalled()
    expect(apiMock).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/Type .* to confirm/) as HTMLInputElement).value).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<DeleteWorkspaceDialog {...props} onClose={() => {}} onDeleted={() => {}} />)
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 80)}`)).toEqual([])
  })
})
