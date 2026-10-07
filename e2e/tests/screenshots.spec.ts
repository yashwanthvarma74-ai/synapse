// Not a test: regenerates the readme screenshots (docs/images) and the link-preview image from the
// production build, with two named people editing together. Run on purpose:
//   shots=1 npx playwright test --project=chromium tests/screenshots.spec.ts
import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { editor, inviteCode, openDoc, typeAtEnd, windowFor, type Guest } from './helpers'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../docs/images')
const API = 'http://127.0.0.1:4101'
const shot = { type: 'jpeg' as const, quality: 86 }

test.skip(!process.env.SHOTS, 'only runs when SHOTS=1')
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

async function person(request: import('@playwright/test').APIRequestContext, name: string): Promise<Guest> {
  const r = await (await request.post(`${API}/auth/register`, { data: { email: `${name.toLowerCase()}-${Date.now()}@shots.dev`, name, password: 'password123' } })).json()
  const ws = (await (await request.get(`${API}/workspaces`, { headers: { authorization: `Bearer ${r.token}` } })).json())[0].id
  const docs = await (await request.get(`${API}/workspaces/${ws}/documents`, { headers: { authorization: `Bearer ${r.token}` } })).json()
  return { token: r.token, workspaceId: ws, docId: docs.find((d: { type: string }) => d.type === 'doc').id, boardId: docs.find((d: { type: string }) => d.type === 'canvas').id }
}

test('screenshots', async ({ browser, request, page }) => {
  // the landing page, signed out; also the link-preview image at the size social apps like (1200 x 630)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.screenshot({ path: path.join(OUT, 'landing.jpg'), ...shot })
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.screenshot({ path: path.resolve(HERE, '../../web/public/social.jpg'), ...shot })
  await page.setViewportSize({ width: 1280, height: 800 })

  // two people in one document
  const yash = await person(request, 'Yash')
  const kalyan = await person(request, 'Kalyan')
  const code = await inviteCode(request, yash, 'editor')
  await request.post(`${API}/invites/${code}/accept`, { headers: { authorization: `Bearer ${kalyan.token}` }, data: {} })
  const a = await windowFor(browser, yash.token)
  const b = await windowFor(browser, kalyan.token)
  await a.setViewportSize({ width: 1280, height: 800 })
  await b.setViewportSize({ width: 1280, height: 800 })
  await openDoc(a, yash.docId)
  await openDoc(b, yash.docId)
  await expect(a.getByText('2 people here')).toBeVisible()
  // both people edit near the top of the page, so both coloured cursors and the "2 people here" bar are in view
  await editor(b).locator('p').first().click()
  await b.keyboard.press('End')
  await b.keyboard.type(' Kalyan is typing here, live.')
  await expect(editor(a)).toContainText('Kalyan is typing here')
  await editor(a).locator('h2').first().click()
  await a.keyboard.press('End')
  await a.keyboard.type(' (Yash, editing too)')
  await expect(editor(b)).toContainText('Yash, editing too')
  await a.waitForTimeout(500)
  await a.evaluate(() => window.scrollTo(0, 0))
  await a.waitForTimeout(500)
  await a.screenshot({ path: path.join(OUT, 'document.jpg'), ...shot })

  // the whiteboard
  await a.goto(`/doc/${yash.boardId}`)
  await expect(a.locator('canvas')).toBeVisible()
  await a.waitForTimeout(1200)
  await a.screenshot({ path: path.join(OUT, 'whiteboard.jpg'), ...shot })

  // the share dialog
  await a.goto(`/doc/${yash.docId}`)
  await a.getByRole('button', { name: 'Share' }).click()
  await a.getByRole('button', { name: 'Create invite link' }).click()
  await expect(a.getByLabel('Your link')).toBeVisible()
  await a.screenshot({ path: path.join(OUT, 'share.jpg'), ...shot })

  // what an invited person sees first
  const guest = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const j = await guest.newPage()
  await j.goto(`/join/${await inviteCode(request, yash, 'editor')}`)
  await expect(j.getByRole('heading', { name: 'Yash invited you' })).toBeVisible()
  await j.screenshot({ path: path.join(OUT, 'join.jpg'), ...shot })
})
