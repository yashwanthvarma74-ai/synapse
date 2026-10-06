# ADR 0013: Atlas Search for workspace search

**Status:** accepted (replaces the "Search" section of ADR 0005)

## Context

The brief names MongoDB Atlas with Atlas Search for full-text search. The first version used MongoDB's
built-in `$text` index because a local MongoDB has no Atlas Search. Now the database is Atlas.

## Decision

On Atlas (detected from a `mongodb+srv://` URL, or forced with `ATLAS_SEARCH=true|false`) `/search`
runs an Atlas Search `$search` query against a `doc_search` index over `title`, `text` and
`workspaceId`:

- **typo tolerant:** `fuzzy: { maxEdits: 1, prefixLength: 2 }`;
- **scoped to the caller inside the search itself:** a `filter` clause restricts results to the
  workspaces the caller belongs to (`workspaceId` is indexed as an `objectId`), so other people's
  documents are never scored or returned;
- **created at start-up** if missing (`ensureSearchIndex`, idempotent).

Anywhere else (a local MongoDB, tests, `./dev.sh`) and whenever the Atlas query fails (for example
while the index is still building) it falls back to the `$text` query, with a log warning.

## Evidence

Run against the real cluster (Mumbai, free tier): searching "Welcomme", "Synapsee" and "notebok"
found the Welcome page; the old `$text` index cannot match any of them. A second guest searching the
same words saw only their own copy, never the first guest's. The index reported `READY` and
`queryable`.

## Consequences

- **Search is not instant.** A new or edited document became searchable about 20 seconds later in my
  test (Atlas indexes in the background). The text copy is also updated 3 seconds after edits stop.
- **The Atlas path has no automated test.** The test suite runs on a local MongoDB, which cannot run
  `$search`. The scoping and fuzziness above were checked by hand against the cluster. A CI job
  against a throwaway Atlas project would close this gap.
- **Free-tier limits apply:** an M0 cluster allows a small number of search indexes and has limited
  storage (512 MB).
- Two query paths means two behaviours; ranking and typo tolerance differ between production and
  development. Acceptable for a portfolio project, a cost for a team.

## Alternatives

Postgres full-text search or a separate engine (Meilisearch, OpenSearch) would work and avoid the
Atlas dependency; the brief chose Atlas.
