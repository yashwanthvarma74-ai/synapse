import { expect, test, inviteCode, newGuest, openDoc, windowFor } from './helpers'

const API = 'http://127.0.0.1:4101'

test('"Try it now" opens the Welcome document, and the workspace (with the Sample board) is one click away', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try it now, no sign-up' }).first().click()
  await expect(page).toHaveURL(/\/doc\//)
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible()
  await page.getByRole('link', { name: /Back to the workspace/ }).click()
  await expect(page.getByRole('heading', { name: 'My workspace' })).toBeVisible()
  const cards = page.getByRole('list', { name: 'Documents and boards' })
  await expect(cards.getByRole('link', { name: /Welcome to Synapse/ })).toBeVisible()
  await cards.getByRole('link', { name: /Sample board/ }).click()
  await expect(page.locator('canvas')).toBeVisible()
})

test('a new guest sent to the sign-in page from someone else\'s workspace is not sent back there', async ({ browser, request }) => {
  const old = await newGuest(request, 'Old guest')
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`/w/${old.workspaceId}`) // signed out, so the app sends the visitor to sign in
  await expect(p).toHaveURL(/\/login\?next=/)
  await p.getByRole('button', { name: 'Just let me try it, no account' }).click()
  await expect(p).toHaveURL(/\/doc\//) // their own Welcome document, not the old guest's workspace
  await expect(p.getByRole('textbox', { name: 'Document editor' })).toBeVisible()
})

test('a workspace you cannot open says so plainly instead of showing an empty page', async ({ browser, request }) => {
  const owner = await newGuest(request, 'Owner')
  const stranger = await newGuest(request, 'Stranger')
  const p = await windowFor(browser, stranger.token)
  await p.goto(`/w/${owner.workspaceId}`)
  await expect(p.getByRole('heading', { name: "We can't open this" })).toBeVisible()
})

test('delete a workspace (after typing its name), then add a new one', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/w/${g.workspaceId}`)
  await p.getByRole('button', { name: 'Delete workspace' }).click()
  const dialog = p.getByRole('alertdialog')
  await expect(dialog).toContainText('This cannot be undone')
  await expect(dialog).toContainText('2 documents and boards')
  const confirm = dialog.getByRole('button', { name: 'Delete workspace' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Type .* to confirm/).fill('My workspace')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // back at the start, with nothing left
  await expect(p).toHaveURL(/\/$/)
  await expect(p.getByText('No workspaces yet')).toBeVisible()
  await expect(p.getByRole('link', { name: /My workspace/ })).toHaveCount(0)
  expect((await request.get(`${API}/documents/${g.docId}`, { headers: { authorization: `Bearer ${g.token}` } })).status()).toBe(404) // really gone, not just hidden

  // add a new one: it opens straight away, empty and ready
  await p.getByLabel('New workspace name').fill('Fresh start')
  await p.getByRole('button', { name: 'Create workspace' }).click()
  await expect(p).toHaveURL(/\/w\//)
  await expect(p.getByRole('heading', { name: 'Fresh start' })).toBeVisible()
  await expect(p.getByText('Nothing here yet')).toBeVisible()
})

test('Cancel keeps the workspace', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/w/${g.workspaceId}`)
  await p.getByRole('button', { name: 'Delete workspace' }).click()
  await p.getByRole('alertdialog').getByLabel(/Type .* to confirm/).fill('My workspace')
  await p.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(p.getByRole('alertdialog')).toHaveCount(0)
  await p.reload()
  await expect(p.getByRole('heading', { name: 'My workspace' })).toBeVisible()
  expect((await request.get(`${API}/documents/${g.docId}`, { headers: { authorization: `Bearer ${g.token}` } })).status()).toBe(200)
})

test('only the owner is offered Delete', async ({ browser, request }) => {
  const owner = await newGuest(request, 'Owner')
  const member = await newGuest(request, 'Member')
  await request.post(`${API}/invites/${await inviteCode(request, owner, 'editor')}/accept`, { headers: { authorization: `Bearer ${member.token}` }, data: {} })
  const p = await windowFor(browser, member.token)
  await p.goto(`/w/${owner.workspaceId}`)
  await expect(p.getByRole('heading', { name: 'My workspace' })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0)
})

test('people who have a document open are told their access is gone when the workspace is deleted', async ({ browser, request }) => {
  const owner = await newGuest(request, 'Owner')
  const member = await newGuest(request, 'Member')
  await request.post(`${API}/invites/${await inviteCode(request, owner, 'editor')}/accept`, { headers: { authorization: `Bearer ${member.token}` }, data: {} })
  const m = await windowFor(browser, member.token)
  await openDoc(m, owner.docId)
  const o = await windowFor(browser, owner.token)
  await o.goto(`/w/${owner.workspaceId}`)
  await o.getByRole('button', { name: 'Delete workspace' }).click()
  await o.getByRole('alertdialog').getByLabel(/Type .* to confirm/).fill('my workspace')
  await o.getByRole('alertdialog').getByRole('button', { name: 'Delete workspace' }).click()
  await expect(o.getByText('No workspaces yet')).toBeVisible()
  await expect(m.getByRole('status').filter({ hasText: 'Access removed' })).toBeVisible({ timeout: 15_000 })
})
