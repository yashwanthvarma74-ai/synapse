# ADR 0003: A hand-written WebSocket gateway instead of Socket.IO or Hocuspocus

**Status:** accepted

## Context

The browser needs a real-time connection to the server. Options: Socket.IO, a
ready-made Yjs server such as Hocuspocus or `y-websocket`, or plain WebSockets
with the Yjs protocol written directly.

## Decision

Plain WebSockets (`ws`) with `y-protocols`, written by hand in
`server/src/room.ts`, `server/src/gateway.ts` and `web/src/lib/collab/provider.ts`.

- The Yjs sync protocol is already binary and already handles catch-up after a
  reconnect (the state-vector handshake). Socket.IO's extra layers (rooms,
  acknowledgements, fallbacks) add little here.
- Writing it makes every step visible and explainable: open, send state vector,
  receive the missing updates, send ours, then live updates both ways.
- It lets role checks, access re-checks and persistence sit exactly where the
  application needs them (ADR 0002).

## Consequences

- **Good:** small surface (about 660 lines across `room.ts`, `gateway.ts` and `provider.ts`); no
  dependency doing something we do not understand; custom close codes (4403 for
  revoked access) reach the client.
- **Cost:** we own the bugs. Two real ones were found by tests (see ADR 0004 and
  the room lifecycle fix in `gateway.ts`: a room could be closed twice and a
  document could end up in two rooms).
- **Cost:** no built-in features. We wrote the heartbeat (30 s ping), the
  reconnect with exponential backoff and jitter, and throttled presence (80 ms)
  ourselves.
- **Cost:** a production system might still choose Hocuspocus to avoid this
  maintenance. It is a good reference implementation to compare against.

## Alternatives considered

- **Socket.IO:** rejected as above.
- **Hocuspocus / y-websocket:** good options, and the right answer if the goal
  were only to ship. Rejected here because understanding the protocol is part of
  the point.
