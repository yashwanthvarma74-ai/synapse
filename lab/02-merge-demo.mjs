// Four small experiments behind the blog post "Why Synapse uses a CRDT and not OT".
// Run: node 02-merge-demo.mjs   (needs `npm install` in this folder once)
import * as Y from 'yjs'

const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
const text = (doc) => doc.getText('t').toString()
const make = (id) => { const d = new Y.Doc(); d.clientID = id; return d }

// 1. Two people type at the same spot while disconnected. Does the order they sync in matter?
{
  const ravi = make(1), sai = make(2)
  ravi.getText('t').insert(0, 'Hello')
  sync(ravi, sai)                       // both start from "Hello"
  ravi.getText('t').insert(5, ' world') // offline
  sai.getText('t').insert(5, ' there')  // offline, same spot
  const a = make(10), b = make(11)      // two fresh observers that receive the edits in opposite orders
  sync(ravi, a); sync(sai, a)
  sync(sai, b);  sync(ravi, b)
  console.log('1. same spot, opposite arrival orders')
  console.log('   observer A :', JSON.stringify(text(a)))
  console.log('   observer B :', JSON.stringify(text(b)))
}

// 2. Delivering the same update twice changes nothing
{
  const ravi = make(1), sai = make(2)
  ravi.getText('t').insert(0, 'once')
  const update = Y.encodeStateAsUpdate(ravi)
  Y.applyUpdate(sai, update); Y.applyUpdate(sai, update); Y.applyUpdate(sai, update)
  console.log('2. same update applied three times:', JSON.stringify(text(sai)))
}

// 3. What does a merge NOT understand? One person deletes a word while another types inside it.
{
  const ravi = make(1), sai = make(2)
  ravi.getText('t').insert(0, 'ship the editor first')
  sync(ravi, sai)
  ravi.getText('t').delete(9, 6)        // Ravi deletes "editor"
  sai.getText('t').insert(12, 'XX')     // Sai types "XX" in the middle of "editor"
  sync(ravi, sai); sync(sai, ravi)
  console.log('3. delete a word vs type inside it')
  console.log('   Ravi sees  :', JSON.stringify(text(ravi)))
  console.log('   Sai sees   :', JSON.stringify(text(sai)))
}

// 4. Reconnecting sends only what the other side is missing
{
  const server = make(1), phone = make(2)
  server.getText('t').insert(0, 'x'.repeat(5000)) // a 5,000 character document both sides have
  sync(server, phone)
  phone.getText('t').insert(10, ' a few offline words')
  const full = Y.encodeStateAsUpdate(phone).length
  const diff = Y.encodeStateAsUpdate(phone, Y.encodeStateVector(server)).length
  console.log('4. reconnect after a small offline edit')
  console.log(`   whole document : ${full} bytes`)
  console.log(`   what is sent   : ${diff} bytes (only what the server is missing)`)
}
