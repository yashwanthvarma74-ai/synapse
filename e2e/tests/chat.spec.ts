import { type Page } from '@playwright/test'
import { expect, test, editor, inviteCode, newGuest, openDoc, windowFor } from './helpers'

const API = 'http://127.0.0.1:4101'
const box = (p: Page) => p.getByLabel('Message', { exact: true })
const chatTab = (p: Page) => p.getByRole('tab', { name: /^Chat/ })
const openChat = async (p: Page) => { await chatTab(p).click(); await expect(p.getByRole('region', { name: 'Chat messages' })).toBeVisible() }
const say = async (p: Page, text: string) => { await box(p).fill(text); await box(p).press('Enter') }
const log = (p: Page) => p.getByRole('region', { name: 'Chat messages' })

async function pair(request: import('@playwright/test').APIRequestContext, browser: import('@playwright/test').Browser, role: 'editor' | 'viewer' = 'editor') {
  const ann = await newGuest(request, 'Ann')
  const bob = await newGuest(request, 'Bob')
  await request.post(`${API}/invites/${await inviteCode(request, ann, role)}/accept`, { headers: { authorization: `Bearer ${bob.token}` }, data: {} })
  const a = await windowFor(browser, ann.token)
  const b = await windowFor(browser, bob.token)
  await openDoc(a, ann.docId)
  await openDoc(b, ann.docId)
  await expect(a.getByText('2 people here')).toBeVisible()
  return { ann, bob, a, b }
}

test('two people chat live, each message appears once, with the right names', async ({ browser, request }) => {
  const { a, b, ann, bob } = await pair(request, browser)
  // guests get generated names, so ask the server what each person is called
  const nameOf = async (token: string) => (await (await request.get(`${API}/me`, { headers: { authorization: `Bearer ${token}` } })).json()).name as string
  const [annName, bobName] = [await nameOf(ann.token), await nameOf(bob.token)]
  await openChat(a)
  await openChat(b)
  await say(a, 'Hello from Ann')
  await expect(log(b)).toContainText('Hello from Ann')
  await say(b, 'Hi Ann, Bob here')
  await expect(log(a)).toContainText('Hi Ann, Bob here')
  // names are the server's: each side sees itself as "You" and the other by name
  await expect(log(a).locator('.chat-msg.mine')).toHaveCount(1)
  await expect(log(a).locator('.chat-msg:not(.mine) strong')).toHaveText(bobName)
  await expect(log(b).locator('.chat-msg:not(.mine) strong')).toHaveText(annName)
  await expect(log(a).getByText('Hello from Ann')).toHaveCount(1) // the echo replaced "sending", no duplicate
})

test('messages are saved: a new window sees the history', async ({ browser, request }) => {
  const { ann, a } = await pair(request, browser)
  await openChat(a)
  await say(a, 'remember this')
  await expect(log(a)).toContainText('remember this')
  const fresh = await windowFor(browser, ann.token)
  await openDoc(fresh, ann.docId)
  await openChat(fresh)
  await expect(log(fresh)).toContainText('remember this')
})

test('an unread badge appears on the Chat tab while another tab is showing, and clears when opened', async ({ browser, request }) => {
  const { a, b } = await pair(request, browser)
  await openChat(a)
  await say(a, 'ping 1')
  await say(a, 'ping 2')
  await expect(b.getByRole('tab', { name: 'Chat (2 new)' })).toBeVisible() // b is on the Comments tab
  await chatTab(b).click()
  await expect(b.getByRole('tab', { name: 'Chat', exact: true })).toBeVisible() // no count any more
  await expect(log(b)).toContainText('ping 2')
})

test('typing in the document never loses focus because a chat message arrived', async ({ browser, request }) => {
  const { a, b } = await pair(request, browser)
  await openChat(a)
  await editor(b).click()
  await b.keyboard.type('typing in the page')
  await say(a, 'interruption')
  await expect(b.getByRole('tab', { name: 'Chat (1 new)' })).toBeVisible()
  await expect(editor(b)).toBeFocused()
  await b.keyboard.type(' and still going')
  await expect(editor(b)).toContainText('typing in the page and still going')
})

test('a viewer can read the chat but cannot write in it', async ({ browser, request }) => {
  const { a, b } = await pair(request, browser, 'viewer')
  await openChat(a)
  await say(a, 'owner speaking')
  await openChat(b)
  await expect(log(b)).toContainText('owner speaking')
  await expect(box(b)).toHaveCount(0)
  await expect(b.getByText(/can read the chat but can.t write/)).toBeVisible()
})

test('markup in a message is shown as text, never run', async ({ browser, request }) => {
  const { a, b } = await pair(request, browser)
  await openChat(a)
  await openChat(b)
  await say(a, '<img src=x onerror="document.title=\'hacked\'"><b>bold</b>')
  await expect(log(b)).toContainText('<img src=x')
  expect(await b.title()).not.toBe('hacked')
  await expect(log(b).locator('img, b')).toHaveCount(0)
})

test('sending too fast is refused politely and the text comes back', async ({ browser, request }) => {
  const { a } = await pair(request, browser)
  await openChat(a)
  for (let i = 0; i < 5; i++) await say(a, `burst ${i}`)
  await say(a, 'one too many')
  await expect(a.getByRole('alert').filter({ hasText: 'too quickly' })).toBeVisible()
  await expect(box(a)).toHaveValue('one too many')
})

test('offline: the box is disabled with a reason, and messages sent meanwhile appear after reconnecting', async ({ browser, request }) => {
  const { a, b } = await pair(request, browser)
  await openChat(a)
  await openChat(b)
  await b.locator('summary', { hasText: 'Try offline mode' }).click()
  await b.getByRole('button', { name: 'Offline mode', exact: true }).click()
  await expect(box(b)).toBeDisabled()
  await expect(box(b)).toHaveAttribute('placeholder', /offline/i)
  await say(a, 'said while you were away')
  await b.getByRole('button', { name: 'Offline mode', exact: true }).click()
  await expect(box(b)).toBeEnabled()
  await expect(log(b)).toContainText('said while you were away') // fetched after reconnecting
})

test('a stranger cannot read a document\'s chat history through the API', async ({ request }) => {
  const ann = await newGuest(request, 'Ann')
  const eve = await newGuest(request, 'Eve')
  expect((await request.get(`${API}/documents/${ann.docId}/chat`, { headers: { authorization: `Bearer ${eve.token}` } })).status()).toBe(404)
  expect((await request.get(`${API}/documents/${ann.docId}/chat`)).status()).toBe(401)
})
