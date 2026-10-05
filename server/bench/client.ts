// A benchmark client: connects with a token and measures update propagation.
// The sender writes {seq, t} into a shared Y.Map; every other client's observer
// subtracts t from "now" to get the delay. Same machine, same clock source.
import * as Y from 'yjs'
import { TestClient } from '../test/helpers.js'
import { now } from './lib.js'

export class BenchClient {
  readonly tc: TestClient
  latencies: number[] = []
  received = 0
  private seq = 0
  constructor(port: number, docId: string, token: string, readonly id: string) {
    this.tc = new TestClient(port, docId, `?token=${token}`)
  }
  get doc() { return this.tc.doc }
  async connect() {
    await this.tc.connect()
    const ping = this.doc.getMap<{ seq: number; t: number }>('ping')
    ping.observe((ev, tx) => {
      if (tx.origin === this.tc) { // updates applied from the network (TestClient tags them with itself)
        const t1 = now()
        ev.keysChanged.forEach((k) => {
          if (k === this.id) return
          const v = ping.get(k)
          if (v) { this.received++; this.latencies.push(t1 - v.t) }
        })
      }
    })
  }
  // One edit = one small update on the wire, like a keystroke
  send() {
    this.doc.getMap('ping').set(this.id, { seq: ++this.seq, t: now() })
  }
  typeText(s: string) {
    const t = this.doc.getText('body')
    t.insert(t.length, s)
  }
  close() { this.tc.close() }
}
