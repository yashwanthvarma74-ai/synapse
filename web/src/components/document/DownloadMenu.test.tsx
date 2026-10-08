// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'

const exportDocument = vi.fn()
const exportBoard = vi.fn()
const saveFile = vi.fn()
const pdfProblems = vi.fn(() => [] as string[])
const { NothingToExport } = vi.hoisted(() => ({ NothingToExport: class extends Error {} }))
vi.mock('@/lib/export/index', () => ({
  exportDocument: (...a: unknown[]) => exportDocument(...a),
  exportBoard: (...a: unknown[]) => exportBoard(...a),
  saveFile: (...a: unknown[]) => saveFile(...a),
  pdfProblems: () => pdfProblems(),
  NothingToExport,
}))

import DownloadMenu from './DownloadMenu'

const content = { type: 'doc', content: [] }
beforeEach(() => {
  exportDocument.mockResolvedValue({ blob: new Blob(['x']), filename: 'Plan.pdf' })
  exportBoard.mockResolvedValue({ blob: new Blob(['x']), filename: 'Board.png' })
  pdfProblems.mockReturnValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const user = () => userEvent.setup()
const openMenu = (u: ReturnType<typeof user>) => u.click(screen.getByRole('button', { name: /Download/ }))
const choice = (name: RegExp) => screen.getByRole('menuitem', { name })

// Opening, closing, arrow keys, Escape and focus return belong to the design system's Menu and are tested there.
// These tests cover what Synapse adds: which files are offered, what gets exported, and how failures read.
describe('DownloadMenu', () => {
  it('stays closed until asked, and offers PDF, Word, text and Markdown for a document', async () => {
    const u = user()
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    expect(screen.queryByRole('menu')).toBeNull()
    await openMenu(u)
    const names = screen.getAllByRole('menuitem').map((b) => b.textContent)
    expect(names).toEqual(['PDF document.pdf', 'Word document.docx', 'Plain text.txt', 'Markdown.md'])
  })

  it('offers PNG and SVG for a whiteboard', async () => {
    const u = user()
    render(<DownloadMenu title="Board" kind="canvas" getObjects={() => []} />)
    await openMenu(u)
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['PNG image.png', 'SVG image.svg'])
  })

  it('exports what is on the page at the moment of the click, saves the file and closes', async () => {
    const u = user()
    let current = { type: 'doc', content: [{ type: 'paragraph' }] }
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => current} />)
    await openMenu(u)
    current = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] } // edited while the menu was open
    await u.click(choice(/Word document/))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'Plan.pdf' }))
    expect(exportDocument).toHaveBeenCalledWith('docx', current, 'Plan')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('status').textContent).toBe('Plan.pdf downloaded.')
  })

  it('exports a board from its shapes', async () => {
    const u = user()
    const shapes = [{ id: 'a' }]
    render(<DownloadMenu title="Board" kind="canvas" getObjects={() => shapes as never} />)
    await openMenu(u)
    await u.click(choice(/PNG image/))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    expect(exportBoard).toHaveBeenCalledWith('png', shapes, 'Board')
  })

  it('says plainly when there is nothing to download', async () => {
    const u = user()
    exportDocument.mockRejectedValue(new NothingToExport('This document is empty, so there is nothing to download yet.'))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    await openMenu(u)
    await u.click(choice(/Plain text/))
    expect((await screen.findByRole('alert')).textContent).toBe('This document is empty, so there is nothing to download yet.')
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('gives a generic message for any other failure', async () => {
    const u = user()
    exportDocument.mockRejectedValue(new Error('boom: internal detail'))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    await openMenu(u)
    await u.click(choice(/PDF/))
    expect((await screen.findByRole('alert')).textContent).toBe("The file couldn't be created. Please try again.")
  })

  it('shows "Preparing…" and blocks a second click while a file is being made', async () => {
    const u = user()
    let finish!: (v: unknown) => void
    exportDocument.mockReturnValue(new Promise((r) => (finish = r)))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    await openMenu(u)
    await u.click(choice(/PDF/))
    await openMenu(u) // the menu closes on choosing, so open it again
    expect(await screen.findByText('Preparing…')).toBeTruthy()
    expect(choice(/Markdown/).getAttribute('aria-disabled')).toBe('true')
    finish({ blob: new Blob(['x']), filename: 'a.pdf' })
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
  })

  it('warns, when the menu opens, about characters the PDF font cannot show', async () => {
    const u = user()
    pdfProblems.mockReturnValue(['న', 'మ'])
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    await openMenu(u)
    expect(screen.getByText(/PDF can.t show some characters here \(న మ\)/)).toBeTruthy()
  })

  it('has no accessibility violations, open or closed', async () => {
    const u = user()
    const { container } = render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    expect((await axe.run(container)).violations).toEqual([])
    await openMenu(u)
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })
})
