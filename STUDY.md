# Synapse: reading guide

Read in this order. Each file has comments explaining the why.

## 0. The idea (you already ran this)
`lab/01-converge.mjs`: two copies, edits merge, same result everywhere (CRDT).
`lab/02-merge-demo.mjs`: arrival order, duplicate delivery, what a merge does not understand.
`docs/blog/why-a-crdt-not-ot.md`: the argument for the design, in one post.

## 1. Server (`server/src`)
1. `store.ts`: the DocStore interface, update log + snapshot, memory/file versions.
2. `mongoStore.ts`: the real store. Read the comment above `load()`: why
   compaction deletes exact records instead of "everything up to N" (a race the
   tests caught).
3. `bus.ts`, `redisBus.ts`: how gateways talk to each other (Redis pub/sub).
4. `room.ts`: the heart. One open document: sync handshake, role check on every
   write, fan-out to sockets, store and bus, live role re-check.
5. `gateway.ts`: WebSocket server, auth before upgrade, room lifecycle
   (read the `closing` map: another race the tests caught).
6. `db.ts`, `auth.ts`, `access.ts`: collections, password hashing + signed tokens,
   and the ONE function that decides a user's role.
7. `api.ts`: REST API. Zod validation, role checks, comments, versions, search.
8. `text.ts`: pulls plain text out of a document for search.
9. `index.ts`: wiring.

## 2. Tests (`server/test`), run with `cd server && npm test`
- `convergence.test.ts`: 1000 random runs, every copy identical.
- `gateway.test.ts`: sync, room isolation, churn, compaction, Redis relay.
- `mongoStore.test.ts`: storage, concurrent compaction, versions, indexes.
- `access.test.ts`: login, roles, rejected sockets, live revocation, search isolation.
- `restore.test.ts`: version restore merges for everyone.
- `fault/faults.test.ts` (run with `npm run test:fault`): kills Redis, MongoDB and
  gateways on purpose. Read `docs/FAULT-INJECTION.md` alongside it.

## 3. Browser (`web/src`)
1. `lib/provider.ts`: hand-written sync client: handshake, reconnect with
   backoff + jitter, throttled presence, revoked-access handling.
2. `lib/useCollab.ts`: wires Y.Doc + IndexedDB + provider together.
3. `components/Editor.tsx`: Tiptap bound to the Yjs doc.
4. `components/Comments.tsx`: comments anchored with Yjs relative positions.
5. `components/History.tsx`: named versions, preview, restore.
6. `components/Workspace.tsx` (document page), `WorkspaceView.tsx`, `Search.tsx`.
7. `lib/api.ts`, `lib/useSession.ts`: talking to the API.

## 3b. Added after the first pass (read after the sections above)
- `web/src/lib/queries.ts`, `uiStore.ts`: server data with TanStack Query, UI-only state with Zustand
  (`docs/adr/0015`). Compare `Comments.tsx` with how it used to fetch by hand (`git log -p`).
- `web/src/lib/slashItems.ts`, `slashCommand.ts`: the "/" menu. Note why it has no `aria-expanded`.
- `server/src/storage.ts`, `web/src/lib/uploads.ts`, `uploadExtension.ts`: the pre-signed upload,
  end to end (`docs/adr/0014`). Why can't the browser change the file type or size after signing?
- `server/src/summarize.ts`: the AI call and its prompt-injection guard rails (`docs/adr/0016`).
- `server/src/onboarding.ts`, the guest and invite routes in `api.ts` (`docs/adr/0012`).
- `server/src/logger.ts`: structured logs. `server/ops/uptime.ts`: the outside-in probe.
- `e2e/tests/`: the Playwright tests. Start with `collaboration.spec.ts`, the offline merge demo.
- `load/k6/editors.js`: the k6 load test, and `docs/BENCHMARKS.md` section 4b for why 100 editors looks slow.
- `observability/tests/slo_test.yml` with the burn-rate rules in `alerts.yml`.
- `docs/DEPLOY.md`: how this goes on the internet.

## 4. Accessibility
- `docs/ACCESSIBILITY.md`: what the audit found and fixed (22 items), the keyboard map,
  and what is NOT verified.
- `web/src/components/Tabs.tsx`: the ARIA tabs pattern, with `Tabs.test.tsx`.
- `web/src/test/a11y.test.ts`: colour contrast computed from the real stylesheet.

## 5. Observability
- `docs/OBSERVABILITY.md`: what is measured, how it was verified (including breaking Redis
  and MongoDB), the cost, and what it cannot see.
- `server/src/telemetry.ts`: the instruments, the browser-metric allowlist, start-up.
- `web/src/lib/telemetry.ts` and `web/src/lib/provider.ts`: how browsers measure and report.
- `observability/`: Prometheus config, alert rules, `build-dashboard.py` (generates the dashboard).

## Run it
Easiest: `./dev.sh` starts everything. By hand, infra (data kept in `.infra/`, nothing runs at login):
```
redis-server --port 6379 --dir .infra/redis --save "" --appendonly no
mongod --dbpath .infra/mongo --port 27017 --bind_ip 127.0.0.1
```
Then:
```
cd server && npm run dev      # gateway :4000 + API :4001
cd web && npm run dev         # app :3000
```
Use `localhost:3000` for one account and `127.0.0.1:3000` for another, so two
people can be signed in at once.

## Questions to answer in your own words (interview prep)
- Why does the server drop a viewer's write instead of the document refusing it?
- What does the state vector exchange on connect save us from?
- Why jitter in the reconnect delay?
- Why is the gateway stateless, and what holds the truth?
- Why can compaction run on two gateways at once without losing an edit?
- Why did the long Redis outage never repair itself, and what is anti-entropy?
- Why does a database outage not lose edits typed during it?
- How does a comment keep its place while others type before it?
- What happens on a viewer's laptop when their access is revoked?
- Why does a toggle button keep the same label and use aria-pressed, instead of changing its text?
- Why can axe report zero violations and the page still fail someone?
- Why does the dashboard use an echo round trip instead of timestamps on edits?
- Why can the browser-reported availability number not see a total outage?
- What is an error-budget burn rate, and why does the fast-burn alert need two windows?
- Why does a pre-signed upload URL sign the content type and size?
- Why is the AI summary text shown as plain text and the board passed inside tags?
- Why does k6 at 100 editors report a slow p95 when the server is almost idle?
- Why did I need `exact: true` and a scripted caret in the end-to-end tests?
- Why are cancelled connections not counted as failures?
