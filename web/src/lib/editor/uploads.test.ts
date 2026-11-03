import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../api', () => ({ api: (...a: unknown[]) => apiMock(...a) }))

import { MAX_BYTES, problemWith, uploadFile } from './uploads'

const file = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type })

describe('problemWith', () => {
  it('accepts images, PDFs and text', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'])
      expect(problemWith({ name: 'f', type: t, size: 10 })).toBeNull()
  })
  it('refuses types that can run in a browser, in plain words', () => {
    expect(problemWith({ name: 'a.html', type: 'text/html', size: 10 })).toMatch(/not a type we can upload/)
    expect(problemWith({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/not a type we can upload/)
  })
  it('refuses empty and oversized files', () => {
    expect(problemWith({ name: 'e.png', type: 'image/png', size: 0 })).toMatch(/empty/)
    expect(problemWith({ name: 'b.png', type: 'image/png', size: MAX_BYTES + 1 })).toMatch(/too big/)
  })
})

describe('uploadFile', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    apiMock.mockResolvedValue({ uploadUrl: 'https://bucket.test/k.png?sig=1', url: 'https://api.test/files/d/k.png', name: 'cat.png', image: true })
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    apiMock.mockReset()
    fetchMock.mockReset()
  })

  it('asks for permission first, then sends the bytes to the signed URL with the same type', async () => {
    const f = file('cat.png', 'image/png', 321)
    const out = await uploadFile('doc1', f)
    expect(apiMock).toHaveBeenCalledWith('/documents/doc1/uploads', { body: { name: 'cat.png', contentType: 'image/png', size: 321 } })
    expect(fetchMock).toHaveBeenCalledWith('https://bucket.test/k.png?sig=1', expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'image/png' }, body: f }))
    expect(out).toEqual({ url: 'https://api.test/files/d/k.png', name: 'cat.png', image: true })
  })
  it('never asks the server when the file is obviously not allowed', async () => {
    await expect(uploadFile('doc1', file('x.exe', 'application/x-msdownload'))).rejects.toThrow(/not a type/)
    expect(apiMock).not.toHaveBeenCalled()
  })
  it('explains a storage refusal and a network failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(uploadFile('doc1', file('a.png', 'image/png'))).rejects.toThrow(/refused.*403/)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(uploadFile('doc1', file('a.png', 'image/png'))).rejects.toThrow(/could not reach/)
  })
  it('passes through the server\'s own message (for example a viewer who may not upload)', async () => {
    apiMock.mockRejectedValueOnce(new Error('You do not have permission'))
    await expect(uploadFile('doc1', file('a.png', 'image/png'))).rejects.toThrow('You do not have permission')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
