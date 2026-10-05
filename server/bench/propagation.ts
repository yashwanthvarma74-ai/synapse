// Remote update propagation: how long from "A makes an edit" to "B has applied it".
// Real gateway process(es), real MongoDB, real Redis. Typing pace: 20 edits/s,
// which is faster than a human (~5-8 keys/s), so it is a conservative test.
import { BenchClient } from './client.js'
import { setupDoc, startGateway, summarize, sleep, save } from './lib.js'

const EDITS = Number(process.env.EDITS ?? 1000)
const RATE = Number(process.env.RATE ?? 20) // edits per second

async function run(label: string, twoGateways: boolean) {
  const db = `synapse_bench_prop_${Date.now()}`
  const setup = await setupDoc(db, 2)
  const g1 = await startGateway(4101, db, { redis: twoGateways })
  const g2 = twoGateways ? await startGateway(4102, db, { redis: true }) : g1
  const a = new BenchClient(g1.port, setup.docId, setup.tokens[0], 'a')
  const b = new BenchClient(g2.port, setup.docId, setup.tokens[1], 'b')
  await a.connect()
  await b.connect()
  await sleep(500) // let handshakes and Redis subscriptions settle

  const gap = 1000 / RATE
  for (let i = 0; i < EDITS; i++) {
    a.send()
    await sleep(gap)
  }
  await sleep(500)
  const result = { label, edits: EDITS, ratePerSec: RATE, received: b.received, lost: EDITS - b.received, latencyMs: summarize(b.latencies) }
  console.log(label, JSON.stringify(result.latencyMs), `received ${b.received}/${EDITS}`)
  a.close(); b.close()
  await sleep(200)
  await g1.stop(); if (twoGateways) await g2.stop()
  await setup.drop()
  return result
}

const results = [await run('same gateway', false), await run('two gateways via Redis', true)]
save('propagation', { target: 'p95 < 250 ms', results })
process.exit(0)
