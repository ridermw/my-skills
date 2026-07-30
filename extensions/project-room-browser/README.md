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

The panel has no palette and no theme picker. It aliases the host's canvas
theme variables (`--background-color-default`, `--text-color-default`,
`--true-color-*`, `--font-sans`, `--font-mono`) into a raw layer, then derives
its semantic tokens (`--color-*`, `--severity-*`) from those. The application
stylesheet uses only the semantic layer and contains **no colour literals**.

Because every token is a live `var()` reference, **the panel follows the app's
theme automatically** — change the theme in GitHub and the whole surface
re-cascades with no JavaScript, no reload, and no loss of scroll position or
selection.

This replaced an earlier per-canvas picker backed by a bundled 54-theme
catalogue. That approach is deprecated across the canvas ecosystem: of the
showcase extensions that handle theming, none still ship a picker, and several
return `410 theme_selection_removed` from their old endpoints. Dropping it
removed the catalogue, the persistence file, two API routes and the picker UI.

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
