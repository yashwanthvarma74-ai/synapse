// Creates a large document (for the typing-latency measurement): ~20,000 words
// in 500 paragraphs, written through the real gateway like a user would.
import * as Y from 'yjs'
import { TestClient, waitFor } from '../test/helpers.js'

const API = 'http://localhost:4001'
// Credentials come from the environment, never from the source:
//   DEMO_EMAIL=you@example.com DEMO_PASSWORD=... npx tsx bench/bigdoc.ts
const { DEMO_EMAIL, DEMO_PASSWORD } = process.env
if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD to an account that exists in your local Synapse.')
  process.exit(1)
}
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }) }).then((r) => r.json())
if (!login.token) {
  console.error('Sign-in failed:', login.error ?? 'unknown error')
  process.exit(1)
}
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
const wid = (await fetch(`${API}/workspaces`, { headers: H }).then((r) => r.json()))[0].id
const doc = await fetch(`${API}/workspaces/${wid}/documents`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Big document (20k words)' }) }).then((r) => r.json())

const words = 'the quick brown fox jumps over a lazy dog while collaborative editing keeps every copy consistent offline and online'.split(' ')
const c = new TestClient(4000, doc.id, `?token=${login.token}`)
await c.connect()
const frag = c.doc.getXmlFragment('default')
c.doc.transact(() => {
  for (let p = 0; p < 500; p++) {
    const para = new Y.XmlElement('paragraph')
    const text = Array.from({ length: 40 }, (_, i) => words[(p * 7 + i) % words.length]).join(' ')
    para.insert(0, [new Y.XmlText(text)])
    frag.insert(frag.length, [para])
  }
})
await waitFor(() => c.synced, 5000)
await new Promise((r) => setTimeout(r, 1500)) // let the server store it
console.log(JSON.stringify({ docId: doc.id, paragraphs: frag.length, bytes: Y.encodeStateAsUpdate(c.doc).length }))
c.close()
process.exit(0)
