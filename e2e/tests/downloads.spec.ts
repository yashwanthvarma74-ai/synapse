import { expect, test, editor, newGuest, openDoc, typeAtEnd, windowFor } from './helpers'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import type { Download, Page } from '@playwright/test'

const downloadMenu = (p: Page) => p.getByRole('button', { name: 'Download' })

async function download(p: Page, choice: RegExp): Promise<{ file: Download; bytes: Buffer }> {
  await downloadMenu(p).click()
  const [file] = await Promise.all([p.waitForEvent('download'), p.getByRole('menuitem', { name: choice }).click()])
  return { file, bytes: await readFile((await file.path())!) }
}

test.describe('documents', () => {
  test('plain text and Markdown keep the words and the structure', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await openDoc(p, g.docId)
    await typeAtEnd(p, ' TYPED-FOR-DOWNLOAD')

    const txt = await download(p, /Plain text/)
    expect(txt.file.suggestedFilename()).toBe('Welcome-to-Synapse.txt')
    const plain = txt.bytes.toString('utf8')
    expect(plain).toContain('Welcome to Synapse')
    expect(plain).toContain('TYPED-FOR-DOWNLOAD')
    expect(plain).toMatch(/^1\. Type here\./m)

    const md = await download(p, /Markdown/)
    expect(md.file.suggestedFilename()).toBe('Welcome-to-Synapse.md')
    const markdown = md.bytes.toString('utf8')
    expect(markdown).toMatch(/^# Welcome to Synapse/m)
    expect(markdown).toContain('**Type here.**') // bold carried across
    expect(markdown).toContain('TYPED-FOR-DOWNLOAD')
  })

  test('a Word document is a real .docx with the text and headings', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await openDoc(p, g.docId)
    const { file, bytes } = await download(p, /Word document/)
    expect(file.suggestedFilename()).toBe('Welcome-to-Synapse.docx')
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Welcome to Synapse')
    expect(xml).toContain('Type here.')
    expect(xml).toContain('Heading1')
    expect(xml).toContain('Heading2')
  })

  test('a PDF is a real PDF', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await openDoc(p, g.docId)
    const { file, bytes } = await download(p, /PDF document/)
    expect(file.suggestedFilename()).toBe('Welcome-to-Synapse.pdf')
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(5000)
    expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF')
  })

  test('uses the title shown on the page, tidied into a file name', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await openDoc(p, g.docId)
    await p.getByLabel('Document title').fill('Q3 plan: draft/2')
    await p.getByLabel('Document title').press('Enter')
    await expect(p.getByRole('heading', { level: 1, name: 'Q3 plan: draft/2' })).toBeAttached()
    expect((await download(p, /Plain text/)).file.suggestedFilename()).toBe('Q3-plan-draft-2.txt')
  })

  test('an empty document says there is nothing to download', async ({ browser, request }) => {
    const g = await newGuest(request)
    const made = await (await request.post(`http://127.0.0.1:4101/workspaces/${g.workspaceId}/documents`, { headers: { authorization: `Bearer ${g.token}` }, data: { title: 'Blank', type: 'doc' } })).json()
    const p = await windowFor(browser, g.token)
    await openDoc(p, made.id)
    await downloadMenu(p).click()
    await p.getByRole('menuitem', { name: /Plain text/ }).click()
    await expect(p.getByRole('alert').filter({ hasText: 'nothing to download yet' })).toBeVisible()
  })

  test('warns before exporting a PDF with characters its font cannot show', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await openDoc(p, g.docId)
    await typeAtEnd(p, ' నమస్కారం')
    await expect(editor(p)).toContainText('నమస్కారం')
    await downloadMenu(p).click()
    await expect(p.getByText(/PDF can.t show some characters here/)).toBeVisible()
  })

  test('a viewer can download too', async ({ browser, request }) => {
    const owner = await newGuest(request, 'Owner')
    const viewer = await newGuest(request, 'Viewer')
    const code = (await (await request.post(`http://127.0.0.1:4101/workspaces/${owner.workspaceId}/invites`, { headers: { authorization: `Bearer ${owner.token}` }, data: { role: 'viewer' } })).json()).code
    await request.post(`http://127.0.0.1:4101/invites/${code}/accept`, { headers: { authorization: `Bearer ${viewer.token}` }, data: {} })
    const v = await windowFor(browser, viewer.token)
    await v.goto(`/doc/${owner.docId}`)
    await expect(editor(v)).toBeVisible()
    const { bytes } = await download(v, /Plain text/)
    expect(bytes.toString('utf8')).toContain('Welcome to Synapse')
  })
})

test.describe('whiteboards', () => {
  test('PNG is a real picture of the board, and SVG holds its shapes and words', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await p.goto(`/doc/${g.boardId}`)
    await expect(p.locator('canvas')).toBeVisible()

    const png = await download(p, /PNG image/)
    expect(png.file.suggestedFilename()).toBe('Sample-board.png')
    expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // the PNG signature
    expect(png.bytes.readUInt32BE(16)).toBeGreaterThan(300) // width in the header
    expect(png.bytes.readUInt32BE(20)).toBeGreaterThan(200) // height
    expect(png.bytes.length).toBeGreaterThan(5000)

    const svg = await download(p, /SVG image/)
    const markup = svg.bytes.toString('utf8')
    expect(markup).toMatch(/^<svg /)
    for (const word of ['Plan', 'Goal', 'Drag me anywhere']) expect(markup).toContain(word)
    expect(markup).toContain('<ellipse') // the "Goal" circle
    expect(markup).toContain('<line') // the connectors
  })

  test('an empty board says there is nothing to download', async ({ browser, request }) => {
    const g = await newGuest(request)
    const made = await (await request.post(`http://127.0.0.1:4101/workspaces/${g.workspaceId}/documents`, { headers: { authorization: `Bearer ${g.token}` }, data: { title: 'Empty board', type: 'canvas' } })).json()
    const p = await windowFor(browser, g.token)
    await p.goto(`/doc/${made.id}`)
    await expect(p.locator('canvas')).toBeVisible()
    await downloadMenu(p).click()
    await p.getByRole('menuitem', { name: /PNG image/ }).click()
    await expect(p.getByRole('alert').filter({ hasText: 'nothing to download yet' })).toBeVisible()
  })
})
