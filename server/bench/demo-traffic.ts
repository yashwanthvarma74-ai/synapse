// Feeds the dashboard: signs in as the test account, opens one document with several
// simulated editors, and types for a while. Usage:
//   npx tsx bench/demo-traffic.ts [editors=12] [seconds=120] [editsPerSecondEach=2]
// Needs the dev server running and an account to sign in with, passed in the environment
// (never hard-coded): DEMO_EMAIL=you@example.com DEMO_PASSWORD=... npx tsx bench/demo-traffic.ts
import { TestClient } from '../test/helpers.js'

const editors = Number(process.argv[2] ?? 12)
const seconds = Number(process.argv[3] ?? 120)
const rate = Number(process.argv[4] ?? 2)
const API = 'http://localhost:4001'

const { DEMO_EMAIL, DEMO_PASSWORD } = process.env
if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD to an account that exists in your local Synapse.')
  process.exit(1)
}
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
}).then((r) => r.json())
if (!login.token) {
  console.error('Sign-in failed:', login.error ?? 'unknown error')
  process.exit(1)
}
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
const workspaces = await fetch(`${API}/workspaces`, { headers: H }).then((r) => r.json())
const docs = await fetch(`${API}/workspaces/${workspaces[0].id}/documents`, { headers: H }).then((r) => r.json())
const doc = docs.find((d: { type: string; title: string }) => d.type === 'doc' && !d.title.startsWith('Big')) ?? docs[0]
console.log(`feeding "${doc.title}" with ${editors} editors for ${seconds}s`)

const clients: TestClient[] = []
for (let i = 0; i < editors; i++) {
  const c = new TestClient(4000, doc.id, `?token=${login.token}`)
  await c.connect()
  clients.push(c)
}
const timers = clients.map((c, i) => setInterval(() => {
  const t = c.doc.getXmlFragment('default') // writes into the real editor structure? keep it harmless: use a side text
  void t
  const text = c.doc.getText('demo-traffic')
  text.insert(text.length, `.`)
  if (text.length > 400) text.delete(0, 200) // keep the document small
}, 1000 / rate + i * 7))
await new Promise((r) => setTimeout(r, seconds * 1000))
timers.forEach(clearInterval)
clients.forEach((c) => c.close())
console.log('done')
process.exit(0)
