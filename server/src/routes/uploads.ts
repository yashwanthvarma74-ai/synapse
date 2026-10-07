import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES } from '../storage.js'
import { HttpError, idParam, limitFromEnv, parse, rateLimit, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

const FILE_NAME = /^[a-f0-9]{32}\.(png|jpg|gif|webp|pdf|txt)$/
const DOC_ID = /^[a-f0-9]{24}$/
const IMAGE = /\.(png|jpg|gif|webp)$/

// Files go from the browser straight to object storage, so they never pass through this server:
//   1. an editor asks to upload one file (name, type, size)
//   2. we answer with a short-lived URL signed for exactly that file
//   3. the browser uploads to that URL
//   4. the document stores /files/<doc>/<random-name>, which redirects to a fresh short-lived download URL
// The random name is 128 bits, so the link works like an unguessable address: it needs no sign-in.
export function uploadRoutes(ctx: ApiContext) {
  const { storage, publicUrl } = ctx
  const { documentRole } = guards(ctx)
  const router = Router()
  const limit = rateLimit(limitFromEnv('UPLOAD_RATE_LIMIT', 60), 60_000)

  router.post('/documents/:id/uploads', limit, needAuth, route(async (req, res) => {
    if (!storage) throw new HttpError(501, 'Uploads are not set up on this server')
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'editor')
    const { name, contentType, size } = parse(z.object({
      name: z.string().trim().min(1).max(200),
      contentType: z.string().max(100),
      size: z.number().int().positive(),
    }), req.body)

    const kind = ALLOWED_TYPES[contentType]
    if (!kind) throw new HttpError(415, 'That kind of file is not allowed. Use PNG, JPEG, GIF, WebP, PDF or plain text.')
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `That file is too big. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)

    // the stored name is random and its extension comes from the type, never from the file name sent
    const key = `${docId.toHexString()}/${randomBytes(16).toString('hex')}.${kind.ext}`
    const base = publicUrl ?? `${req.protocol}://${req.get('host')}`
    res.status(201).json({ uploadUrl: await storage.presignPut(key, contentType, size), url: `${base}/files/${key}`, name, image: kind.image })
  }))

  router.get('/files/:doc/:name', route(async (req, res) => {
    const doc = String(req.params.doc)
    const name = String(req.params.name)
    if (!storage || !DOC_ID.test(doc) || !FILE_NAME.test(name)) throw new HttpError(404, 'Not found')
    res.set('cache-control', 'private, max-age=300')
    res.redirect(302, await storage.presignGet(`${doc}/${name}`, IMAGE.test(name) ? undefined : { download: name }))
  }))

  return router
}
