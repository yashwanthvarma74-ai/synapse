# ADR 0002: Two consistency domains, content and access

**Status:** accepted. This is the central design decision of the project.

## Context

A collaborative document needs two kinds of correctness that pull in opposite
directions:

- Content must be editable offline and converge eventually. No server can be
  required to approve each keystroke.
- Permissions must be exact and immediate. "Alice no longer has access" must not
  wait for Alice's laptop to reconnect or for copies to converge.

If permissions were stored inside the shared document, they would inherit the
document's rules: merged eventually, editable by anyone who can write, and
visible to every copy. A viewer could edit the permission record, and a
revocation would be just another edit racing with the person it targets.

## Decision

| | Document content | Access control |
|---|---|---|
| Consistency | Eventually consistent | Server-authoritative |
| Where it lives | The Yjs document, in each browser and in MongoDB | MongoDB `memberships`, read only by the server |
| Checked | Never (merged) | On room join and on **every** incoming write |

Concretely:

- `server/src/access.ts` is the one place that answers "what is this user's role
  on this document?".
- `server/src/gateway.ts` calls it **before** the WebSocket upgrade, so a
  stranger never gets a socket.
- `server/src/room.ts` checks the sender's role on every sync message. A write
  from a viewer is dropped before it touches the document. Reads (the sync
  handshake) are allowed.
- When the API changes someone's role it publishes an access event; every
  gateway re-checks that user's open sockets at once. A 30-second re-check on a
  timer covers a missed event.
- Roles are never stored in the Yjs document.

## Evidence

`server/test/access.test.ts` (against real MongoDB): sockets with no token, a bad
token, or no membership are rejected; a viewer's write never reaches an editor;
removing a member closes their open socket with code 4403; demoting an editor to
a viewer takes effect on the live socket; the browser then shows "Access
removed" and deletes its offline copy.

## Consequences

- **Good:** revocation is immediate and cannot be bypassed from the client.
- **Cost:** a copy of the document already on someone's machine cannot be
  un-sent. The client deletes its offline copy when access is removed, but a
  malicious client could have kept one. This is true of any system that lets
  people read documents.
- **Cost:** a viewer who forces an edit locally (for example through developer
  tools, since the UI makes the editor read-only) keeps that change in their own
  copy. The server drops it, so it never reaches anyone else or the database, but
  their own screen is not corrected. It is harmless to others and only affects
  that person.
- **Cost:** every write needs a role in memory. The role is cached on the
  connection and refreshed by events and the timer, not read from the database on
  every keystroke.

## Alternatives considered

- **Roles inside the CRDT:** rejected for the reasons in the context.
- **Reject writes at the database only:** too late; the edit would already have
  been fanned out to other people.
