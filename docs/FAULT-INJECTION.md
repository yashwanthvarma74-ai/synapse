# Fault injection

What happens when parts of the system break while people are editing. Run with
`cd server && npm run test:fault` (about 90 seconds; needs `redis-server` and
`mongod` installed, but **not** running: the tests start private copies).

## How the tests work

- **Private infrastructure.** Each run starts its own Redis (port 6390) and
  MongoDB (port 27090) with temporary data folders, so killing them never touches
  your development databases.
- **Real processes.** Gateways run as separate Node processes. "Crash" means
  `SIGKILL`: no shutdown code runs, like a lost machine.
- **Real clients.** Test clients speak the same Yjs protocol as the browser and,
  for the recovery tests, reuse their local document the way a browser reuses its
  IndexedDB copy.
- **Predictions first, fixes second.** I wrote down what I expected for each
  scenario, ran everything against the code *before* fixing anything, then fixed
  what failed. The "before" column is real.

## Results

| # | Fault | Before the fixes | After | What fixed it |
|---|---|---|---|---|
| F1 | Redis dies for ~3 s, then returns | Passed (the Redis client library queues commands during a short outage) | Passed | none needed |
| F1b | Redis dies for 45 s, then returns | **Failed.** Another gateway never got the missed edits, and an edit made just after Redis returned was also missed | Passed (50 s) | Rooms re-read the stored state when the relay reconnects, and every 60 s |
| F2 | MongoDB dies, then returns | **Failed.** Live editing continued, but an edit typed during the outage was never stored (database held `before during-2`, missing `during-1`) | Passed (13 s) | Dirty flag plus retry that saves the room's full state when the database answers |
| F3 | Gateway `SIGKILL`ed right after 60 edits | Passed. Nothing lost: clients resent what the new gateway lacked | Passed (3 s) | none needed |
| F4 | Garbage, truncated and 9 MB WebSocket messages | **Failed: the gateway process crashed.** Any signed-in member could take the server down (tested as an editor; viewers reach the same message-handling code, but that was not tested separately) | Passed (2 s) | Per-socket guards: a bad message closes that socket only |
| F5 | Redis already down when a gateway starts | Passed | Passed | none needed |
| F6 | MongoDB already down when a gateway starts | **Failed.** It hung for 25+ seconds | Passed (5.4 s, exits with an error) | 5-second database connection timeout |

Also checked in F2: while the database was down, a **new** person's join was
refused (not crashed), live editing between existing people kept working, and
after the database returned a newcomer could join and saw everything.

Two fast tests in the regular suite (`npm test`) cover the same repairs without
real databases: a gateway that lost every relay message heals by re-reading the
store, and edits typed while the store rejects writes are saved once it recovers.

## What each failure taught

**F4 was the serious one.** A malformed sync message made the Yjs decoder throw
inside a WebSocket event handler. With no `try/catch` and no `error` listener,
that is an uncaught exception, so Node exits. One bad packet from any member
would drop every document on that gateway. (The test sent it as an editor. The
awareness path is open to every role, so viewers very likely could too.) Everything a client sends is now
treated as untrusted: a malformed message closes only that socket (code 1003),
socket errors such as an oversize message terminate only that socket, and a
malformed message arriving over Redis is logged and ignored.

**F2 showed the cost of a swallowed error.** The original code logged
"persist failed" and moved on, so the edit reached everyone live but was never
written. Queuing every failed update would use unbounded memory during a long
outage. Instead the room remembers only that it is "dirty" and, when the database
answers, writes its *entire current state* as one update. This is safe because
CRDT updates are idempotent: re-writing data that is already stored changes
nothing.

**F1b corrected my own prediction.** I expected "relay stops working after a
long outage". It does not: the Redis library reconnects by itself. What is lost
is every message published while the subscriber was disconnected (it backs off to
about 5 s between attempts), because Redis pub/sub keeps nothing for absent
subscribers. And nothing repaired that: the other gateway's in-memory copy stayed
stale, so even reconnecting browsers synced against stale data. The fix is
anti-entropy: re-read the store when the relay returns, and periodically as a
safety net.

## What these tests do not cover

- A **slow** database or Redis (as opposed to a dead one), and half-open network
  connections where a socket looks alive but delivers nothing.
- Redis failover, disk full, out-of-memory, and clock changes.
- A reconnect storm (hundreds of clients reconnecting after a restart). The
  browser client uses jittered backoff, but this was not load-tested.
- The **browser's** reconnect code under fault. It was checked by hand once
  (a gateway restart, the open page reconnected on its own), not by an automated
  test.
- Killing a gateway while it is the only holder of unsaved edits **and** no
  client kept a copy. F3 recovers because the clients still hold their data; if a
  user cleared their browser data and closed the tab, those edits are gone.
- Two simultaneous faults, or faults during a compaction.
- The API process. Only gateways were broken.

## Behaviour to know about

- **During a database outage, existing connections keep the role they had.** The
  gateway cannot look up roles, so a person removed from a workspace during the
  outage stays connected until the database returns and the next re-check runs.
  New joins are refused. This favours uninterrupted editing; the opposite choice
  (disconnect everyone when roles cannot be checked) is stricter but turns a
  database blip into a full editing outage.
- **A silent relay loss heals within about 60 seconds** (the periodic resync). A
  loss caused by a Redis disconnect heals as soon as the connection returns.
- The periodic resync costs one stored-document read per open room per minute.
