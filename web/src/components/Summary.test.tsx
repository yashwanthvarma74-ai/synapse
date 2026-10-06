// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery as render } from '@/test/wrap'
import axe from 'axe-core'

const apiMock = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a) }))

import Summary from './Summary'

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('Summary', () => {
  it('asks the server for a summary and shows it as plain text, labelled as AI-written', async () => {
    apiMock.mockResolvedValue({ summary: '- First idea\n- <b>not bold</b>' })
    const { container } = render(<Summary docId="d1" type="canvas" />)
    expect(screen.getByText(/sent to an AI service/)).toBeTruthy() // told up front
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this board' }))
    const text = await screen.findByText(/First idea/)
    expect(apiMock).toHaveBeenCalledWith('/documents/d1/summarize', { method: 'POST', body: {} })
    expect(text.textContent).toContain('<b>not bold</b>') // shown literally, not interpreted
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText(/Written by AI/)).toBeTruthy()
  })
  it('says document or board to match what it is', () => {
    render(<Summary docId="d1" type="doc" />)
    expect(screen.getByRole('button', { name: 'Summarize this document' })).toBeTruthy()
  })
  it('shows the server\'s message when it cannot summarize, and clears an old summary', async () => {
    apiMock.mockResolvedValueOnce({ summary: '- old' }).mockRejectedValueOnce(new Error('You can ask for 10 summaries an hour. Try again later.'))
    render(<Summary docId="d1" type="doc" />)
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this document' }))
    await screen.findByText(/old/)
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this document' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/10 summaries an hour/)
    expect(screen.queryByText(/old/)).toBeNull()
  })
  it('disables the button while working', async () => {
    let done!: (v: { summary: string }) => void
    apiMock.mockReturnValue(new Promise((r) => (done = r)))
    render(<Summary docId="d1" type="doc" />)
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this document' }))
    const busy = await screen.findByRole('button', { name: /Writing a summary/ })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    done({ summary: '- ok' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Summarize this document' })).toBeTruthy())
  })
  it('has no accessibility violations', async () => {
    const { container } = render(<Summary docId="d1" type="doc" />)
    const r = await axe.run(container)
    expect(r.violations).toEqual([])
  })
})
