# ADR 0008: The canvas as one Yjs map, drawn by PixiJS

**Status:** accepted

## Context

A shared canvas has shapes that several people move, recolour, edit and delete at
the same time, plus connector lines that depend on shapes. It must stay smooth
with hundreds of objects.

## Decision: data

All objects live in one Yjs map, `objects`: `id` to a small `Y.Map` of fields
(`kind`, `x`, `y`, `w`, `h`, `text`, `color`, `from`, `to`, `z`).
`web/src/lib/canvasModel.ts` has no rendering code, so it is tested alone.

- **Each object is its own map**, so two people changing different fields of one
  shape (one moves it, one recolours it) both win. Two people moving the same
  shape end up with one of the two positions (Yjs order), never a corrupt one.
- **Connectors store the ids of two shapes**, not coordinates, so a line follows
  its shapes. Deleting a shape deletes its connectors in the same transaction.
  If a shape is deleted by someone else while a connector is created, the
  renderer skips connectors whose end no longer exists.
- **Reads never trust the stored shape**: unknown kinds are ignored, bad numbers
  fall back to defaults. Other clients, or older versions, wrote that data.
- **Undo** uses a Yjs `UndoManager` tracking only transactions tagged as local,
  so undo reverts your own changes and never someone else's.

Tests (`canvasModel.test.ts`): concurrent field edits, concurrent move and
delete, corrupt data, undo isolation, and a 1,000-operation random run on three
replicas that must converge.

## Decision: rendering

`web/src/lib/canvasRenderer.ts` draws with PixiJS 8 (WebGL). It keeps **no copy
of the data**: the Yjs document is the truth, and every change (local or remote)
flows document, sync, screen. Only objects whose data changed are redrawn, and a
pure move changes a position, not the drawing. Remote cursors keep a constant
on-screen size when zoomed.

Measured (one laptop, 120 Hz display): about 120 FPS with 506 objects while
idle, panning and dragging a shape; zooming dropped about 10 of 578 frames to
60 Hz pace. See [BENCHMARKS.md](../BENCHMARKS.md).

## Decision: accessibility

Every canvas action is reachable by keyboard: toolbar buttons, an object list
(select, arrow keys to move, Alt+arrows to resize, E to edit text, Delete), and
shortcuts on the board. Actions are announced through a polite live region. The
canvas is pixels, so the **object list is the accessible equivalent** of the
drawing; it shows the first 200 objects. Resize originally needed a mouse drag;
the accessibility pass found that and added the keyboard route. Verified with
axe and real key presses; **not** verified with a screen reader. See
[ACCESSIBILITY.md](../ACCESSIBILITY.md).

## Consequences

- **Cost:** `z` order uses a timestamp, so two people raising different shapes
  at the same instant can tie; ties are broken by id so everyone agrees.
- **Cost:** pointer movement writes to the shared document on every move (one
  small update per frame). It held 120 FPS in the test; very large boards or
  slow networks might want throttling.
- **Cost:** the canvas is not a good fit for text-heavy layout (Pixi text is
  drawn, not selectable); sticky notes are edited through an overlay.
- **Known:** the object list shows the first 200 objects only.

## Alternatives considered

- **SVG or DOM nodes:** simpler and accessible by default, but slower with
  hundreds of objects.
- **One big array or JSON blob of objects:** concurrent edits to different
  objects would conflict. A map of maps merges per field.
