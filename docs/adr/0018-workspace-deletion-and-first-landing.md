# ADR 0018: Deleting a workspace, and where "Try it now" lands

**Status:** accepted

## Context

Two product questions came up once people could actually use the site:

1. After "Try it now", where should a new visitor land? Straight in the Welcome document makes the choice
   for them, though some would rather see the whiteboard first.
2. People need to be able to get rid of a workspace they no longer want, and start a new one.

## Decision

**Landing.** "Try it now" (and the header and sign-in variants) lands on the visitor's **workspace page**.
"My workspace" is already there, holding the Welcome document and the Sample board, and the page tells a new
person to pick one. Following an invite link still opens the document the inviter was working on.

**Creating.** Creating a workspace opens it straight away (it starts empty, with buttons for a new document or
whiteboard).

**Deleting.** `DELETE /workspaces/:id`, **owner only**, removes everything the workspace owns: every document
and board with its saved content and named versions, comments, chat messages, invite links, memberships, and
uploaded files in the bucket (best effort), then the workspace itself.

- **Ordered so a failure can be retried:** content first, then access, then the workspace record. If something
  fails halfway the owner still sees the workspace and can delete again.
- **Open connections are closed:** access events are published for every member, so anyone with a document
  open sees "Access removed" within about a second and their browser clears its offline copy.
- **The interface makes you mean it:** a dialog says what will be lost and for how many people, then asks you to
  type the workspace's name (any capitalisation) before Delete turns on. Focus starts on Cancel.
- Deleting your last workspace is allowed; the dashboard shows an empty state with the create box.

## A related fix found while testing this

With no Redis (the free hosting setup), the server used a placeholder bus that delivers nothing, so even though
the API and the live-sync server run in the same process, access changes only reached open connections on the
30-second recheck. That affected removing a member as well. Now, without Redis, one in-process hub connects
them, and access changes take effect in about half a second. With several processes Redis is still required.

## Evidence

`server/test/workspace-delete.test.ts` (10 tests) against a real MongoDB: everything is removed (content,
versions, comments, chat, invites, members, files); other workspaces and other users' data are untouched;
editors and viewers get 403, strangers 404, signed-out 401; a second delete and an old invite link find
nothing; deleting the last workspace then creating a new one works; a storage failure does not block the
deletion; an open live connection is closed with the "access revoked" code; and new connections to a deleted
document are refused. Removing the owner check, the chat cleanup, the file cleanup or the access event each
made a test fail. The bucket cleanup (paging through listings) is tested with a stub; **it was not run against
a real bucket for deletion**. `e2e/tests/workspace.spec.ts` runs five scenarios in Chromium and WebKit,
including a second person whose open document is deleted under them.

## Limits and costs

- **Irreversible, with no trash or undo.** The typed confirmation is the only safeguard.
- **Owners only.** There is no "leave this workspace" for members yet, and no transfer of ownership.
- **Uploaded files are removed best effort.** If the bucket is unreachable the workspace is still deleted and the
  files stay in the bucket, unreachable but not gone.
- **A gateway may save one last edit while its connections close.** The server sweeps the deleted documents
  again five seconds later to catch that, but it is best effort (a crash in between leaves a few orphaned
  records).
- Chat and edits are removed by document id; anything that held a copy elsewhere (a person's browser cache,
  an exported file) is not.
