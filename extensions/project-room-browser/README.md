# project-room-browser

A **canvas extension** for GitHub Copilot CLI that browses a
[`project-room`](../../skills/project-room/) folder: source inventory, review
signals, room docs, files, and Teams conversation coverage.

> **This is not a skill.** Skills in [`skills/`](../../skills/) are portable
> markdown you copy into any agent. This is JavaScript that runs a local
> HTTP server and renders a UI, so it only works in Copilot CLI and needs
> Node. It is kept here so it stays in step with the skill it reads — the two
> encode the same rules, and when the skill's rules change this must follow.

## Install

```bash
cp -R extensions/project-room-browser ~/.copilot/extensions/project-room-browser
```

Then open it from an agent session, optionally with a room path:

```
open the project-room canvas for ~/project-rooms/<room>
```

## What it shows

| Page | Answers |
|---|---|
| **Overview** | Is this a valid room? What drift is there — inbox backlog, expired renders, inventory rows pointing at missing files, sources not safe to cite as current? |
| **Sources** | The inventory, faceted by Authority and Lifecycle, with full-text search. |
| **Room docs** | README, change log, conflict log, duplicate log, missing context. |
| **Teams** | One card per *conversation*: coverage age, partial captures, missing per-occurrence artifacts, known gaps, and captures the inventory holds but the chat index never registered. |
| **Files** | Every file in the room, with markdown/CSV rendered and images previewed. |

## Theming

The panel has no palette of its own. It reads the canvas theme catalogue
(`themes.json`, 54 themes x light/dark) and the active theme's colours are
injected server-side into `<style id="canvas-theme">` as two layers: the raw
palette, then the semantic tokens (`--color-*`, `--severity-*`) that the
application CSS is allowed to use. There are **zero colour literals** outside
that generated block.

- Pick a theme from the rail. The choice persists per-user at
  `$COPILOT_HOME/extensions/project-room-browser/artifacts/theme.json`, and
  defaults to `GitHub` / dark on first run.
- Changing theme swaps the style element's contents in place, so scroll
  position, the selected file and any typed search survive it.
- Theme colours are used **verbatim**. Where a theme's own hues fall below
  4.5:1 on a card, the picker says so rather than silently overriding the
  designer's choice. That advisory is measured from the palette, not read from
  `meta.contrastLevel`, which several themes declare optimistically -- three
  variants labelled `"high"` measure between 4.08 and 4.36:1.
- The one derived value is `--color-text-muted-safe`: muted text is often tuned
  to clear 4.5:1 against the page background with no headroom, so a card's
  surface tint pushes it under. It picks between two colours the theme already
  defines (muted, else the theme's foreground) rather than inventing a third.

## Read-only, by design

The canvas never writes to the room and holds no credentials. Its action
buttons (Ingest inbox, Refresh room, Sweep, Re-capture, Save a nugget, Make a
task, Reconcile index) **generate an instruction for you to read and run** —
they name the relevant `project-room` operation file rather than restating the
procedure, so the skill stays the single source of truth.

Room content is treated as untrusted data throughout: it is HTML-escaped in the
UI, and quoted inside a labelled data block in every generated prompt, so a
source cannot pose as an instruction to whichever agent you paste it into.

## Testing

`serve.mjs` runs the same request handler as the real extension (both delegate
to `routes.mjs`, so the test server cannot drift from production):

```bash
node serve.mjs 7900 /path/to/room   # a specific room
node serve.mjs 7900 -               # no room, exercises the picker
PROJECT_ROOM=/path/to/room node serve.mjs 7900
```
