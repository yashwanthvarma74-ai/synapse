import { expect, test, inviteCode, newGuest, openDoc, windowFor } from './helpers'

const API = 'http://127.0.0.1:4101'

test('"Try it now" lands in your workspace, where the Welcome document and the Sample board wait to be chosen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try it now, no sign-up' }).first().click()
  await expect(page).toHaveURL(/\/w\//) // the workspace page, not straight into a document
  await expect(page.getByRole('heading', { name: 'My workspace' })).toBeVisible()
  const cards = page.getByRole('list', { name: 'Documents and boards' })
  await expect(cards.getByRole('link', { name: /Welcome to Synapse/ })).toBeVisible()
  await expect(cards.getByRole('link', { name: /Sample board/ })).toBeVisible()
  await expect(page.getByText('New here?')).toBeVisible()
  // the person decides: the whiteboard...
  await cards.getByRole('link', { name: /Sample board/ }).click()
  await expect(page).toHaveURL(/\/doc\//)
  await expect(page.locator('canvas')).toBeVisible()
  // ...or the document
  await page.goBack()
  await page.getByRole('list', { name: 'Documents and boards' }).getByRole('link', { name: /Welcome to Synapse/ }).click()
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible()
})

test('delete a workspace (after typing its name), then add a new one', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/w/${g.workspaceId}`)
  await p.getByRole('button', { name: 'Delete workspace' }).click()
  const dialog = p.getByRole('dialog')
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
  await p.getByRole('dialog').getByLabel(/Type .* to confirm/).fill('My workspace')
  await p.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(p.getByRole('dialog')).toHaveCount(0)
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
  await o.getByRole('dialog').getByLabel(/Type .* to confirm/).fill('my workspace')
  await o.getByRole('dialog').getByRole('button', { name: 'Delete workspace' }).click()
  await expect(o.getByText('No workspaces yet')).toBeVisible()
  await expect(m.getByRole('status').filter({ hasText: 'Access removed' })).toBeVisible({ timeout: 15_000 })
})
