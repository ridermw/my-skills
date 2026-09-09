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
| **Teams** | One card per *conversation*: cadence-aware coverage age, partial captures, missing artifacts, known gaps, and index reconciliation needs. Only actual capture gaps enter the sweep plan; disputed identities and incomplete index records stay visible without inventing missing captures. |
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

## Read-only, by design

The canvas never writes to the room and holds no external-service credentials. Its action
buttons (Ingest inbox, Refresh room, Sweep, Re-capture, Save a nugget, Make a
task, Reconcile index) **generate an instruction for you to read and run** —
Index, Refresh and reconciliation name the relevant `project-room` operation
file, so the skill owns those maintenance procedures.

Room content is treated as untrusted data throughout: it is HTML-escaped in the
UI and quoted in generated prompts. Sweep plans carry bounded, escaped JSON in
a labelled untrusted-data block; inspect generated instructions before running
them with an authenticated agent.

## Local access

Each server creates a private launch URL with two random capabilities in its
fragment. The public HTML contains neither capability nor the selected room
path. Keep the complete launch link private: the full capability authorizes
room selection and file reads through the API header.

Image URLs use a separate image-only capability. It cannot authorize room,
folder, or text-file access, and query tokens never authorize the main API.
Cross-site requests are refused even with a capability. This is an HTTP
access boundary, not isolation from processes that can inspect the CLI's
memory or private launch-link records.

Manifest-selected files must remain inside the room, including through
symlinks. Source paths use consistent separators, file previews are bounded,
and unrecognised source layouts are reported as unverified rather than clean.

## Testing

From the repository root, install development dependencies and run the
filesystem/parser, real HTTP, SDK-action, and browser regressions:

```bash
npm ci
npm run test:canvas
npm run test:canvas:browser
```

The tests use Node's built-in runner (Node 22.15 or newer) and Playwright with
synthetic rooms. If Chromium is not installed, run
`npx playwright install chromium` before the browser suite. These dependencies
are development-only; copying this extension does not require an npm install.

`serve.mjs` runs the same request handler as the real extension (both delegate
to `routes.mjs`). From this extension's directory:

```bash
node serve.mjs 7900 /path/to/room   # a specific room
node serve.mjs 7900 -               # no room, exercises the picker
PROJECT_ROOM=/path/to/room node serve.mjs 7900
```

Open the complete private URL printed by the launcher, including its fragment.
Opening only the loopback origin does not authorize access to a room.
