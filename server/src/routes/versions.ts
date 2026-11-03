import { Router } from 'express'
import { oid } from '../db.js'
import { HttpError, idParam, route } from '../http.js'
import { guards, needAuth, type ApiContext } from './context.js'

// Versions are created over the WebSocket (see room.ts); these routes only read them
export function versionRoutes(ctx: ApiContext) {
  const { c, store } = ctx
  const { documentRole } = guards(ctx)
  const router = Router()

  router.get('/documents/:id/versions', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'viewer')
    const versions = await store.listVersions(docId.toHexString())
    const authorIds = versions.flatMap((v) => (v.createdBy && oid(v.createdBy) ? [oid(v.createdBy)!] : []))
    const authors = await c.users.find({ _id: { $in: authorIds } }, { projection: { name: 1 } }).toArray()
    const nameOf = new Map(authors.map((u) => [u._id.toHexString(), u.name]))
    res.json(versions.map((v) => ({ ...v, savedBy: (v.createdBy && nameOf.get(v.createdBy)) || 'Someone' })))
  }))

  // The saved Yjs state itself, so the browser can preview or restore it
  router.get('/documents/:id/versions/:version', needAuth, route(async (req, res) => {
    const docId = idParam(req.params.id as string)
    await documentRole(req.userId, docId, 'viewer')
    const state = await store.getVersionState(docId.toHexString(), Number(req.params.version))
    if (!state) throw new HttpError(404, 'Not found')
    res.type('application/octet-stream').send(Buffer.from(state))
  }))

  return router
}
