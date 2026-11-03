import { expect, test, content, editor, inviteCode, newGuest, openDoc, typeAtEnd, windowFor } from './helpers'
import type { Page } from '@playwright/test'

const API = 'http://127.0.0.1:4101'
const historyTab = (p: Page) => p.getByRole('tab', { name: 'History' })
const versionName = (p: Page) => p.getByLabel('Version name')
const saveButton = (p: Page) => p.getByRole('button', { name: 'Save', exact: true })
const preview = (p: Page, name: string) => p.getByRole('button', { name: `Preview version ${name}` })

async function saveVersion(p: Page, name: string) {
  await historyTab(p).click()
  await versionName(p).fill(name)
  await saveButton(p).click()
  await expect(p.getByText(`Saved “${name}”.`)).toBeVisible()
}

test('a version holds the page exactly as it was when Save was pressed, and Restore puts it back', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await typeAtEnd(p, ' SAVED-MARKER')
  await saveVersion(p, 'Good point')

  // the page keeps changing afterwards
  await typeAtEnd(p, ' AFTER-SAVE-WORDS')
  await expect(editor(p)).toContainText('AFTER-SAVE-WORDS')

  // preview shows the earlier moment, not the later edits
  await preview(p, 'Good point').click()
  const dialog = p.getByRole('dialog')
  await expect(dialog.getByRole('document')).toContainText('SAVED-MARKER')
  await expect(dialog.getByRole('document')).not.toContainText('AFTER-SAVE-WORDS')
  await expect(dialog).toContainText('Before restoring Good point')

  // restore: the page goes back to that point
  await dialog.getByRole('button', { name: 'Restore this version' }).click()
  await expect(p.getByText(/Restored “Good point”/)).toBeVisible()
  await expect(editor(p)).toContainText('SAVED-MARKER')
  await expect(editor(p)).not.toContainText('AFTER-SAVE-WORDS')

  // and where we were is kept, so nothing is lost
  await expect(preview(p, 'Before restoring Good point')).toBeVisible()
  await preview(p, 'Before restoring Good point').click()
  await expect(p.getByRole('dialog').getByRole('document')).toContainText('AFTER-SAVE-WORDS')
})

test('Save includes the words typed in the very last instant', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await historyTab(p).click()
  await versionName(p).fill('Instant')
  // type, then press Save at once, with no pause for the edit to reach the database
  await editor(p).evaluate((el) => {
    const sel = window.getSelection()!
    sel.selectAllChildren(el)
    sel.collapseToEnd()
  })
  await p.keyboard.type(' LAST-SECOND-WORDS')
  await saveButton(p).click()
  await expect(p.getByText('Saved “Instant”.')).toBeVisible()
  await preview(p, 'Instant').click()
  await expect(p.getByRole('dialog').getByRole('document')).toContainText('LAST-SECOND-WORDS')
})

test('a restore reaches everyone else in the document', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const bob = await newGuest(request, 'Bob')
  await request.post(`${API}/invites/${await inviteCode(request, ann, 'editor')}/accept`, { headers: { authorization: `Bearer ${bob.token}` }, data: {} })
  const a = await windowFor(browser, ann.token)
  const b = await windowFor(browser, bob.token)
  await openDoc(a, ann.docId)
  await openDoc(b, ann.docId)
  await expect(a.getByText('2 people here')).toBeVisible()
  await typeAtEnd(a, ' KEEP-THIS')
  await saveVersion(a, 'Keeper')
  await typeAtEnd(b, ' BOB-ADDED-LATER')
  await expect(editor(a)).toContainText('BOB-ADDED-LATER')
  await preview(a, 'Keeper').click()
  await a.getByRole('dialog').getByRole('button', { name: 'Restore this version' }).click()
  await expect(editor(b)).not.toContainText('BOB-ADDED-LATER') // Bob's screen goes back too
  await expect(editor(b)).toContainText('KEEP-THIS')
  await expect.poll(async () => (await content(a)) === (await content(b))).toBe(true)
})

test('viewers can preview a version but cannot save or restore', async ({ browser, request }) => {
  const owner = await newGuest(request, 'Owner')
  const viewer = await newGuest(request, 'Viewer')
  await request.post(`${API}/invites/${await inviteCode(request, owner, 'viewer')}/accept`, { headers: { authorization: `Bearer ${viewer.token}` }, data: {} })
  const o = await windowFor(browser, owner.token)
  await openDoc(o, owner.docId)
  await saveVersion(o, 'For viewing')
  const v = await windowFor(browser, viewer.token)
  await v.goto(`/doc/${owner.docId}`)
  await historyTab(v).click()
  await expect(versionName(v)).toHaveCount(0)
  await preview(v, 'For viewing').click()
  await expect(v.getByRole('dialog')).toBeVisible()
  await expect(v.getByRole('button', { name: 'Restore this version' })).toHaveCount(0)
})

test('saving needs a connection, and says so', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await p.locator('summary', { hasText: 'Try offline mode' }).click()
  await p.getByRole('button', { name: 'Offline mode', exact: true }).click()
  await historyTab(p).click()
  await expect(versionName(p)).toBeDisabled()
  await expect(p.getByText(/Saving a version needs a connection/)).toBeVisible()
})

test.describe('whiteboard', () => {
  const shapes = (p: Page) => p.getByRole('list', { name: 'Objects on the canvas' }).getByRole('listitem')

  test('preview draws the board as it was saved, and Restore removes what was added since', async ({ browser, request }) => {
    const g = await newGuest(request)
    const p = await windowFor(browser, g.token)
    await p.goto(`/doc/${g.boardId}`)
    await expect(p.locator('canvas')).toBeVisible()
    const before = await shapes(p).count()
    expect(before).toBeGreaterThan(2)
    await saveVersion(p, 'Original board')

    await p.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name: 'Sticky note' }).click()
    await expect(shapes(p)).toHaveCount(before + 1)

    await preview(p, 'Original board').click()
    const dialog = p.getByRole('dialog')
    const picture = dialog.locator('img.version-board')
    await expect(picture).toBeVisible()
    expect(await picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 100)).toBe(true) // a real drawing
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(shapes(p)).toHaveCount(before)
  })
})
