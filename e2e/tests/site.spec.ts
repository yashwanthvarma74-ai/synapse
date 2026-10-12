import { expect, test } from './helpers'
test('every page credits the author and links to the source', async ({ page }) => {
  for (const path of ['/', '/login']) {
    await page.goto(path)
    const footer = page.getByRole('contentinfo')
    await expect(footer).toContainText('Built by')
    await expect(footer.getByRole('link', { name: /Yashwanth Varma/ })).toHaveAttribute('href', 'https://github.com/yashwanthvarma74-ai')
    await expect(footer.getByRole('link', { name: /Source code on GitHub/ })).toHaveAttribute('href', 'https://github.com/yashwanthvarma74-ai/synapse')
  }
})

test('the footer sits at the bottom of a short page, not floating mid-screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/login')
  const box = await page.getByRole('contentinfo').boundingBox()
  expect(box!.y + box!.height).toBeGreaterThan(880) // flush with the bottom of the window
})

test('links shared on social apps get a title, description, image and author', async ({ page }) => {
  await page.goto('/')
  const meta = (sel: string) => page.locator(sel).first().getAttribute('content')
  expect(await meta('meta[property="og:title"]')).toContain('Synapse')
  expect(await meta('meta[property="og:description"]')).toContain('CRDTs')
  expect(await meta('meta[property="og:image"]')).toMatch(/\/social\.jpg$/)
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image')
  expect(await meta('meta[name="author"]')).toBe('Yashwanth Varma')
  const img = await page.request.get(new URL('/social.jpg', page.url()).toString())
  expect(img.status()).toBe(200)
})

test('the browser tab shows the Synapse icon, not the framework default', async ({ page, request }) => {
  await page.goto('/')
  const icons = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => (e as HTMLLinkElement).getAttribute('href') ?? ''))
  expect(icons.some((h) => h.includes('icon.svg'))).toBe(true)
  expect(icons.some((h) => h.includes('favicon.ico'))).toBe(true)
  expect(icons.some((h) => h.includes('apple-icon'))).toBe(true)
  for (const href of icons) expect((await request.get(new URL(href, page.url()).toString())).ok(), href).toBe(true)
})
