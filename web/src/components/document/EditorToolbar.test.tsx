// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import EditorToolbar from './EditorToolbar'
import { violationsIn } from '@/test/axe'

let editor: Editor
beforeEach(() => {
  // a REAL editor with the same formatting nodes the app uses
  editor = new Editor({ extensions: [StarterKit], content: '<p>hello world</p>' })
})
afterEach(() => {
  cleanup()
  editor.destroy()
})

describe('EditorToolbar', () => {
  it('has no axe violations', async () => {
    const { container } = render(<EditorToolbar editor={editor} disabled={false} />)
    expect(await violationsIn(container)).toEqual([])
  })

  it('is a labelled toolbar with a tooltip that includes the shortcut', () => {
    render(<EditorToolbar editor={editor} disabled={false} />)
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('title')).toBe('Bold (Ctrl+B)')
  })

  it('bold, lists and headings really change the document, and the button shows it is on', () => {
    render(<EditorToolbar editor={editor} disabled={false} />)
    act(() => void editor.commands.selectAll())
    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(bold)
    expect(editor.getHTML()).toContain('<strong>hello world</strong>')
    expect(bold.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Bullets' }))
    expect(editor.getHTML()).toContain('<ul>')
    fireEvent.click(screen.getByRole('button', { name: 'Bullets' }))
    fireEvent.click(screen.getByRole('button', { name: 'Heading' }))
    expect(editor.getHTML()).toContain('<h1>')
  })

  it('all buttons are disabled for people who can only read', () => {
    render(<EditorToolbar editor={editor} disabled />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  it('every button\'s accessible name contains its visible words (so voice control can say what it sees)', () => {
    render(<EditorToolbar editor={editor} disabled={false} />)
    for (const b of screen.getAllByRole('button')) {
      const visible = (b.textContent ?? '').trim().toLowerCase()
      const name = (b.getAttribute('aria-label') ?? '').toLowerCase()
      expect(name.includes(visible), `"${b.getAttribute('aria-label')}" vs "${visible}"`).toBe(true)
    }
  })
})
