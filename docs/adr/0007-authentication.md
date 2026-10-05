# ADR 0007: Authentication with scrypt passwords and signed bearer tokens

**Status:** accepted for development; several items below must change before
real users.

## Decision

- **Passwords:** hashed with `scrypt` (built into Node, memory-hard), a random
  16-byte salt per user, compared in constant time (`server/src/auth.ts`).
- **Sessions:** a signed JWT (HS256, `jose`) valid for 12 hours, sent as a
  `Authorization: Bearer` header to the API.
- **WebSocket:** the same token is sent as `?token=` in the connection URL and
  verified **before** the upgrade, together with the user's membership.
- **Login errors:** "wrong password" and "no such email" return the same message.
- **Input:** every request body is validated with Zod; unknown routes and
  malformed JSON return clean errors; 500 responses never include internals.
- **Throttling:** 20 attempts per minute per IP on login and register.
- **Secrets:** `JWT_SECRET` (32+ characters) is required in production; in
  development a fixed placeholder is used.

## Why a bearer token and not a cookie

The WebSocket gateway and the API run on different origins (ports) and a
WebSocket cannot send custom headers from a browser, so a token is the simplest
thing that works for both. It keeps cross-origin cookies and CSRF out of the
picture.

## Known weaknesses (not fixed)

| Weakness | Why it matters | Fix |
|---|---|---|
| Token in `localStorage` | Readable by any script on the page (XSS) | httpOnly cookie plus a CSRF defense, same-site deployment |
| Token in the WebSocket URL | Can end up in server and proxy logs | Short-lived single-use ticket fetched just before connecting |
| 12-hour token, no revocation list | A stolen token works until it expires, though losing workspace access still blocks documents immediately | Short tokens plus refresh tokens |
| In-memory login rate limit | Per API instance only | Shared limiter in Redis |
| No email verification, no password reset | Real accounts need both | Add an email flow |
| Invites only for existing users | Awkward for new teammates | Invite links with expiry |

## Consequences

- **Good:** a revoked workspace member is cut off immediately even though their
  token is still valid, because roles are checked against the database and
  re-checked on live sockets (ADR 0002). Token validity only proves identity.
- **Cost:** the weaknesses above are real. This is fine for a local portfolio
  project and not fine for production.
