// A tiny test client that speaks the same protocol as the browser will.
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

export class TestClient {
  doc = new Y.Doc()
  awareness = new awarenessProtocol.Awareness(this.doc)
  ws!: WebSocket
  synced = false

  constructor(
    private port: number,
    private docId: string,
    private query = '',
  ) {}

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}/collab/${this.docId}${this.query}`)
      this.ws.binaryType = 'nodebuffer'
      this.ws.on('error', reject)
      this.ws.on('open', () => {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, 0)
        syncProtocol.writeSyncStep1(enc, this.doc)
        this.ws.send(encoding.toUint8Array(enc))
        resolve()
      })
      this.ws.on('message', (data: Buffer) => {
        const dec = decoding.createDecoder(new Uint8Array(data))
        const type = decoding.readVarUint(dec)
        if (type === 0) {
          const reply = encoding.createEncoder()
          encoding.writeVarUint(reply, 0)
          const st = syncProtocol.readSyncMessage(dec, reply, this.doc, this)
          if (st === syncProtocol.messageYjsSyncStep2) this.synced = true
          if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply))
        } else if (type === 1) {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this)
        }
      })
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === this || this.ws.readyState !== WebSocket.OPEN) return
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, 0)
        syncProtocol.writeUpdate(enc, update)
        this.ws.send(encoding.toUint8Array(enc))
      })
    })
  }

  text() {
    return this.doc.getText('body').toString()
  }
  close() {
    this.ws.close()
  }
}

export async function waitFor(cond: () => boolean, ms = 3000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
