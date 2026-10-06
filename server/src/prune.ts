// Guest accounts pile up on a public instance ("Try it now" creates one each time). This removes
// OLD guests and what only they used. It is deliberately careful:
//   * a guest who upgraded to a real account is not a guest any more, so it is never touched
//   * a workspace is only deleted if every member is an old guest, so nobody loses a workspace
//     that real people still share (the old guest is just removed from it instead)
//   * dry run is the default; nothing is deleted unless you ask
import type { ObjectId } from 'mongodb'
import type { Collections } from './db.js'
import type { MongoStore } from './mongoStore.js'
import { MongoChatStore } from './chat.js'

export interface PruneResult {
  guests: number
  workspaces: number
  documents: number
  dryRun: boolean
}

export async function pruneGuests(c: Collections, store: MongoStore, opts: { olderThanDays: number; dryRun?: boolean; now?: Date }): Promise<PruneResult> {
  const dryRun = opts.dryRun ?? true
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.olderThanDays * 86_400_000)
  const old = await c.users.find({ guest: true, createdAt: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray()
  const oldIds = new Set(old.map((u) => u._id.toHexString()))
  const result: PruneResult = { guests: old.length, workspaces: 0, documents: 0, dryRun }
  if (old.length === 0) return result

  const memberships = await c.memberships.find({ userId: { $in: old.map((u) => u._id) } }).toArray()
  const workspaceIds = [...new Map(memberships.map((m) => [m.workspaceId.toHexString(), m.workspaceId])).values()]
  const doomed: ObjectId[] = []
  for (const wid of workspaceIds) {
    const members = await c.memberships.find({ workspaceId: wid }).toArray()
    if (members.every((m) => oldIds.has(m.userId.toHexString()))) doomed.push(wid) // only old guests are in it
  }

  const docs = await c.documents.find({ workspaceId: { $in: doomed } }, { projection: { _id: 1 } }).toArray()
  result.workspaces = doomed.length
  result.documents = docs.length
  if (dryRun) return result

  for (const d of docs) await store.deleteDocument(d._id.toHexString())
  await c.comments.deleteMany({ docId: { $in: docs.map((d) => d._id) } })
  for (const d of docs) await new MongoChatStore(store.db).deleteDocument(d._id.toHexString())
  await c.documents.deleteMany({ workspaceId: { $in: doomed } })
  await c.invites.deleteMany({ workspaceId: { $in: doomed } })
  await c.memberships.deleteMany({ workspaceId: { $in: doomed } })
  await c.workspaces.deleteMany({ _id: { $in: doomed } })
  // an old guest who was only a visitor in someone else's workspace: just remove the membership
  await c.memberships.deleteMany({ userId: { $in: old.map((u) => u._id) } })
  await c.users.deleteMany({ _id: { $in: old.map((u) => u._id) } })
  return result
}

// CLI:  npx tsx src/prune.ts --days 30            (shows what WOULD be removed)
//       npx tsx src/prune.ts --days 30 --delete   (actually removes it)
if (import.meta.url === `file://${process.argv[1]}`) {
  const { MongoStore } = await import('./mongoStore.js')
  const { collections } = await import('./db.js')
  const args = process.argv.slice(2)
  const days = Number(args[args.indexOf('--days') + 1] || 30)
  const store = new MongoStore(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017', process.env.MONGO_DB ?? 'synapse')
  await store.init()
  const r = await pruneGuests(collections(store.db), store, { olderThanDays: days, dryRun: !args.includes('--delete') })
  console.log(`${r.dryRun ? 'Would remove' : 'Removed'}: ${r.guests} guest accounts older than ${days} days, ${r.workspaces} workspaces, ${r.documents} documents.`)
  if (r.dryRun) console.log('Nothing was deleted. Add --delete to do it for real.')
  await store.close()
}
