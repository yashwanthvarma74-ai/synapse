// Load test: many simulated editors in one room. Reports delivery delay percentiles,
// message loss, and the gateway's CPU and memory. (The PDF suggests k6; this uses a
// Node harness so it can speak the Yjs protocol and read update timestamps.)
// Clients run in several worker processes so the load generator is not the bottleneck.
import { fork } from 'node:child_process'
import { BenchClient } from './client.js'
import { setupDoc, startGateway, sampleProc, summarize, sleep, save } from './lib.js'

const WORKERS = 4

if (process.env.ROLE === 'worker') {
  // Worker: runs a slice of the clients
  const cfg = JSON.parse(process.env.CFG!) as { port: number; docId: string; tokens: string[]; offset: number; rate: number; seconds: number; stride: number }
  const clients: BenchClient[] = []
  for (let i = 0; i < cfg.tokens.length; i++) {
    const c = new BenchClient(cfg.port, cfg.docId, cfg.tokens[i], `c${cfg.offset + i}`)
    await c.connect()
    clients.push(c)
    if (i % 10 === 9) await sleep(20) // connect in small waves
  }
  process.send!({ type: 'ready' })
  await new Promise<void>((r) => process.once('message', () => r()))
  const sent = new Array(clients.length).fill(0)
  const timers: NodeJS.Timeout[] = []
  clients.forEach((c, i) => {
    setTimeout(() => {
      timers.push(setInterval(() => { c.send(); sent[i]++ }, 1000 / cfg.rate))
    }, Math.random() * (1000 / cfg.rate)) // random phase so clients don't all fire together
  })
  await sleep(cfg.seconds * 1000)
  timers.forEach(clearInterval)
  await sleep(1500) // let in-flight messages arrive
  // keep a sample of the delays (every stride-th) so results stay small
  const lat: number[] = []
  let received = 0
  for (const c of clients) {
    received += c.received
    for (let k = 0; k < c.latencies.length; k += cfg.stride) lat.push(c.latencies[k])
  }
  clients.forEach((c) => c.close())
  // exit only after the result has been handed to the parent, or it can be lost
  process.send!({ type: 'done', sent: sent.reduce((a, b) => a + b, 0), received, lat }, () => process.exit(0))
}

// Parent
async function run(editors: number, rate: number, seconds: number) {
  const db = `synapse_bench_load_${Date.now()}`
  const setup = await setupDoc(db, editors)
  const gw = await startGateway(4104, db)
  const per = Math.ceil(editors / WORKERS)
  const stride = Math.max(1, Math.floor(editors / 50)) // ~constant sample size across runs
  const workers = Array.from({ length: WORKERS }, (_, w) => {
    const tokens = setup.tokens.slice(w * per, (w + 1) * per)
    if (tokens.length === 0) return null
    const child = fork(import.meta.filename, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, ROLE: 'worker', NODE_NO_WARNINGS: '1', CFG: JSON.stringify({ port: gw.port, docId: setup.docId, tokens, offset: w * per, rate, seconds, stride }) },
    })
    child.on('exit', (code) => { if (code) console.error(`worker ${w} exited with code ${code}`) })
    const done = new Promise<{ sent: number; received: number; lat: number[] }>((resolve) => child.on('message', (m: { type: string; sent: number; received: number; lat: number[] }) => { if (m.type === 'done') resolve(m) }))
    const ready = new Promise<void>((resolve) => child.on('message', (m: { type: string }) => { if (m.type === 'ready') resolve() }))
    return { child, done, ready }
  }).filter((w) => w !== null)

  await Promise.all(workers.map((w) => w.ready))
  const connected = (await fetch(`http://localhost:${gw.port}/health`).then((r) => r.json())).sockets
  await sleep(2000) // let connection-time work settle before sampling idle CPU
  const idle = sampleProc(gw.pid)
  workers.forEach((w) => w.child.send('go'))

  const cpu: number[] = []
  let peakRss = 0
  const sampler = setInterval(() => {
    const s = sampleProc(gw.pid)
    cpu.push(s.cpu)
    peakRss = Math.max(peakRss, s.rssMb)
  }, 1000)
  const results = await Promise.all(workers.map((w) => w.done))
  clearInterval(sampler)

  const sent = results.reduce((a, r) => a + r.sent, 0)
  const received = results.reduce((a, r) => a + r.received, 0)
  const expected = sent * (editors - 1)
  const lat = results.flatMap((r) => r.lat)
  const row = {
    editors, editsPerSecEach: rate, seconds,
    editsSent: sent, deliveriesExpected: expected, deliveriesReceived: received,
    deliveredPct: Math.round((received / expected) * 10000) / 100,
    deliveriesPerSec: Math.round(received / seconds),
    delayMs: summarize(lat),
    gatewayCpuPct: { idle: idle.cpu, mean: Math.round(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)), peak: Math.max(...cpu) },
    gatewayRssMb: { idle: idle.rssMb, peak: peakRss },
    connectedSockets: connected,
  }
  console.log(JSON.stringify(row))
  await gw.stop()
  await setup.drop()
  return row
}

const plan = process.env.QUICK ? [{ editors: Number(process.env.QUICK), rate: 2 }] : [{ editors: 50, rate: 2 }, { editors: 100, rate: 2 }, { editors: 200, rate: 1 }]
const rows = []
for (const p of plan) rows.push(await run(p.editors, p.rate, Number(process.env.SECONDS ?? 30)))
save('load', { target: '50+ editors in one room', rows })
process.exit(0)
