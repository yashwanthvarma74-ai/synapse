# ADR 0006: Stateless gateways with Redis pub/sub

**Status:** accepted

## Context

One WebSocket server cannot serve unlimited people. Two people in the same room
may be connected to different servers, and a server can be added, restarted or
lost at any time.

## Decision

Gateways hold no truth of their own. MongoDB holds the truth (ADR 0004); a
gateway is a cache plus a relay.

- Each open room subscribes to a Redis channel (`synapse:room:<docId>`).
- When a gateway accepts an edit it applies it, publishes it, and persists it.
  Other gateways apply the relayed edit but do **not** persist it again (the
  gateway that received the edit is the one that stores it).
- Messages carry the sender gateway's id so a gateway ignores its own publishes.
- A second channel (`synapse:access`) carries access changes from the API so
  every gateway re-checks open sockets immediately (ADR 0002).
- A room closes 5 seconds after its last person leaves. A new room for the same
  document waits for the old one to finish saving, so it never loads stale data.

`bus.ts` defines the interface; `redisBus.ts` is production, an in-process
`LocalHub` is used in tests, and `NoBus` runs a single gateway with no Redis.

## Evidence

- Test: two gateways relay edits through real Redis (`gateway.test.ts`).
- Benchmark: relaying through Redis costs about 0.4 ms (0.82 to 1.25 ms at p95).
- Load test: 200 editors in one room on one gateway, no messages lost,
  about 30% of one core. See [BENCHMARKS.md](../BENCHMARKS.md).
- Test: rapid join/leave churn never splits a document into two rooms. Writing
  it exposed a real bug (an idle timer could fire twice and delete a newer room's
  entry), fixed in `gateway.ts`.

## Consequences

- **Good:** add gateways without coordination; any gateway can serve any room;
  losing a gateway only forces its clients to reconnect and re-sync.
- **Redis pub/sub is fire-and-forget.** A relayed message is lost if its
  subscriber is disconnected when it is published. Fault injection confirmed
  this, and showed it was worse than "missed until reconnect": the other
  gateway's in-memory copy stayed stale and nothing repaired it. It is now
  repaired by **anti-entropy** (see [ADR 0010](0010-failure-handling.md)): rooms
  re-read the stored state when the relay reconnects and every 60 seconds.
  Nothing is ever lost from MongoDB. **Remaining gap:** a loss with no
  disconnect (for example a dropped message) heals only at the next periodic
  resync, up to a minute. Per-room sequence numbers or Redis Streams would close
  that.
- **Cost:** a hot room's fan-out is quadratic (every edit goes to every other
  person). The load test measured it up to 200 editors; where it breaks was not
  found.
- **Cost:** every gateway with a room open holds the whole document in memory.

## What breaks first at 10x and 100x

Ordered by likelihood, as a hypothesis. Only the first was measured, and only
up to 200 editors; the rest are reasoning, not results:

1. **Fan-out CPU in one huge room.** Measured: 200 editors at 1 edit/s each
   (38,400 deliveries/s) used a mean of 21% and a peak of 29% of one core.
   Deliveries grow with the square of the editors, so a straight-line
   extrapolation puts one core at about 360 editors at 1 edit/s each, or about
   250 at 2 edits/s. **That is an extrapolation, not a measurement**; the real
   limit was not found and memory, the database and the network will interfere.
2. **One database write per edit**: batch updates per room.
3. **Memory per open large document** on each gateway.
4. **Redis pub/sub throughput**, then moving to sharded channels or streams.
5. **Reconnect storms** after a gateway restart: mitigated by jittered backoff.

## Alternatives considered

- **Sticky routing so a room lives on one gateway:** simpler fan-out, but a
  gateway becomes special and its loss takes rooms down.
- **Redis Streams** instead of pub/sub: durable and replayable, which would close
  the known gap. Reasonable next step.
