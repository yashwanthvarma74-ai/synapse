// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import axe from 'axe-core'
import { renderWithQuery as render } from '@/test/wrap'
import { stubDialog } from '@/test/dom'
import { contentExtensions } from '@/lib/editorExtensions'
import { documentContent } from '@/lib/versions'
import type { VersionItem } from '@/lib/api'

const apiMock = vi.fn()
const apiBytes = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), apiBytes: (...a: unknown[]) => apiBytes(...a) }))

import History from './History'

const schema = getSchema(contentExtensions)
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
function writtenDoc(...texts: string[]) {
  const doc = new Y.Doc()
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: texts.map(paragraph) }, doc.getXmlFragment('default'))
  return doc
}
const textsOf = (doc: Y.Doc) => (documentContent(doc).content ?? []).map((n) => n.content?.map((t) => t.text).join('') ?? '')

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const VERSIONS: VersionItem[] = [
  { version: 2, label: 'Before the rewrite', createdAt: ago(5), savedBy: 'Kalyan' },
  { version: 1, label: 'First draft', createdAt: ago(300), savedBy: 'Yash' },
]

let saveVersion: ReturnType<typeof vi.fn>
function setup(opts: { role?: 'owner' | 'viewer'; connected?: boolean; versions?: VersionItem[]; live?: Y.Doc } = {}) {
  const live = opts.live ?? writtenDoc('the current text')
  saveVersion = vi.fn().mockResolvedValue(3)
  apiMock.mockResolvedValue(opts.versions ?? VERSIONS)
  const collab = { provider: { saveVersion }, doc: live } as never
  const view = render(<History docId="d1" collab={collab} role={opts.role ?? 'owner'} type="doc" connected={opts.connected ?? true} />)
  return { live, view }
}

beforeEach(() => stubDialog())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('History', () => {
  it('lists saved versions with who saved them and when', async () => {
    setup()
    const items = await screen.findAllByRole('listitem')
    expect(items[0].textContent).toContain('Before the rewrite')
    expect(items[0].textContent).toContain('Saved by Kalyan')
    expect(items[0].textContent).toContain('5 minutes ago')
    expect(items[1].textContent).toContain('5 hours ago')
  })

  it('shows a friendly empty state', async () => {
    setup({ versions: [] })
    expect(await screen.findByText('No saved versions yet')).toBeTruthy()
  })

  it('saves through the live connection and confirms it', async () => {
    setup()
    await screen.findByText('First draft')
    fireEvent.change(screen.getByLabelText('Version name'), { target: { value: '  Ready for review ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveVersion).toHaveBeenCalledWith('Ready for review'))
    expect((await screen.findByText('Saved “Ready for review”.')).getAttribute('role')).toBe('status')
    expect((screen.getByLabelText('Version name') as HTMLInputElement).value).toBe('')
  })

  it('shows the server\'s reason when saving fails, and keeps the name', async () => {
    setup()
    await screen.findByText('First draft')
    saveVersion.mockRejectedValueOnce(new Error("You're saving versions too quickly. Wait a moment and try again."))
    fireEvent.change(screen.getByLabelText('Version name'), { target: { value: 'Again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/too quickly/)
    expect((screen.getByLabelText('Version name') as HTMLInputElement).value).toBe('Again')
  })

  it('cannot save while offline, and says why', async () => {
    setup({ connected: false })
    await screen.findByText('First draft')
    expect((screen.getByLabelText('Version name') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/offline. Saving a version needs a connection/)).toBeTruthy()
  })

  it('lets viewers look at versions but not save or restore them', async () => {
    setup({ role: 'viewer' })
    await screen.findByText('First draft')
    expect(screen.queryByLabelText('Version name')).toBeNull()
    apiBytes.mockResolvedValue(Y.encodeStateAsUpdate(writtenDoc('older text')))
    fireEvent.click(screen.getByRole('button', { name: 'Preview version First draft' }))
    expect(await screen.findByText('older text')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull()
  })

  it('previews a version as it was saved, with the date and author', async () => {
    setup()
    await screen.findByText('First draft')
    apiBytes.mockResolvedValue(Y.encodeStateAsUpdate(writtenDoc('how it looked then')))
    fireEvent.click(screen.getByRole('button', { name: 'Preview version First draft' }))
    const dialog = await screen.findByRole('dialog', { hidden: true })
    expect(await within(dialog).findByText('how it looked then')).toBeTruthy()
    expect(dialog.textContent).toContain('Saved by Yash')
    expect(apiBytes).toHaveBeenCalledWith('/documents/d1/versions/1')
    expect(dialog.textContent).toContain('Before restoring First draft') // explains the safety net
  })

  it('restores: saves what is there now first, then puts the page back to that point', async () => {
    const { live } = setup({ live: writtenDoc('changed my mind, this is new') })
    await screen.findByText('First draft')
    apiBytes.mockResolvedValue(Y.encodeStateAsUpdate(writtenDoc('the saved text')))
    fireEvent.click(screen.getByRole('button', { name: 'Preview version First draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore this version', hidden: true }))
    await waitFor(() => expect(textsOf(live)).toEqual(['the saved text']))
    expect(saveVersion).toHaveBeenCalledWith('Before restoring First draft') // so it can be undone
    expect(await screen.findByText(/Restored “First draft”/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull())
  })

  it('does not touch the page if the safety-net save fails', async () => {
    const { live } = setup({ live: writtenDoc('keep me') })
    await screen.findByText('First draft')
    apiBytes.mockResolvedValue(Y.encodeStateAsUpdate(writtenDoc('other')))
    saveVersion.mockRejectedValueOnce(new Error('The server did not answer.'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview version First draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore this version', hidden: true }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not answer/)
    expect(textsOf(live)).toEqual(['keep me'])
  })

  it('has no accessibility violations (list and open preview)', async () => {
    const { view } = setup()
    await screen.findByText('First draft')
    expect((await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
    apiBytes.mockResolvedValue(Y.encodeStateAsUpdate(writtenDoc('preview text')))
    fireEvent.click(screen.getByRole('button', { name: 'Preview version First draft' }))
    await screen.findByText('preview text')
    const dialog = screen.getByRole('dialog', { hidden: true })
    expect((await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => v.id)).toEqual([])
  })
})
