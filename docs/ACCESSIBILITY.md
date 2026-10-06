# Accessibility

Target: WCAG 2.2 level AA. This records what was tested, what was found and fixed,
what is protected by automated tests, and, importantly, **what has not been
verified**.

## Scope of verification

| Verified | How |
|---|---|
| Automated rule checks (WCAG 2.0 to 2.2, A and AA), every page | axe-core in **Chromium and WebKit** through Playwright (`e2e/tests/accessibility.spec.ts`, 16 checks) |
| Colour contrast of every theme colour | computed from the real stylesheet (`src/test/a11y.test.ts`); the app is **light-only** now (the dark theme was removed on request), so only one theme is tested |
| Keyboard operation, real key presses | Tab order, skip link, tabs, canvas flows, driven in the app's browser |
| Reflow at 320 px wide, no horizontal scrolling | all five pages |
| Component behaviour and ARIA wiring | jsdom tests with axe |
| **NOT verified: a real screen reader** | VoiceOver, NVDA and JAWS were **not** run (see below) |

## What the audit found, and the fix

The first axe run flagged the same three problems on every page; my own review and
extra checks found more. All were fixed and re-tested.

| # | Problem | Fix |
|---|---|---|
| 1 | White text on the dark-theme accent blue was 2.97:1 (needs 4.5:1): primary buttons, the selected tab, pressed toolbar buttons | Dark theme uses dark text on that blue (6.37:1) via a `--on-accent` token |
| 2 | No `<main>` landmark, so content sat outside any landmark | One `<main id="main">` for every page |
| 3 | `aria-label` on a plain `div` (the presence bar) | Replaced with a labelled list |
| 4 | **4 of the 7 avatar and cursor-label colours failed 4.5:1 with white text** (from 2.48 to 4.35). axe missed this because only some colours happened to be on screen | New palette, all at least 4.9:1, locked in by a test |
| 5 | Dark-theme error red was 4.19:1 | Separate dark-theme error colour (8.2:1) |
| 6 | No skip link | "Skip to main content" link, verified with real keys |
| 7 | Every page had the same title | Per-page titles ("Roadmap – Synapse"), set with Next.js metadata and refined once data loads |
| 8 | Comments/History tabs were half-built ARIA tabs (no panels, no arrow keys) | Proper tabs pattern: roving tabindex, arrows, Home/End, labelled panels (`Tabs.tsx`, with tests) |
| 9 | The offline button changed its label **and** used `aria-pressed` (reads as "Go online, pressed") | Constant name "Simulate offline", state in `aria-pressed`, plus "(on)" text so it is not colour only |
| 10 | Repeated "Resolve", "Delete", "Preview", "Restore" buttons had no context | Each names its target ("Delete comment by Yash", "Restore version First draft") |
| 11 | People shown as initials in a `span` | Names in a list; the initials are decoration (`aria-hidden`) |
| 12 | Back link was 21 px tall (minimum target is 24 px) | 24 px minimum on all controls; links in a labelled `<nav>` |
| 13 | Focus visibility relied on browser defaults; the editor had `outline: none` | One clear 2 px ring for every focusable element; the editor wrapper shows it |
| 14 | **Resizing a shape was possible only by dragging**, so no keyboard route (WCAG 2.1.1) | Alt+Arrow resizes the selected shape, announced; verified with real keys |
| 15 | Selected/pressed state was shown by colour only (lost in Windows high contrast) | Bold weight always; thick border in forced-colours mode (**untested**, see below) |
| 16 | Joining people were announced one by one on arrival | The first 2 seconds of joins are ignored; later joins and leaves are announced politely |
| 17 | The canvas had a very long `aria-label` | Short name "Canvas", with the instructions in a described-by paragraph |

Final state: **0 violations, 0 items needing review** on the sign-in (both modes),
dashboard, workspace, document (comments and history tabs) and canvas pages, in
**both** light and dark themes, including with search results shown and the canvas
text-edit box open.

## Update, 6 October 2026: changes since the first audit

The app changed a lot (landing page, guests, invite links, slash menu, uploads, AI summary, a
simpler vocabulary). Everything below was re-checked.

- **Dark theme removed.** Items 1 and 5 above were dark-theme problems and are now history; the
  light theme passes the same contrast tests. (Dark mode could be brought back; the tokens would need
  their contrast re-proved.)
- **Checks now run in real browsers on every change.** `e2e/tests/accessibility.spec.ts` scans the
  landing page, sign-in, dashboard, workspace, document (including with the **slash menu open** and
  with the **Share dialog open**), History tab, whiteboard and invite page with axe, in Chromium and
  WebKit, and runs a real keyboard test (skip link, then the editor). All 16 pass.
- **New findings from this work, all fixed:**

| # | Problem | Fix |
|---|---|---|
| 18 | Toolbar buttons had names that did not contain their visible words (WCAG 2.5.3 label in name) | Accessible names now equal the visible words |
| 19 | The whiteboard page had no level-1 heading | A visually hidden `h1` with the board's title; the visible title is an input, which is not a heading |
| 20 | **Slash menu: `aria-expanded` on the editor.** ARIA does not allow it on a text box (axe: `aria-allowed-attr`, critical) | Removed. The editor points at the highlighted option with `aria-activedescendant`, and a polite status message says the menu opened |
| 21 | **Slash menu: scrolled but not keyboard-reachable, and arrowing down did not scroll the highlighted row into view** (axe: `scrollable-region-focusable`; a real keyboard bug) | Compact one-line rows so all blocks fit; the highlighted row now scrolls into view |
| 22 | Dead invite links and missing documents had no page title or heading | Titles and headings added |

- **A browser difference, not a bug:** Safari (WebKit) does not tab to links unless a setting is
  turned on; Option+Tab is its shortcut. The keyboard test uses it for WebKit.
- **Renamed:** the "Simulate offline" button (item 9) is now **"Offline mode"**, with the same
  constant-name-plus-`aria-pressed` behaviour.
- **New interface parts checked with axe in jsdom:** the AI summary tab (labelled, polite live region,
  result shown as plain text); upload status messages are in a live region (`role="status"`, or
  `role="alert"` for an error).

## Keyboard map

| Where | Keys |
|---|---|
| Any page | Tab and Shift+Tab; the first stop is "Skip to main content" |
| Tabs (Comments, History) | Left and Right arrows, Home, End |
| Canvas, with the board focused | Arrows pan, or move the selected shape; Alt+Arrow resizes it; Delete removes; `+` `-` zoom; `0` resets the view; Ctrl or Cmd+Z undo (add Shift for redo); Enter edits the selected shape's text; Escape clears the selection or leaves connect mode |
| Canvas object list | Enter selects; arrows move; Alt+Arrow resizes; E edits text; Delete removes. In Connect mode, Enter on two objects joins them |
| Text edit box on a shape | Ctrl or Cmd+Enter saves; Escape cancels; focus returns to the canvas |

Verified with real key presses: the Tab order of the document page, the skip link,
tab arrows and Home, adding a shape and connecting two shapes using Enter only,
and resizing with Alt+Arrow. Each canvas action is announced in a polite live
region ("Added ellipse", "Connected", "Resized to 190 by 120").

## Automated regression tests (run with `cd web && npm test`)

- `src/test/a11y.test.ts` (24 tests): every text and background pair in both themes
  meets 4.5:1, the focus ring meets 3:1, and every avatar colour meets 4.5:1 with
  white text. It reads the real `globals.css`. I proved it can fail by putting the
  old white-on-blue colour back: the test then fails with "expected 2.967 to be at
  least 4.5".
- `Tabs.test.tsx`: tab order, ARIA wiring, arrows, wrap-around, Home/End.
- `Presence.test.tsx`: names for screen readers, decorative initials, polite
  announcements, nothing announced on arrival, focus never taken.
- `OfflineDemo.test.tsx`: a toggle whose name does not change.
- `LoginForm.test.tsx`: labelled fields, the error is announced and tied to the form.
- Each component test also runs axe (without the colour rule, which needs a real
  layout engine and is covered by the contrast tests instead).

`npm run lint` is clean.

## Re-running the browser audit

```bash
cd e2e && npx playwright test tests/accessibility.spec.ts --project=chromium --project=webkit
```

It starts its own copy of the app (see `e2e/playwright.config.ts`). axe is a dev dependency and is not shipped.

## NOT verified, and known limits

- **No screen reader was run.** Automated rules and key-press tests cannot tell
  you how VoiceOver, NVDA or JAWS actually speak the page: reading order,
  verbosity, how live regions interrupt, or how `role="application"` on the canvas
  changes browse mode. This is the most important gap. Someone should test with at
  least VoiceOver and one Windows reader before any accessibility claim is made.
- **The canvas drawing itself is pixels.** The shapes are not exposed individually
  to assistive technology; the **object list** is the accessible equivalent, and it
  shows only the first 200 objects. Connectors are not in the list (deleting a
  shape deletes its connectors). The whiteboard now has a **colour palette made of buttons**, so
  colour can be changed with the keyboard in principle, but I did not test that flow with real key presses.
- **Cursor labels and remote carets** inside the editor are visual only.
- **Forced-colours (Windows high contrast) styles are untested.** They were added
  from the standard approach and could not be emulated here.
- **No testing on touch screens or with voice control**; target sizes meet the 24 px
  minimum.
- **Reduced motion** is respected in CSS, but the app has almost no animation.
- **The comments panel refreshes every 5 seconds** without announcing new comments.
- **Browser coverage:** axe ran in Chromium and **WebKit** (the engine of Safari, not Safari itself). **Firefox was not run**: the Playwright build of Firefox would not start on this Mac (macOS 27.0), even when launched by hand; it is configured for CI on Linux, which has not run yet.
- **Text-only zoom** (a browser setting that enlarges text but not layout) was not
  tested. Normal browser zoom is covered by the 320 px reflow check, which equals
  400% zoom of a 1280 px window.
- **WCAG 2.2 criteria not assessed:** timing, captions and audio (the app has no
  media), and cognitive criteria such as consistent help.
