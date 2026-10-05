# ADR 0010: Failure handling and self-healing

**Status:** accepted. Driven by the results in [FAULT-INJECTION.md](../FAULT-INJECTION.md).

## Context

Fault tests that broke Redis, MongoDB, gateways and the WebSocket input found
four real problems: a crash from malformed input, edits lost during a database
outage, a long relay outage that never repaired itself, and a start-up that hung
when the database was down. This record states the rules the code now follows.

## Decisions

1. **Client input is untrusted and can only hurt its own connection.** A
   malformed message closes that socket (code 1003). Socket-level errors
   (such as exceeding the 8 MB size limit) terminate that socket. A malformed
   message from the Redis relay is logged and ignored. Nothing a client sends may
   throw out of an event handler.
2. **Keep editing alive when storage is down; never drop an edit silently.** If a
   save fails the room becomes "dirty" and retries with backoff (1 s up to 10 s).
   On success it writes its entire current state as a single update. Memory use
   is constant during an outage. On shutdown it tries one last time.
3. **The relay is a speed-up, not the source of truth.** MongoDB is. Rooms
   therefore *re-read the stored state* when the Redis subscriber reconnects and
   every 60 seconds, merging whatever they missed. Merging data already held is a
   no-op because CRDT updates are idempotent.
4. **Fail closed for new joins, fail open for existing sessions.** If roles
   cannot be looked up (database down) a new connection is refused. People already
   connected keep their last known role until the next successful check.
5. **Fail fast at start-up.** A database that cannot be reached within 5 seconds
   makes the process exit with an error rather than hang (the driver default is
   30 s). The same short timeout makes requests fail quickly during an outage.
6. **Redis being absent is not fatal.** A gateway starts and serves its own
   clients with no Redis, and picks up relaying when Redis appears.

## Consequences

- **Good:** every failure scenario tested now ends with all edits present and all
  copies converged, and no single client can crash a gateway.
- **Trade-off (decision 4):** a person removed during a database outage stays
  connected until it ends. The stricter alternative turns a database blip into a
  total outage.
- **Trade-off (decision 3):** the periodic resync costs one stored-document read
  per open room per minute, and a silent relay loss can persist for up to a
  minute. A durable relay (Redis Streams with per-room sequence numbers) would
  remove both, at the price of more moving parts.
- **Trade-off (decision 2):** if a gateway dies while "dirty" and no client holds
  a copy, those edits are gone. In practice clients keep their data in
  IndexedDB and resend on reconnect (tested in F3).
- **Not covered:** slow (not dead) dependencies, half-open connections, a
  reconnect storm, and two faults at once. See FAULT-INJECTION.md.

## Alternatives considered

- **Queue every failed update in memory:** unbounded growth during a long outage.
- **Refuse writes while the database is down:** would stop everyone typing for
  the length of a blip, and clients would have to buffer.
- **Replace Redis pub/sub with a durable log now:** the right long-term answer
  for the relay, but a larger change than the failures justified.
- **Crash and let a supervisor restart:** acceptable as a last resort, but for
  malformed input it lets any member knock out every other user on that gateway.
