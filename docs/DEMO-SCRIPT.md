# Demo video script (60 to 90 seconds)

The brief asks for a short video that opens the README. This is a shot list you can record in one take
with the screen recorder built into macOS (Shift+Cmd+5). Practise once first; the offline part must be
smooth.

**Set up (before recording):** run `./dev.sh`. Open two browser windows side by side, one at
`http://localhost:3000` and one at `http://127.0.0.1:3000` (each address keeps its own sign-in, so they
are two different people). Close other tabs. Zoom the browser to 125% so text is readable in a video.

| Time | You do | You say (short, plain) |
|---|---|---|
| 0:00 | Left window: press **Try it now** | "Synapse is a notebook and whiteboard that works offline. I'll show it in 60 seconds." |
| 0:08 | Press **Share**, choose **Can edit**, **Create invite link**, **Copy link**. Paste it into the right window and press **Join now** | "I invite a second person with a link. No sign-up." |
| 0:20 | Point at "2 people here" and the coloured cursors. Type a sentence in the left window; it appears on the right | "We see each other live, with names on the cursors." |
| 0:30 | In **both** windows open **Try offline mode** and switch **Offline mode** on. The status says Offline | "Now both of us lose the internet." |
| 0:38 | Left: click the end of the same paragraph and type `Left edit.` Right: same spot, type `Right edit.` Show that neither window sees the other's words | "We both edit the same spot, offline." |
| 0:55 | Switch **Offline mode** off in both windows | "Reconnect." |
| 1:00 | Both screens show both edits, identical. Say the time (about a tenth of a second in the tests) | "Both edits are kept, both screens are identical, and it took a fraction of a second. Nothing was lost." |
| 1:10 | Open the whiteboard from the workspace, drag a shape in one window and show it moving in the other | "Same for the whiteboard." |
| 1:20 | Cut to the README table of results, then the test count | "The proof is in the tests: 10,000 random runs, all identical, and real browsers checking this exact demo." |

**Tips:** keep the cursor still while you talk; do not show your real email or any real password;
turn on Do Not Disturb so no notification pops up; export at 1080p and keep the file under 25 MB if you
want to embed it on GitHub.
