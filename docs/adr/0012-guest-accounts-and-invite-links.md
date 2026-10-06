# ADR 0012: Guest accounts and invite links

**Status:** accepted

## Context

The first version needed an email and a password before anything worked, and sharing a document
needed the other person to have an account already. For a project meant to be opened by strangers,
"try it in ten seconds" and "send a link" matter more than almost any feature.

## Decision

**Guest accounts.** `POST /auth/guest` creates a real user with a random password nobody knows, a
generated name ("Curious Otter"), a starter workspace, a Welcome document and a sample board, and
returns a token. Everything the app does for a normal account works for a guest. `POST /auth/upgrade`
attaches an email and a password to the same account, so nothing is lost ("Save your work").

**Invite links.** The owner creates a link for a role (editor, commenter or viewer, never owner).
The link is `/join/<code>`: 128 random bits, base64url, valid for 7 days, revocable, reusable. Anyone
who opens it can join with one click (as a guest if they have no account). Joining never *downgrades*
someone who already has more access, and it publishes an access event so open connections pick up the
new role.

## Evidence

`server/test/onboarding.test.ts` (20 tests): guests get working starter content; a link joins with the
right role; revoked and expired links fail; a link cannot grant owner; an existing owner is not
downgraded; the hourly guest cap holds; a guest token lasts about a month while a normal login lasts
12 hours; pruning removes only old guests and everything they own. `e2e/tests/collaboration.spec.ts`:
a brand-new visitor joins through a link in a real browser.

## Consequences and risks (read these)

- **A link is a capability.** Anyone who has it gets the role it carries, and it can be reused until it
  expires or is revoked. Treat it like the document itself. The Share dialog says so.
- **Guest creation can be abused.** The only limits are the per-IP auth rate limiter (in memory, per API
  instance) and an hourly cap on new guests (`MAX_GUESTS_PER_HOUR`, default 300, also in memory).
  A determined person with many addresses could create many guests. On a public server consider turning
  guests off (`GUESTS_ENABLED=false`) or adding a CAPTCHA.
- **Nothing cleans up guests automatically.** `npm run prune-guests -- --days 30 --delete` does it, but
  somebody has to run it (a scheduled job). Until then guest data accumulates in MongoDB.
- **A guest cannot sign in again.** They have no password, so the token is the account. It lasts 30
  days (a bug found while writing this record: it was 12 hours, which would have locked returning guests
  out of their own work). Clearing the browser's storage loses the account unless it was upgraded.
- **Invite codes are logged nowhere:** the access log records the route pattern, never the real URL.

## Alternatives

- **Accounts only:** simplest and safest, but the first thing a visitor meets is a form.
- **Anonymous sessions with no account row:** lighter, but then there is nothing to upgrade and nowhere
  to keep roles and comments.
- **Single-use or emailed invites:** safer, and the right next step for sensitive workspaces; they need
  email sending, which this project does not have.
