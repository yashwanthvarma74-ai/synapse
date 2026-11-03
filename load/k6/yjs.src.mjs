// k6 cannot import from node_modules, so Yjs and the sync protocol are bundled into one
// file (see `npm run build` in this folder). The load test then speaks the same protocol as the browser.
export * as Y from 'yjs'
export * as syncProtocol from 'y-protocols/sync'
export * as encoding from 'lib0/encoding'
export * as decoding from 'lib0/decoding'
