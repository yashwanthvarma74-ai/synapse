# Synapse benchmarks

Everything here was measured with scripts in `server/bench/`; raw numbers are in
`server/bench/results/*.json`. Re-run with `cd server && npm run bench:<name>`.

## Read this first: what these numbers are and are not

- **One machine, loopback network.** Gateway, MongoDB, Redis and the load
  generators all ran on the same laptop. There is no real network round trip in
  any latency figure. Add your real RTT (often 20-100 ms) to get what users see.
  The numbers show the **server's own cost**, which is what the code controls.
- **Laptop on battery power**, other apps open. Treat results as indicative.
- Real components throughout: gateway as its own process, real MongoDB 9.0.2
  (every edit is persisted), real Redis 8.10.2 where noted. No mocks.
- Latency is measured with a shared clock in one process group (sub-millisecond).

| | |
|---|---|
| Machine | Apple M4 Pro, 14 cores, 24 GB RAM, macOS 27.0 |
| Runtime | Node v26.10.0 |
| Date | 2026-10-05 / 06 |

## Results against the targets

| Target (from the brief) | Result | Status |
|---|---|---|
| Remote update p95 < 250 ms | **0.82 ms** (one gateway), **1.25 ms** (two gateways via Redis) | Met, loopback only |
| Convergence < 2 s after a 5-minute partition | **13-18 ms** (5 min of edits), **44-58 ms** (30 min) | Met, loopback only |
| 100% identical across 1,000+ randomized runs | **10,000 runs**, 100% | Met (see note) |
| 50+ editors in one room, published | **50, 100 and 200 editors**, 0 messages lost | Met |
| Keystroke-to-paint p95 < 50 ms | **16.6 ms and 17.4 ms** (two clean runs, 300 keystrokes each, 20,000-word document) | Met |
| 60 FPS with 500+ canvas objects | **~120 FPS** on a 120 Hz display with 506 objects, including while panning and dragging a shape | Met |
| 99.9% availability (SLO) | **Cannot be measured locally** | See bottom |

## 1. Remote update propagation

How long from "A makes an edit" until "B has applied it". 1,000 edits at 20 per
second (faster than human typing, so conservative). `bench/propagation.ts`.

| Path | Delivered | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| A and B on the same gateway | 1000/1000 | 0.51 ms | 0.82 ms | 0.99 ms | 2.81 ms |
| A and B on different gateways (Redis pub/sub) | 1000/1000 | 0.87 ms | 1.25 ms | 1.51 ms | 4.58 ms |

Going through Redis adds roughly 0.4 ms. The path measured includes the role
check, applying the update, persisting it to MongoDB and fanning it out.

## 2. Convergence after a partition

Two people edit the same document with no connection, then reconnect. We time
from the moment of reconnect until both copies show identical text.
`bench/partition.ts`.

We simulate the **volume** of edits that a real offline period produces
(4 edits per second per person) instead of waiting minutes, because merge cost
depends on how many edits there are, not on how long the clock ran. A real
five-minute wait was not run.

| Simulated offline time | Edits per person | Document size | One person offline | Both offline |
|---|---|---|---|---|
| 1 min | 240 | 7 KB | 8 ms | 16 ms |
| 5 min | 1,200 | 30 KB | 13 ms | 18 ms |
| 30 min | 7,200 | 173 KB | 44 ms | 58 ms |

The Yjs handshake exchanges state vectors, so only the missing edits travel.

## 3. Randomized convergence ("identical hashes")

`bench/convergence.ts`: three replicas, random inserts, deletes and rich-text
formatting, random partial syncs, then a full sync. **10,000 runs, 62,608
random edits, 1.1 s. 100% passed both checks:**

1. **Content** (text plus formatting) identical across all replicas right after
   the sync round: 100%.
2. **Encoded bytes** identical once syncing goes quiet: 100%.

**A note on what "identical hash" means.** My first version compared raw bytes
right after one fixed sync schedule and failed after 2,771 runs. Investigation
showed the text, formatting and state vectors were identical; the difference was
tombstones for redundant formatting markers. Each replica tidies those locally,
and the tidy-up travels in the *next* sync round. So Yjs guarantees identical
**content** immediately and identical **bytes** after syncing settles, not
identical bytes at every instant. That is what the test now checks. In 10,000
runs only one needed a single extra round.

## 4. Load: many editors in one room

`bench/load.ts`. Every editor sends edits at a steady rate; every other editor
in the room receives each one. Clients run in 4 worker processes so the load
generator is not the bottleneck; the gateway is a separate process with real
MongoDB persistence. 30 seconds per run. (The brief suggests k6; this Node
harness is used because it speaks the Yjs protocol and reads update timestamps.)

| Editors | Edits/s each | Deliveries/s | Delivered | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| 50 | 2 | 4,809 | 100% (144,256/144,256) | 0.97 ms | 1.98 ms | 2.44 ms | 7.22 ms |
| 100 | 2 | 19,450 | 100% (583,506/583,506) | 1.85 ms | 5.09 ms | 7.26 ms | 11.83 ms |
| 200 | 1 | 38,427 | 100% (1,152,807/1,152,807) | 2.67 ms | 6.53 ms | 8.25 ms | 14.26 ms |

Gateway process during the runs:

| Editors | CPU mean | CPU peak | Memory (idle to peak) |
|---|---|---|---|
| 50 | 7% | 11.9% | 145 to 176 MB |
| 100 | 17% | 26.2% | 144 to 186 MB |
| 200 | 21% | 29.3% | 141 to 188 MB |

(CPU is a share of one core. The 100 and 200 editor rows report latency from a
sample of every 2nd and 4th message to keep results small; loss is counted on
all messages.)

Takeaway: a single gateway process held 200 simultaneous editors in one room
with no loss and about 30% of one core. The limit was not reached, so this does
**not** say where it breaks. A "what breaks first at 10x" answer needs a
heavier run (more editors, higher rates, a slower MongoDB).

## 5. Browser measurements

Run in the app's built-in browser (Chromium 152, device pixel ratio 2) on the same
laptop. The display refreshes at **120 Hz**, so one frame is 8.3 ms, and "60 FPS"
means no frame slower than 16.7 ms.

### Keystroke-to-paint (typing in a large document)

A 20,000-word document (500 paragraphs, 124,000 characters, made by
`bench/bigdoc.ts`, which reads `DEMO_EMAIL` and `DEMO_PASSWORD` from the environment) with the cursor at the end. 300 real key presses per run,
timed from the `keydown` event to just after the next paint
(`keydown` then `requestAnimationFrame` then a zero-delay timeout).

| Run | Keystrokes | p50 | p95 | p99 | max | Over 50 ms |
|---|---|---|---|---|---|---|
| 1 | 300 | 6.5 ms | 16.6 ms | 27.1 ms | 41.4 ms | 0 |
| 2 | 300 | 9.4 ms | 17.4 ms | 24.9 ms | 28.7 ms | 0 |

An earlier run, whose recorder was accidentally attached twice (so its
percentiles are less clean), was slower: p95 24.9 ms with one 54.2 ms outlier. So
expect some run-to-run variation, and the tail can briefly pass 50 ms.

How to read this: keys were sent back to back by the test tool, much faster than
a person types, so keystrokes can queue behind each other. That makes it
conservative. It also includes waiting for the next frame (up to 8.3 ms here).
It covers the whole local path: editor update, Yjs, the IndexedDB write and
sending to the gateway. A single 398-character paste took 32 ms to paint, as
expected for a large insert.

### Canvas frame rate with 506 objects

Frame spacing measured with `requestAnimationFrame` over 5 to 10 seconds per
scenario (a mix of rectangles, ellipses and sticky notes, canvas 777 x 560 CSS
pixels at 2x resolution).

| Scenario | Frames | Avg FPS | p95 frame | p99 frame | Over 16.7 ms | Over 33 ms |
|---|---|---|---|---|---|---|
| Idle | 359 | 119.7 | 9.3 ms | 9.4 ms | 0 | 0 |
| Panning | 599 | 119.8 | 9.2 ms | 9.4 ms | 0 | 0 |
| Zooming in and out | 578 | 115.6 | 9.1 ms | 16.7 ms | 10 | 0 |
| Dragging one shape (a shared-document write every frame) | 599 | 119.8 | 9.2 ms | 9.4 ms | 1 | 0 |

The page kept up with the 120 Hz display in every scenario; the worst frame was
17.5 ms, and zooming dropped about 10 of 578 frames to 60 Hz pace.

Limits of this measurement: input was scripted pointer and wheel events, not a
hand on a mouse. Frame spacing shows the page's main thread keeping up with the
display; it does not separately measure GPU time. It was not a Chrome DevTools
performance trace as the brief suggests, and it was one machine with one
display, so a slower laptop or a 60 Hz screen would give different numbers. The
test data is 506 objects; the brief's "500+" is met, but larger boards were not
tried.

## 6. Availability (99.9% SLO)

A 99.9% target is about 43 minutes of downtime a month. It can only be measured
against a deployed system over time (uptime checks plus the reconnect success
rate). Nothing local can show it. What exists locally: reconnect with backoff
and jitter, live access re-checks, and a `/health` endpoint to probe.

## Cost of the metrics

Switching metrics on costs roughly 1 to 3 points of gateway CPU and 12 MB of memory at 100 editors, with latency unchanged within noise (single runs; table in [OBSERVABILITY.md](OBSERVABILITY.md)). The numbers above were taken before metrics existed.

## What these benchmarks do not cover

Real network latency, a slower or lower-end machine, multiple regions, a MongoDB on another machine, very large
documents (1 MB+ of state), many *rooms* at once, and failure injection (killing
MongoDB or Redis mid-run).
