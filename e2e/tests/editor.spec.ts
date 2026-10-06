import { expect, test } from '@playwright/test'
import { editor, newGuest, openDoc, typeAtEnd, windowFor } from './helpers'

test('slash commands turn a line into a block', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await typeAtEnd(p, '\n/numb')
  await expect(p.getByRole('listbox', { name: 'Insert a block' })).toBeVisible()
  await expect(p.getByRole('option', { name: /Numbered list/ })).toBeVisible()
  await p.keyboard.press('Enter')
  await p.keyboard.type('first step')
  await expect(editor(p).locator('ol').last()).toContainText('first step')
  await expect(p.getByRole('listbox')).toHaveCount(0)
})

test('undo only undoes YOUR edits, not other people\'s', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const bob = await newGuest(request, 'Bob')
  const code = (await (await request.post(`http://127.0.0.1:4101/workspaces/${ann.workspaceId}/invites`, { headers: { authorization: `Bearer ${ann.token}` }, data: { role: 'editor' } })).json()).code
  await request.post(`http://127.0.0.1:4101/invites/${code}/accept`, { headers: { authorization: `Bearer ${bob.token}` }, data: {} })
  const a = await windowFor(browser, ann.token)
  const b = await windowFor(browser, bob.token)
  await openDoc(a, ann.docId)
  await openDoc(b, ann.docId)
  await expect(a.getByText('2 people here')).toBeVisible()

  await typeAtEnd(a, ' ANN-WORDS')
  await expect(editor(b)).toContainText('ANN-WORDS')
  await typeAtEnd(b, ' BOB-WORDS')
  await expect(editor(a)).toContainText('BOB-WORDS')

  // Ann presses undo twice: her words go, Bob's stay
  await a.getByRole('button', { name: 'Undo' }).click()
  await a.getByRole('button', { name: 'Undo' }).click()
  await expect(editor(a)).not.toContainText('ANN-WORDS')
  await expect(editor(a)).toContainText('BOB-WORDS')
  await expect(editor(b)).not.toContainText('ANN-WORDS')
  await expect(editor(b)).toContainText('BOB-WORDS')
})

test('a pasted image goes straight to object storage and shows in the page (E2E_S3=1)', async ({ browser, request }) => {
  const g = await newGuest(request)
  const probe = await request.post(`http://127.0.0.1:4101/documents/${g.docId}/uploads`, { headers: { authorization: `Bearer ${g.token}` }, data: { name: 'a.png', contentType: 'image/png', size: 10 } })
  test.skip(probe.status() === 501, 'no object storage in this run: start MinIO and use E2E_S3=1')

  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await editor(p).focus()
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 40
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#3b5bdb'; ctx.fillRect(0, 0, 80, 40)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'card.png', { type: 'image/png' }))
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const img = editor(p).locator('img[alt="card.png"]')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(80) // really downloaded from the bucket
  await expect(p.getByRole('status').filter({ hasText: 'Added card.png.' })).toBeVisible()
})

test('the whiteboard opens with its sample shapes and a keyboard-reachable toolbar', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/doc/${g.boardId}`)
  await expect(p.locator('canvas')).toBeVisible()
  await expect(p.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await p.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(p.getByRole('button', { name: 'Connect', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await p.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(p.getByRole('dialog')).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(p.getByRole('dialog')).toHaveCount(0)
})
