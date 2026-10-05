# ADR 0009: Comments anchored with Yjs relative positions

**Status:** accepted

## Context

A comment attached to "the editor first" must stay attached to those words while
other people type before, inside or after them. A character offset such as
"characters 24 to 40" breaks the moment anyone inserts text earlier.

## Decision

Store the comment's range as two Yjs **relative positions**
(`web/src/components/Comments.tsx`). A relative position is "just after this
specific character", identified by its Yjs id, not by its index. To show the
comment, convert it back to the current index.

- The server stores the anchor as opaque JSON (`{from, to}`) on the comment
  record (`comments.anchor`). The server never interprets it.
- The comment also stores a `quote` (the selected text, up to 300 characters) so
  the panel shows what it referred to, even if the text is later deleted.
- "Show in text" converts the anchor and selects that range. If the anchored
  text was deleted, it says so instead of jumping somewhere wrong.
- Comments are **not** part of the Yjs document. They live in MongoDB and go
  through the API (ADR 0002): commenters and above may write, anyone with access
  may read, authors and editors may resolve or delete.

## Evidence

Checked in the browser: typing "BEFORE: " at the start of a document shifted
every offset by 8 characters, and "Show in text" still selected exactly "the
editor first".

## Consequences

- **Good:** anchors survive concurrent edits and merges.
- **Cost (expected, not tested):** restoring an older version replaces the
  content with copies of the old nodes, which get new ids. A comment anchored to
  text that was replaced should then show as "deleted" rather than jump to a
  wrong place. This follows from how restore works but has not been checked.
- **Cost:** the comments list is polled every 5 seconds rather than pushed live.
- **Not built:** comment highlights drawn inside the text, and replies in the UI
  (the API supports `parentId`; the UI shows top-level comments only).
- **Canvas documents** have no text anchors; comments there are general.

## Alternatives considered

- **Character offsets:** break on any earlier edit.
- **Putting comments in the Yjs document:** would make them editable by anyone who
  can write and merge eventually, but access to comments should follow the
  server's roles (ADR 0002).
