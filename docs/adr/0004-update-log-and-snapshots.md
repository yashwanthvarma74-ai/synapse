# ADR 0004: Update log plus snapshots, compacted by merging stored data

**Status:** accepted

## Context

A CRDT document only grows: every edit adds metadata. Storing and loading the
whole history forever is not acceptable. We also want named versions
("First draft") to survive, and several gateways may write the same document at
the same time.

## Decision

Two MongoDB collections (`server/src/mongoStore.ts`):

- `doc_updates`: one record per edit, with a per-document sequence number.
- `doc_snapshots`: merged state. Unlabeled snapshots are working state; snapshots
  with a `label` are named versions and are **never** compacted away.

**Load** = merge all unlabeled snapshots + all remaining updates.
**Compact** (after every 100 updates, default): merge what was read, insert the
result as a new snapshot, then delete **only the exact records that were read**.
The new snapshot is written before anything is deleted, so a crash leaves
duplicates (harmless) and never missing data.

## The race this design closes

The first version trusted sequence numbers: "snapshot everything up to seq N,
delete everything up to N". A concurrency test
(`server/test/mongoStore.test.ts`, "does not lose an update written by another
gateway during compaction") showed edits being lost: a sequence number is
reserved before its record is inserted, so compaction could read "up to 10"
while an edit numbered 8 was still being written, then delete it or skip it.

The fix relies on a CRDT property: **applying an update twice changes nothing.**
So loading can merge everything it finds, duplicates included, and compaction
needs no locks. Two compactions running at once each remove only what they
read, and the other's new snapshot survives.

## Consequences

- **Good:** compaction is safe with many gateways and needs no coordination.
- **Good:** named versions are independent snapshots, so history survives
  compaction (tested).
- **Good:** loading a document is one snapshot merge plus a short log.
- **Cost:** every edit is its own database write. Simple and durable, but it is
  the first thing to batch (for example, buffer 50 ms of updates per room) at
  much higher load.
- **Cost:** after concurrent compactions several unlabeled snapshots can exist
  until the next compaction merges them. Correct, slightly wasteful.
- **Cost:** deleted text still leaves small tombstones inside the merged state.
  Yjs garbage-collects most of it, but state does not shrink to the visible text.

## Alternatives considered

- **Lock per document during compaction:** correct but needs a distributed lock.
- **Compact inside one designated gateway:** adds a special instance, which the
  design avoids (ADR 0006).
- **Never compact:** loading time grows without bound.
