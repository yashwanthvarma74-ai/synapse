
import type { Page } from '@playwright/test'
import { expect, test, editor, inviteCode, newGuest, openDoc, text, typeAtEnd, windowFor } from './helpers'

// Times the merge inside the page: from the moment the person presses the Offline mode button to the moment
// the other person's words are in their document. Polling from the test process instead would add the browser
// driver's own round trips to every sample, and those are several times slower in WebKit than in Chromium.
async function timeMerge(page: Page, needle: string) {
  await page.evaluate((n) => {
    const toggle = document.querySelector('[aria-label="Offline mode demo"] button[aria-pressed]')!
    let pressedAt = 0
    toggle.addEventListener('click', () => { pressedAt = performance.now() }, { once: true, capture: true })
    ;(window as unknown as { merged: Promise<number> }).merged = new Promise((resolve) => {
      const timer = setInterval(() => {
        const doc = document.querySelector('[aria-label="Document editor"]')
        if (pressedAt && doc?.textContent?.includes(n)) { clearInterval(timer); resolve(performance.now() - pressedAt) }
      }, 5)
    })
  }, needle)
  return () => page.evaluate(() => (window as unknown as { merged: Promise<number> }).merged)
}

test('two people see each other and each other\'s typing, live', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const code = await inviteCode(request, ann, 'editor')
  const bob = await newGuest(request, 'Bob')
  expect((await request.post(`http://127.0.0.1:4101/invites/${code}/accept`, { headers: { authorization: `Bearer ${bob.token}` }, data: {} })).ok()).toBe(true)

  const a = await windowFor(browser, ann.token)
  const b = await windowFor(browser, bob.token)
  await openDoc(a, ann.docId)
  await openDoc(b, ann.docId)

  await expect(a.getByText('2 people here')).toBeVisible()
  await expect(b.getByText('2 people here')).toBeVisible()

  await typeAtEnd(a, ' Hello from Ann.')
  await expect(editor(b)).toContainText('Hello from Ann.')
  await typeAtEnd(b, ' Hello from Bob.')
  await expect(editor(a)).toContainText('Hello from Bob.')
})

test('signature demo: both go offline, edit the same spot, reconnect, and nothing is lost', async ({ browser, request }, info) => {
  const ann = await newGuest(request, 'Ann')
  const bob = await newGuest(request, 'Bob')
  await request.post(`http://127.0.0.1:4101/invites/${await inviteCode(request, ann, 'editor')}/accept`, { headers: { authorization: `Bearer ${bob.token}` }, data: {} })

  const a = await windowFor(browser, ann.token)
  const b = await windowFor(browser, bob.token)
  await openDoc(a, ann.docId)
  await openDoc(b, ann.docId)
  await expect(a.getByText('2 people here')).toBeVisible()

  // both windows stop talking to the server
  for (const page of [a, b]) {
    await page.locator('summary', { hasText: 'Try offline mode' }).click()
    await page.getByRole('button', { name: 'Offline mode', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Offline/ })).toBeVisible()
  }

  // both edit the same spot (the end of the page) while disconnected
  await typeAtEnd(a, ' [ALPHA edit]')
  await typeAtEnd(b, ' [BRAVO edit]')
  await expect(editor(a)).not.toContainText('BRAVO')
  await expect(editor(b)).not.toContainText('ALPHA')

  // reconnect both, and time how long until each screen has the other person's words
  const aMerged = await timeMerge(a, 'BRAVO')
  const bMerged = await timeMerge(b, 'ALPHA')
  for (const page of [a, b]) await page.getByRole('button', { name: 'Offline mode', exact: true }).click()
  const ms = Math.round(Math.max(await aMerged(), await bMerged()))
  info.annotations.push({ type: 'merge time', description: `${ms} ms` })
  console.log(`[${info.project.name}] both screens have both edits ${ms} ms after reconnecting`)
  expect(ms).toBeLessThan(2_000) // the brief's target: under 2 seconds
  await expect.poll(async () => (await text(a)) === (await text(b)), { timeout: 5_000 }).toBe(true)
  expect(await text(a)).toBe(await text(b))
})

test('a viewer can read but not write', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const viewer = await newGuest(request, 'Vera')
  await request.post(`http://127.0.0.1:4101/invites/${await inviteCode(request, ann, 'viewer')}/accept`, { headers: { authorization: `Bearer ${viewer.token}` }, data: {} })

  const v = await windowFor(browser, viewer.token)
  await v.goto(`/doc/${ann.docId}`)
  await expect(editor(v)).toBeVisible()
  await expect(editor(v)).toHaveAttribute('contenteditable', 'false')
  await expect(v.getByText('Viewers can read comments but not write them.')).toBeVisible()
  await expect(v.getByRole('button', { name: 'Share' })).toHaveCount(0)
})

test('a stranger cannot open someone else\'s document', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const eve = await newGuest(request, 'Eve')
  const e = await windowFor(browser, eve.token)
  await e.goto(`/doc/${ann.docId}`)
  await expect(e.getByRole('heading', { name: "Can't open this" })).toBeVisible()
})

test('the invite link flow works for a brand-new visitor with no account', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const code = await inviteCode(request, ann, 'editor')
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`/join/${code}`)
  await p.getByRole('button', { name: 'Join now, no sign up' }).click()
  await expect(p).toHaveURL(/\/doc\//)
  await expect(editor(p)).toBeVisible()
})
