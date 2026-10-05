# ADR 0005: MongoDB for storage and search

**Status:** accepted

## Context

We store two very different things:

- **Document content:** binary Yjs updates and snapshots, keyed by document,
  written often, read as a whole.
- **Application data:** users, workspaces, memberships, document metadata,
  comments. Small, relational-looking, read and written through the API.

## Decision

Use MongoDB for both. Binary blobs keyed by document id and a sequence number
fit naturally in documents, and one database means one thing to run.

Collections and indexes (every field we filter or sort on is indexed):

| Collection | Index |
|---|---|
| `doc_updates` | unique `{docId, seq}` |
| `doc_snapshots` | `{docId, version}` |
| `users` | unique `{email}` |
| `memberships` | unique `{workspaceId, userId}`, `{userId}` |
| `documents` | `{workspaceId, updatedAt}`, text index on title and text |
| `comments` | `{docId, createdAt}` |

A test (`mongoStore.test.ts`, "has the indexes the queries rely on") checks the
unique index and that loading a document uses an index scan, not a collection
scan.

## Search

Search uses MongoDB's built-in **text index**. The gateway extracts plain text
from a document 3 seconds after edits stop (`server/src/text.ts`) and stores it
on the document record. Search only looks inside workspaces the caller belongs
to (tested).

**Atlas Search was not used.** It needs MongoDB Atlas (or a local search
process), which this development setup does not have. The text index gives
working search with weaker ranking and no fuzzy matching. Moving to Atlas Search
would change only the one query in `api.ts`.

## What would tip the choice to Postgres

Postgres would work equally well. Its `bytea` columns and a `(doc_id, seq)`
primary key hold the same data, and its transactions would make compaction
simpler. (A standalone MongoDB, as used here, has no multi-document
transactions; they need a replica set. ADR 0004 exists partly because of that.) Choose Postgres if the team already runs it, if strong
relational reporting on workspaces and members matters more than the document
store, or if we wanted its full-text search without a separate service.

## Consequences

- **Good:** one datastore; flexible shapes for comments and metadata.
- **Cost:** no multi-document transactions are used (they need a replica set), so
  compaction was designed to be safe without them (ADR 0004).
- **Cost:** the search copy of the text can lag by a few seconds.
