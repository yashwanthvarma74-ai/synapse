import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:4101'

export interface Guest { token: string; workspaceId: string; docId: string; boardId: string }

// Sign up a guest straight through the API (fast), the same call the "Try it now" button makes
export async function newGuest(request: APIRequestContext, name = 'Tester'): Promise<Guest> {
  const r = await (await request.post(`${API}/auth/guest`, { data: { name } })).json()
  return { token: r.token, workspaceId: r.starter.workspaceId, docId: r.starter.welcomeId, boardId: r.starter.boardId }
}

export async function inviteCode(request: APIRequestContext, owner: Guest, role: 'editor' | 'commenter' | 'viewer') {
  const r = await request.post(`${API}/workspaces/${owner.workspaceId}/invites`, { headers: { authorization: `Bearer ${owner.token}` }, data: { role } })
  return (await r.json()).code as string
}

// A separate browser window with its own storage, already signed in as this token
export async function windowFor(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.addInitScript((t) => { try { localStorage.setItem('synapse:token', t) } catch {} }, token)
  return ctx.newPage()
}

export async function openDoc(page: Page, docId: string) {
  await page.goto(`/doc/${docId}`)
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Connected/ })).toBeVisible()
}

export const editor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' })
export const text = (page: Page) => editor(page).innerText()

// Put the cursor at the very end of the document and type there. The caret is set through the
// selection API, so it does not depend on each browser's keyboard shortcut for "go to the end".
export async function typeAtEnd(page: Page, s: string) {
  const ed = editor(page)
  await ed.focus()
  await ed.evaluate((el) => {
    const sel = window.getSelection()!
    sel.selectAllChildren(el)
    sel.collapseToEnd()
  })
  await page.keyboard.type(s)
}
