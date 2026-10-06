// Automated accessibility checks (axe-core, WCAG 2.0/2.1/2.2 A and AA rules) in real browsers.
// Automated rules find roughly a third of accessibility problems. A pass here is necessary, not
// sufficient: it is not a substitute for a screen reader (see docs/ACCESSIBILITY.md).
import AxeBuilder from '@axe-core/playwright'
import { type Page } from '@playwright/test'
import { expect, test, editor, newGuest, openDoc, typeAtEnd, windowFor } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function scan(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  // print what is wrong in a readable way if anything is
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary).toEqual([])
}

test('landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await scan(page)
})

test('sign-in page', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await scan(page)
})

test('dashboard and workspace', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto('/')
  await expect(p.getByRole('heading', { name: 'Your workspaces' })).toBeVisible()
  await scan(p)
  await p.goto(`/w/${g.workspaceId}`)
  await expect(p.getByRole('heading', { name: 'Documents and boards' })).toBeVisible()
  await scan(p)
})

test('document page, with the slash menu open, and with the share dialog open', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await scan(p)

  await typeAtEnd(p, '\n/')
  await expect(p.getByRole('listbox', { name: 'Insert a block' })).toBeVisible()
  await scan(p)
  await p.keyboard.press('Escape')
  await expect(p.getByRole('listbox')).toHaveCount(0)

  await p.getByRole('button', { name: 'Share' }).click()
  await expect(p.getByRole('dialog')).toBeVisible()
  await scan(p)
})

test('document page, History tab', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await p.getByRole('tab', { name: 'History' }).click()
  await expect(p.getByRole('heading', { name: 'Version history' })).toBeVisible()
  await scan(p)
})

test('document page, Chat tab, with messages', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await p.getByRole('tab', { name: /^Chat/ }).click()
  await p.getByLabel('Message', { exact: true }).fill('Hello, this is a test message')
  await p.getByLabel('Message', { exact: true }).press('Enter')
  await expect(p.getByRole('region', { name: 'Chat messages' })).toContainText('Hello, this is a test message')
  await scan(p)
})

test('workspace page, and the delete-workspace dialog', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/w/${g.workspaceId}`)
  await expect(p.getByText('New here?')).toBeVisible()
  await scan(p)
  await p.getByRole('button', { name: 'Delete workspace' }).click()
  await expect(p.getByRole('dialog')).toBeVisible()
  await scan(p)
})

test('whiteboard', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await p.goto(`/doc/${g.boardId}`)
  await expect(p.locator('canvas')).toBeVisible()
  await scan(p)
})

test('invite page', async ({ browser, request }) => {
  const g = await newGuest(request)
  const code = (await (await request.post(`http://127.0.0.1:4101/workspaces/${g.workspaceId}/invites`, { headers: { authorization: `Bearer ${g.token}` }, data: { role: 'viewer' } })).json()).code
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`/join/${code}`)
  await expect(p.getByRole('button', { name: 'Join now, no sign-up' })).toBeVisible()
  await scan(p)
})

test('keyboard only: the page can be used without a mouse (skip link, then the editor)', async ({ browser, request }) => {
  const g = await newGuest(request)
  const p = await windowFor(browser, g.token)
  await openDoc(p, g.docId)
  await p.goto(`/doc/${g.docId}`)
  // Safari (WebKit) does not tab to links unless a setting is on; Option+Tab is its documented shortcut
  await p.keyboard.press(test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab')
  await expect(p.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await p.keyboard.press('Enter')
  await expect(p.locator('main')).toBeFocused()
  await expect(editor(p)).toBeVisible()
})
