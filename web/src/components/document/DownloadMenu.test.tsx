// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Download/ }))

describe('DownloadMenu', () => {
  it('stays closed until asked, and offers PDF, Word, text and Markdown for a document', () => {
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    expect(screen.queryByRole('group')).toBeNull()
    openMenu()
    expect(screen.getByRole('button', { name: /Download/ }).getAttribute('aria-expanded')).toBe('true')
    const names = screen.getAllByRole('button').slice(1).map((b) => b.textContent)
    expect(names).toEqual(['PDF document.pdf', 'Word document.docx', 'Plain text.txt', 'Markdown.md'])
  })

  it('offers PNG and SVG for a whiteboard', () => {
    render(<DownloadMenu title="Board" kind="canvas" getObjects={() => []} />)
    openMenu()
    expect(screen.getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['PNG image.png', 'SVG image.svg'])
  })

  it('exports what is on the page at the moment of the click, saves the file and closes', async () => {
    let current = { type: 'doc', content: [{ type: 'paragraph' }] }
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => current} />)
    openMenu()
    current = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] } // edited while the menu was open
    fireEvent.click(screen.getByRole('button', { name: /Word document/ }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'Plan.pdf' }))
    expect(exportDocument).toHaveBeenCalledWith('docx', current, 'Plan')
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Plan.pdf downloaded.')
  })

  it('exports a board from its shapes', async () => {
    const shapes = [{ id: 'a' }]
    render(<DownloadMenu title="Board" kind="canvas" getObjects={() => shapes as never} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /PNG image/ }))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    expect(exportBoard).toHaveBeenCalledWith('png', shapes, 'Board')
  })

  it('says plainly when there is nothing to download, and keeps the menu open', async () => {
    exportDocument.mockRejectedValue(new NothingToExport('This document is empty, so there is nothing to download yet.'))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Plain text/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('This document is empty, so there is nothing to download yet.')
    expect(saveFile).not.toHaveBeenCalled()
    expect(screen.getByRole('group')).toBeTruthy()
  })

  it('gives a generic message for any other failure', async () => {
    exportDocument.mockRejectedValue(new Error('boom: internal detail'))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /PDF/ }))
    expect((await screen.findByRole('alert')).textContent).toBe("The file couldn't be created. Please try again.")
  })

  it('shows "Preparing…" and blocks a second click while a file is being made', async () => {
    let finish!: (v: unknown) => void
    exportDocument.mockReturnValue(new Promise((r) => (finish = r)))
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /PDF/ }))
    expect(await screen.findByText('Preparing…')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Markdown/ }) as HTMLButtonElement).disabled).toBe(true)
    finish({ blob: new Blob(['x']), filename: 'a.pdf' })
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
  })

  it('warns, before exporting, about characters the PDF font cannot show', () => {
    pdfProblems.mockReturnValue(['న', 'మ'])
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    openMenu()
    expect(screen.getByText(/PDF can.t show some characters here \(న మ\)/)).toBeTruthy()
  })

  it('closes with Escape and gives focus back to the button; arrows move between choices', () => {
    render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    openMenu()
    const [pdf, word] = [screen.getByRole('button', { name: /PDF/ }), screen.getByRole('button', { name: /Word/ })]
    pdf.focus()
    fireEvent.keyDown(pdf, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(word)
    fireEvent.keyDown(word, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(pdf)
    fireEvent.keyDown(pdf, { key: 'Escape' })
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Download/ }))
  })

  it('closes when you click elsewhere', () => {
    render(<div><DownloadMenu title="Plan" kind="doc" getContent={() => content} /><p>elsewhere</p></div>)
    openMenu()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('has no accessibility violations, open or closed', async () => {
    const { container } = render(<DownloadMenu title="Plan" kind="doc" getContent={() => content} />)
    expect((await axe.run(container)).violations).toEqual([])
    openMenu()
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })
})
