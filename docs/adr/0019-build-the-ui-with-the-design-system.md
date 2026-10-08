# 0019. Build the UI with the design system (Meridian)

Status: accepted

## Context

The portfolio plan builds the design system (project 5, Meridian) first and has every other project install it
from npm. Synapse used to carry its own hand-written buttons, fields, dialogs, tabs and colours, which is the
duplication the design system exists to remove.

## Decision

Synapse installs `@yashwanthvarma74/react` and `@yashwanthvarma74/tokens` and builds its screens from them:
Button, Input, Textarea, Select, Dialog, Tabs, Menu, Badge, Avatar, Card, EmptyState and IconButton.

- **Tokens.** `web/src/styles/tokens.css` only gives Synapse's own variable names (`--bg`, `--accent`, ...) to the
  design system's `--mrd-*` tokens. It defines no colours of its own. A token change in the design system reaches
  Synapse with a package update.
- **Light only.** `<html data-theme="light">` is fixed. The library also has dark and high contrast; Synapse chose
  not to ship them.
- **What stays in Synapse.** The editor, the PixiJS board and its toolbar, chat bubbles, the version timeline and
  the "/" menu are product features, not general components. They are styled with the same tokens.
- **Contrast tests** read the colours from the design system's `tokens.css`, so they check the real values.

## Consequences

- Keyboard behaviour, focus traps, roving focus and ARIA wiring for dialogs, menus and tabs are tested once, in
  the design system, and inherited here. Synapse's own tests cover what it adds on top.
- Native `<dialog>` is gone: the design system's Dialog is a controlled, portalled component, so dialogs mount
  only while open. Menus close when a choice is made.
- Synapse cannot get ahead of the design system: a missing component is added there first.
