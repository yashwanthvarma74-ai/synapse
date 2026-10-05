# ADR 0001: A CRDT (Yjs) instead of operational transformation

**Status:** accepted

## Context

Many people edit one document at once, and some of them are offline for a
while. Two approaches let their edits combine:

- **OT (operational transformation):** a central server puts every edit in one
  order and rewrites each edit against the ones it has not seen. Simple data,
  complex server logic.
- **CRDT:** every edit carries an identity and enough metadata that any copy can
  merge edits in any order and reach the same result.

## Decision

Use a CRDT, specifically **Yjs**.

**Offline editing is the core feature of this product, not an add-on.** With OT,
a long offline session means a client holds many edits that the server must
rebase against everything that happened meanwhile. With a CRDT, those edits just
merge when they arrive. There is also no single server that must order edits, so
any gateway can serve any room.

## Evidence in this repo

- `lab/01-converge.mjs`: two documents edited separately merge to the same text.
- `server/bench/convergence.ts`: 10,000 random runs, three replicas, random
  edits and partial syncs: content identical in 100%, bytes identical in 100%
  once syncing settles (see [BENCHMARKS.md](../BENCHMARKS.md) for the nuance).
- `server/bench/partition.ts`: 30 minutes of simulated offline typing per person
  merges in 44 to 58 ms.

## Consequences

- **Good:** offline works naturally; the gateway needs no per-room ordering; the
  merge is deterministic. When two people insert at the same spot, the tie is
  broken by each document's client ID, so every copy picks the same order.
- **Cost:** extra metadata in memory (every character has an ID, deleted text
  leaves tombstones), so documents must be compacted. See ADR 0004.
- **Cost:** a CRDT merges edits but does not understand intent. Two people
  rewriting the same sentence get both versions interleaved, not a smart result.
- **Cost:** bytes are only identical once syncing settles, not at every instant.
  Rich-text formatting makes each copy tidy redundant markers locally.

## Alternatives considered

- **OT (as in Google Docs):** fits always-online editors with one authoritative
  server. It would work for typing but makes long offline sessions and a
  multi-server setup much harder.
- **Automerge:** a strong CRDT with a JSON-like model. Yjs was chosen because it
  has the most mature editor binding (ProseMirror via `y-tiptap`), a ready-made
  presence protocol (awareness), and very compact binary updates.
