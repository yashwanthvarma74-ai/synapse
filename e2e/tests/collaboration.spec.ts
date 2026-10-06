
import { expect, test, editor, inviteCode, newGuest, openDoc, text, typeAtEnd, windowFor } from './helpers'

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

  // both edit the SAME spot (the end of the page) while disconnected
  await typeAtEnd(a, ' [ALPHA edit]')
  await typeAtEnd(b, ' [BRAVO edit]')
  await expect(editor(a)).not.toContainText('BRAVO')
  await expect(editor(b)).not.toContainText('ALPHA')

  // reconnect both, and time how long until the two screens agree
  const t0 = Date.now()
  for (const page of [a, b]) await page.getByRole('button', { name: 'Offline mode', exact: true }).click()
  await expect.poll(async () => (await text(a)) === (await text(b)) && (await text(a)).includes('ALPHA') && (await text(a)).includes('BRAVO'), { timeout: 10_000, intervals: [50] }).toBe(true)
  const ms = Date.now() - t0
  info.annotations.push({ type: 'merge time', description: `${ms} ms` })
  console.log(`[${info.project.name}] both screens identical ${ms} ms after reconnecting`)
  expect(ms).toBeLessThan(2_000) // the brief's target: under 2 seconds
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
  await expect(e.getByRole('heading', { name: "We can't open this" })).toBeVisible()
})

test('the invite link flow works for a brand-new visitor with no account', async ({ browser, request }) => {
  const ann = await newGuest(request, 'Ann')
  const code = await inviteCode(request, ann, 'editor')
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`/join/${code}`)
  await p.getByRole('button', { name: 'Join now, no sign-up' }).click()
  await expect(p).toHaveURL(/\/doc\//)
  await expect(editor(p)).toBeVisible()
})
