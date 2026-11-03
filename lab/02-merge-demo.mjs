// Four small experiments behind the blog post "Why Synapse uses a CRDT and not OT".
// Run: node 02-merge-demo.mjs   (needs `npm install` in this folder once)
import * as Y from 'yjs'

const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
const text = (doc) => doc.getText('t').toString()
const make = (id) => { const d = new Y.Doc(); d.clientID = id; return d }

// 1. Two people type at the same spot while disconnected. Does the order they sync in matter?
{
  const yash = make(1), kalyan = make(2)
  yash.getText('t').insert(0, 'Hello')
  sync(yash, kalyan)                       // both start from "Hello"
  yash.getText('t').insert(5, ' world') // offline
  kalyan.getText('t').insert(5, ' there')  // offline, same spot
  const a = make(10), b = make(11)      // two fresh observers that receive the edits in opposite orders
  sync(yash, a); sync(kalyan, a)
  sync(kalyan, b);  sync(yash, b)
  console.log('1. same spot, opposite arrival orders')
  console.log('   observer A :', JSON.stringify(text(a)))
  console.log('   observer B :', JSON.stringify(text(b)))
}

// 2. Delivering the same update twice changes nothing
{
  const yash = make(1), kalyan = make(2)
  yash.getText('t').insert(0, 'once')
  const update = Y.encodeStateAsUpdate(yash)
  Y.applyUpdate(kalyan, update); Y.applyUpdate(kalyan, update); Y.applyUpdate(kalyan, update)
  console.log('2. same update applied three times:', JSON.stringify(text(kalyan)))
}

// 3. What does a merge NOT understand? One person deletes a word while another types inside it.
{
  const yash = make(1), kalyan = make(2)
  yash.getText('t').insert(0, 'ship the editor first')
  sync(yash, kalyan)
  yash.getText('t').delete(9, 6)        // Yash deletes "editor"
  kalyan.getText('t').insert(12, 'XX')     // Kalyan types "XX" in the middle of "editor"
  sync(yash, kalyan); sync(kalyan, yash)
  console.log('3. delete a word vs type inside it')
  console.log('   Yash sees  :', JSON.stringify(text(yash)))
  console.log('   Kalyan sees:', JSON.stringify(text(kalyan)))
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
