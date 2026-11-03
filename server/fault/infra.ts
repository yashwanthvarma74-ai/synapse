// Private Redis and MongoDB instances for fault tests, on their own ports and
// temporary folders, so killing them never touches the development databases.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
  })
}

export async function waitPort(port: number, open: boolean, ms = 20_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await portOpen(port)) === open) return
    await sleep(100)
  }
  throw new Error(`port ${port} did not become ${open ? 'open' : 'closed'}`)
}

class Service {
  private child: ChildProcess | null = null
  constructor(private name: string, private port: number, private cmd: string, private args: string[]) {}
  async start() {
    this.child = spawn(this.cmd, this.args, { stdio: 'ignore' })
    await waitPort(this.port, true)
  }
  // sigkill: no graceful shutdown, like a crash or a lost machine
  async kill() {
    this.child?.kill('SIGKILL')
    await waitPort(this.port, false)
    this.child = null
  }
  get running() { return this.child !== null }
}

export function newRedis(port: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'synapse-fault-redis-'))
  return new Service('redis', port, 'redis-server', ['--port', String(port), '--dir', dir, '--save', '', '--appendonly', 'no'])
}

// Mongo keeps its data folder across kill/start, like a real restart
export function newMongo(port: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'synapse-fault-mongo-'))
  return new Service('mongod', port, 'mongod', ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1'])
}

export async function health(port: number) {
  try {
    return await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()) as { ok: boolean; sockets: number; rooms: number }
  } catch {
    return null
  }
}
