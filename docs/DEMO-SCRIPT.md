# Demo video script (about 85 seconds)

One take, recorded on the live site, showing the thing that makes Synapse different: two people edit the same
sentence while offline, reconnect, and nothing is lost. Everything below matches the current screens.

## Before you press record (10 minutes)

1. **Wake the server.** The backend sleeps when idle on the free tier. Open
   `https://synapse-server-ytcc.onrender.com/health` and wait for `{"ok":true,...}`. Do this a minute before
   recording, not during.
2. **Two people need two separate sign-ins.** Both windows are on the same website, so a normal second window
   would share the same guest. Use:
   - **Window A:** a normal Chrome window.
   - **Window B:** a Chrome **Incognito** window (or a second browser such as Safari).
3. **Window A must start signed out**, or you will see the dashboard and not the landing page. In Window A open
   `https://synapse-app-beta.vercel.app`, then DevTools > Application > Local Storage > clear it, and reload.
   You should see the big headline "Local first, real time collaborative workspace."
4. **Layout.** Put A and B side by side, each about 960 px wide, so both are visible at once. Zoom each to
   110% to 125% so the text is readable at 1080p. Close every other tab and hide the bookmarks bar.
5. **Quiet the screen.** Turn on Do Not Disturb. Do not show your email, a real password, or the Atlas or Render
   dashboards.
6. **Record.** macOS: `Shift+Cmd+5`, choose "Record Selected Portion", draw a 1920x1080 area (or record the
   full screen). Click the microphone option if you will talk live. Press Stop in the menu bar when done.
7. **The Welcome text may differ.** New workspaces on the live site get whatever text the deployed server has.
   The steps above do not depend on the exact words, only on the opening paragraph and the first heading.
8. **Rehearse the offline section twice.** It is the whole video. Everything else can be a little rough.

## The script

Say it as the engineer who built it: precise terms, no marketing words. The on-screen steps are the same as
before; only the narration is technical.

| Time | On screen (what you do) | What you say |
|---|---|---|
| **0:00** | Window A, the landing page. Hold still on the headline for 4 seconds. | "This is Synapse, a local-first, real-time collaborative editor. Documents and the canvas are Yjs CRDTs, so a client never needs the server's permission to apply an edit." |
| **0:09** | Click **Try it now**. The Welcome document opens. | "I enter as a guest. The API issues a signed token and provisions a workspace with a document and a whiteboard." |
| **0:15** | Click **Share**. Leave **Can edit** selected. Click **Create invite link**, then **Copy link**. | "Sharing is a role-scoped invite link: editor, commenter or viewer. Roles live in MongoDB and are enforced by the server, never stored in the document." |
| **0:23** | Click Window B. Paste the link in the address bar. Click **Join now, no sign up**. The same document opens. | "The second client joins with its own token and opens a WebSocket to a stateless gateway. The role is checked at upgrade and again on every incoming write." |
| **0:31** | Point at **2 people here**. In A, click at the end of the first heading under the opening paragraph and type a few words. Cut to B: the words appear with a coloured, named cursor. | "Each keystroke is applied to the local Yjs document first, persisted to IndexedDB, then sent as a binary update. The named cursors are awareness state, not document content." |
| **0:42** | In **both** windows, click **Try offline mode**, then **Offline mode**. The status changes to **Offline** in each. | "Now I partition both clients. The socket closes, but editing continues against the local replica." |
| **0:49** | In A, click at the end of the **opening paragraph** and type `Alice's edit.` In B, click at the **same spot** and type `Bob's edit.` Hold for a second. Neither window shows the other's words. | "Both replicas insert at the same position concurrently. Every operation carries a client ID and a logical clock, so this is a genuine concurrent edit." |
| **1:00** | Click **Offline mode** again in A, then in B. Both screens now show **both** edits, identical. | "On reconnect each client sends its state vector and receives only the updates it is missing. No rebase, no conflict resolution step: both inserts are kept in a deterministic order and the replicas converge." |
| **1:12** | Cut to the landing page. Scroll to **What sets it apart**. Pause on "10,000 / 10,000", then "0.82 ms". | "In the benchmark, 30 minutes of simulated offline typing merges in 44 to 58 milliseconds. 10,000 randomized concurrent-edit runs ended with identical state on every replica. Server fan-out is 0.82 milliseconds at p95 on loopback, and across two gateways through Redis pub/sub it is 1.25." |
| **1:25** | End card (hold 3 seconds). Plain white slide: **Synapse**, your name, and `github.com/yashwanthvarmakonduru/synapse`. | "The ADRs and the benchmark methodology are in the repository." |

Total: about 90 seconds and about 235 spoken words, so speak at an even pace and do not rush the reconnect
line (1:00), which is the one the whole demo exists for. If you run long, drop the 0:31 typing step first
and say its sentence over the 0:23 step.

### Terms to use, and what each one means if you are asked

| Say | Meaning |
|---|---|
| **local-first** | The replica on the device is the working copy; the server relays and stores but does not decide. |
| **CRDT (Yjs)** | A data type whose concurrent edits merge to the same result in any order, with no central ordering. |
| **replica** | One copy of the document, in one browser, with its own IndexedDB store. |
| **state vector** | A compact summary of which operations a replica has seen; the sync handshake exchanges them to find the missing updates. |
| **awareness** | Ephemeral presence data (cursor, name, colour) that is broadcast but never persisted in the document. |
| **stateless gateway** | The WebSocket server holds a cache and a relay, no truth of its own; MongoDB is the truth. Any gateway can serve any room. |
| **server-authoritative access** | Roles are checked on the server at upgrade and on every write; content merges, permissions do not. |
| **p95 on loopback** | The 95th percentile latency measured on one machine with no real network, so it shows the server's own cost. |

## How to navigate (cheat sheet)

- **Where each button is:** **Share** is top right of the document, next to **Download**. **Try offline mode** is
  the collapsed row just under the title, above the formatting toolbar. Click the row to open it, then the
  **Offline mode** button inside it.
- **Offline mode is per window.** Switching it on in A does nothing to B, so press it in both.
- **The status line** (small dot and a word, top right of the page) changes from **Connected** (green) to
  **Offline** (orange) when you switch it on. Wait for it before typing.
- **Same spot matters.** Click right at the end of the same sentence in both windows. If you click different
  places the merge still works, but it looks less dramatic.
- **If the second window shows the dashboard**, not the document: you opened the invite link in a window that
  already had a guest. Use Incognito or a different browser.

## If something goes wrong mid-take

- The link does not paste or Join fails: stop, take a breath, and start again from 0:12. Do not try to fix on
  camera.
- A window says **Connecting** for more than 5 seconds: the free-tier server was asleep. Cut, wait for
  `/health` to answer, and retake.
- You mistype: keep going. Real typing looks more convincing than a perfect take.

## Optional 15-second extension (only if you have time)

After the merge, click **Back to the workspace**, open **Sample board**, drag a sticky note in A and show it
move in B. Say: "The whiteboard works the same way." Put this before the landing page cut.

## After recording

- Trim the start and end in QuickTime (`Cmd+T`) or iMovie. Do not add music over the narration.
- Export at 1080p. Keep the file under 25 MB if you want to embed it in the GitHub README; otherwise upload
  it to YouTube as unlisted and link it at the top of the README.
- Replace the line "_to be recorded_" in the README with the link.
