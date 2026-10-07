// Shared helpers for the benchmarks. The gateway runs as a separate process (like
// production), so the clients' work doesn't compete with the server's event loop.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MongoClient, ObjectId } from 'mongodb'
import { signToken } from '../src/auth.js'
import { collections, ensureIndexes } from '../src/db.js'
import { MongoStore } from '../src/mongoStore.js'

const SECRET = 'bench-secret-bench-secret-bench-secret'
const MONGO = 'mongodb://127.0.0.1:27017'
const REDIS = 'redis://127.0.0.1:6379'

export const now = () => performance.timeOrigin + performance.now() // ms, sub-ms precision, comparable across clients in this process

export interface Gateway {
  port: number
  pid: number
  stop: () => Promise<void>
  kill: () => Promise<void> // sigkill, like a crash
  exited: () => boolean
}

export async function startGateway(port: number, db: string, opts: { redis?: boolean | string; mongoUrl?: string } = {}): Promise<Gateway> {
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      SERVICE: 'gateway',
      GATEWAY_PORT: String(port),
      MONGO_DB: db,
      MONGO_URL: opts.mongoUrl ?? MONGO,
      JWT_SECRET: SECRET,
      ...(opts.redis ? { REDIS_URL: typeof opts.redis === 'string' ? opts.redis : REDIS } : { REDIS_URL: '' }),
      NODE_NO_WARNINGS: '1',
      // BENCH_METRICS=<port> turns metrics ON for a run (to measure their cost); off by default
      METRICS_PORT: process.env.BENCH_METRICS ?? '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('gateway did not start')) }, 25_000)
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) {
        clearTimeout(t)
        resolve()
      }
    })
    child.on('exit', (c) => reject(new Error(`gateway exited early (${c})`)))
  })
  let gone = false
  child.on('exit', () => { gone = true })
  return {
    port,
    pid: child.pid!,
    exited: () => gone,
    stop: () => new Promise((r) => {
      if (gone) return r()
      child.once('exit', () => r())
      child.kill('SIGTERM')
    }),
    kill: () => new Promise((r) => {
      if (gone) return r()
      child.once('exit', () => r())
      child.kill('SIGKILL')
    }),
  }
}

// A workspace with N editors and one document, created straight in the database
export async function setupDoc(db: string, users: number, mongoUrl = MONGO) {
  const store = new MongoStore(mongoUrl, db)
  await store.init()
  const c = collections(store.db)
  await ensureIndexes(c)
  const wid = new ObjectId()
  const docId = new ObjectId()
  const ids = Array.from({ length: users }, () => new ObjectId())
  await c.users.insertMany(ids.map((_id, i) => ({ _id, email: `bench${i}@x.dev`, name: `bench${i}`, passwordHash: 'x', createdAt: new Date() })))
  await c.workspaces.insertOne({ _id: wid, name: 'bench', ownerId: ids[0], createdAt: new Date() })
  await c.memberships.insertMany(ids.map((u) => ({ _id: new ObjectId(), workspaceId: wid, userId: u, role: 'editor' as const })))
  await c.documents.insertOne({ _id: docId, workspaceId: wid, title: 'bench', type: 'doc', text: '', createdAt: new Date(), updatedAt: new Date() })
  const tokens = await Promise.all(ids.map((u) => signToken(u.toHexString(), SECRET, '2h')))
  return { docId: docId.toHexString(), tokens, store, drop: async () => { await store.db.dropDatabase(); await store.close() } }
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

export function summarize(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  return {
    n: s.length,
    min: round(s[0]), p50: round(percentile(s, 50)), p95: round(percentile(s, 95)),
    p99: round(percentile(s, 99)), max: round(s[s.length - 1]), mean: round(sum / s.length),
  }
}
const round = (n: number) => Math.round(n * 100) / 100

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// CPU % and memory of a process, sampled with ps
export function sampleProc(pid: number) {
  const out = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(pid)]).toString().trim().split(/\s+/)
  return { cpu: Number(out[0]), rssMb: Math.round(Number(out[1]) / 1024) }
}

function machine() {
  return {
    cpu: os.cpus()[0].model, cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()}`, node: process.version,
  }
}

export function save(name: string, data: unknown) {
  const file = path.resolve(import.meta.dirname, 'results', `${name}.json`)
  writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), machine: machine(), ...(data as object) }, null, 2))
  console.log(`saved ${file}`)
}
