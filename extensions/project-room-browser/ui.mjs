// The canvas UI: a single self-contained HTML document.
// Data arrives from the extension's local API, so this file is pure rendering.

const HOST_THEME_CSS = `:root {
  /* Raw palette, aliased straight from the host's canvas theme variables. These
     are live var() references, so when the app's theme changes the whole panel
     re-cascades on its own -- no picker, no persistence, no reload. Fallbacks
     apply only when this runs outside the app (serve.mjs). */
  --bg: var(--background-color-default, #0d1117);
  --fg: var(--text-color-default, #e6edf3);
  --ansi-k: var(--text-color-muted, #484f58);
  --ansi-bright-k: var(--border-color-default, #6e7681);
  --ansi-r: var(--true-color-red, #ff7b72);
  --ansi-bright-r: var(--true-color-red-muted, #ffa198);
  --ansi-g: var(--true-color-green, #3fb950);
  --ansi-bright-g: var(--true-color-green-muted, #56d364);
  --ansi-y: var(--true-color-yellow, #d29922);
  --ansi-bright-y: var(--true-color-yellow-muted, #e3b341);
  --ansi-b: var(--true-color-blue, #58a6ff);
  --ansi-bright-b: var(--true-color-blue-muted, #79c0ff);
  --ansi-m: var(--true-color-purple, #bc8cff);
  --ansi-bright-m: var(--true-color-purple-muted, #d2a8ff);
  --ansi-c: var(--true-color-cyan, #39c5cf);
  --ansi-bright-c: var(--true-color-cyan-muted, #56d4dd);
  --ansi-w: var(--text-color-muted, #b1bac4);
  --ansi-bright-w: var(--color-white, #f0f6fc);
  --font-ui: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  --font-code: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);

  /* Semantic layer -- the only thing the application stylesheet may use. */
  --color-bg: var(--bg);
  --color-surface: color-mix(in srgb, var(--bg) 92%, var(--fg));
  --color-surface-raised: color-mix(in srgb, var(--bg) 86%, var(--fg));
  --color-border: var(--border-color-default, color-mix(in srgb, var(--fg) 18%, transparent));
  --color-border-strong: color-mix(in srgb, var(--fg) 32%, transparent);
  --color-fg: var(--fg);
  --color-text-muted: var(--text-color-muted, var(--ansi-w));
  --color-text-disabled: color-mix(in srgb, var(--fg) 35%, transparent);
  --color-accent: var(--ansi-b);
  --color-accent-fg: var(--bg);
  --color-link: var(--ansi-b);
  --color-link-hover: var(--ansi-bright-b);
  --color-focus-ring: var(--color-focus-outline, var(--ansi-bright-b));
  --color-selection-bg: color-mix(in srgb, var(--ansi-b) 28%, transparent);
  --color-hover-bg: color-mix(in srgb, var(--fg) 8%, transparent);
  --color-active-bg: color-mix(in srgb, var(--fg) 14%, transparent);
  --severity-error: var(--ansi-r);
  --severity-warn: var(--ansi-y);
  --severity-ok: var(--ansi-g);
  --severity-info: var(--ansi-b);
  --severity-muted: var(--ansi-w);
  --severity-alt: var(--ansi-m);
  --tint-error: color-mix(in srgb, var(--ansi-r) 15%, transparent);
  --tint-warn: color-mix(in srgb, var(--ansi-y) 15%, transparent);
  --tint-ok: color-mix(in srgb, var(--ansi-g) 15%, transparent);
  --tint-info: color-mix(in srgb, var(--ansi-b) 15%, transparent);
  --tint-alt: color-mix(in srgb, var(--ansi-m) 15%, transparent);
  --tint-muted: color-mix(in srgb, var(--ansi-w) 15%, transparent);
}`;

export function renderShell({ roomPath, roomName, token = "" }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(roomName || "Project room")}</title>
<meta name="canvas-token" content="${esc(token)}" />
<style id="host-theme-aliases">${HOST_THEME_CSS}</style>
<style>
/* THEME RULE -- do not violate:
   Host variables (--background-color-default / --text-color-default) are read in JS
   for DETECTION ONLY, to choose light vs dark. They must NEVER appear as token values.
   Mixing a host-supplied background with our own hardcoded surfaces produced a light
   page with dark controls and unreadable text. Each palette below is self-contained. */
/* Alias layer.
   Every colour below resolves to a semantic token from <style id="canvas-theme">,
   which the server generates from the active theme. Nothing here invents a
   colour, so the panel is whatever theme the user picked -- nothing else. */
:root {
  --cp-bg: var(--color-bg);
  --cp-bg-elevated: var(--color-bg);
  --cp-surface: var(--color-surface);
  --cp-surface-soft: var(--color-surface-raised);
  --cp-panel: var(--color-surface);
  --cp-panel-strong: var(--color-active-bg);
  --cp-overlay: var(--color-hover-bg);
  --cp-sheen: transparent;
  --cp-border: var(--color-border);
  --cp-border-strong: var(--color-border-strong);

  --cp-text: var(--color-fg);
  /* Both muted aliases use the surface-safe pick: these land on cards and
     controls, not just the page background. */
  --cp-text-muted: var(--color-text-muted);
  --cp-text-soft: var(--color-text-muted);
  --ui-muted: var(--color-text-muted);

  --cp-accent: var(--color-accent);
  --cp-accent-hover: var(--color-link-hover);
  --cp-accent-soft: var(--tint-info);
  --cp-accent-fg: var(--color-accent-fg);
  --cp-link: var(--color-link);
  --cp-highlight: var(--tint-info);

  --cp-success: var(--severity-ok);
  --cp-danger: var(--severity-error);
  --cp-warning: var(--severity-warn);

  --ink-blue: var(--severity-info);
  --ink-green: var(--severity-ok);
  --ink-amber: var(--severity-warn);
  --ink-red: var(--severity-error);
  --ink-purple: var(--severity-alt);
  --ink-gray: var(--severity-muted);
  --tint-blue: var(--tint-info);
  --tint-green: var(--tint-ok);
  --tint-amber: var(--tint-warn);
  --tint-red: var(--tint-error);
  --tint-purple: var(--tint-alt);
  --tint-gray: var(--tint-muted);

  --cp-shadow: 0 8px 24px var(--color-active-bg);
  --shadow-card: 0 1px 0 var(--color-border);
  --r-sm: 4px; --r-md: 6px; --r-lg: 8px;
  --t-state: 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Contract extras that are easy to miss: focus affordance and scrollbars must
   also come from theme tokens, not browser defaults. */
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
::selection { background: var(--color-selection-bg); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--color-surface); }
::-webkit-scrollbar-thumb { background: var(--color-border-strong); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }


* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--cp-bg); color: var(--cp-text);
  /* Type comes from the host contract too, so the panel matches the app's
     typography, not just its colours. */
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--text-body-medium, 14px);
  line-height: var(--leading-body-medium, 20px);
  -webkit-font-smoothing: antialiased;
}
code, pre, .mono { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
:where(a, button, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--cp-accent); outline-offset: 2px; border-radius: var(--r-sm);
}
a { color: var(--cp-link); }

/* A side panel spends most of its life between 400 and 900px, so the sidebar has
   to survive that range rather than collapse inside it. Collapsing at 820px meant
   it was almost never a sidebar, and it dumped the rail's footer -- "Change
   room", a rare secondary action -- into the middle of the content as a
   full-width button. */
#app { display: grid; grid-template-columns: 188px minmax(0, 1fr); height: 100vh; }
@media (max-width: 520px) {
  #app { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
}

/* ---------- rail ---------- */
.rail {
  border-right: 1px solid var(--cp-border); background: var(--cp-bg-elevated);
  padding: 14px 10px; display: flex; flex-direction: column; gap: 3px; min-height: 0; overflow-y: auto;
}
.rail .room { padding: 0 8px 14px; }
.rail .room h1 { font-size: 15px; margin: 0 0 4px; letter-spacing: -.01em; word-break: break-word; }
.rail .room .sub { font-size: 11.5px; color: var(--ui-muted); }
.rail button.nav {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; text-align: left; border: none; background: transparent; cursor: pointer;
  font: inherit; color: var(--ui-muted); padding: 7px 9px; border-radius: var(--r-md);
}
.rail button.nav { transition: background var(--t-state), color var(--t-state); }
.rail button.nav:hover { background: var(--cp-surface-soft); color: var(--cp-text); }
.rail button.nav[aria-current="true"] { background: var(--cp-accent); color: var(--cp-accent-fg); font-weight: 600; }
.rail button.nav .n { font-size: 11.5px; opacity: .85; font-variant-numeric: tabular-nums; }
.rail .foot { margin-top: auto; padding: 10px 4px 0; border-top: 1px solid var(--cp-border); }
/* Quiet by design: changing room is rare, and it used to read as the loudest
   control on the page once the rail collapsed. */
.rail .foot .btn.switch {
  width: 100%; font-size: 11.5px; padding: 5px 8px; margin-bottom: 6px;
  background: transparent; border-color: transparent; color: var(--ui-muted); font-weight: 400;
}
.rail .foot .btn.switch:hover { background: var(--cp-surface-soft); color: var(--cp-text); }
/* One line, not a wall of path. The full value stays in the title attribute. */
.rail .foot .rootpath {
  font-size: 10px; color: var(--ui-muted); line-height: 1.3;
  font-family: var(--font-code, Consolas, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left;
}

/* ---------- main ---------- */
.main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.pane { display: none; min-height: 0; flex: 1; }
.pane.on { display: flex; flex-direction: column; }
.scroll { overflow-y: auto; padding: 20px 24px 40px; }

h2.head { font-size: 19px; margin: 0 0 4px; letter-spacing: -.015em; }
p.headsub { margin: 0 0 20px; color: var(--ui-muted); font-size: 13px; max-width: 80ch; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 22px; }
.card {
  background: var(--cp-surface); border: 1px solid var(--cp-border); border-radius: var(--r-lg); padding: 14px 15px;
  box-shadow: var(--shadow-card);
}
.card .k { font-size: 11.5px; color: var(--ui-muted); margin-bottom: 6px; }
.card .v { font-size: 24px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.card .v small { font-size: 12px; font-weight: 600; color: var(--ui-muted); letter-spacing: 0; }

.sec { margin-bottom: 24px; }
.sec > h3 { font-size: 13px; margin: 0 0 10px; letter-spacing: -.005em; }

table.kv { width: 100%; border-collapse: collapse; font-size: 13px; }
table.kv td { padding: 7px 10px 7px 0; border-bottom: 1px solid var(--cp-border); vertical-align: top; }
table.kv td.k { color: var(--ui-muted); width: 190px; white-space: nowrap; }
table.kv tr:last-child td { border-bottom: none; }

.flag {
  border: 1px solid var(--cp-border); border-radius: var(--r-lg); padding: 12px 14px; margin-bottom: 10px;
  background: var(--cp-surface);
}
.flag h4 { margin: 0 0 6px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
.flag p { margin: 0; font-size: 12.5px; color: var(--ui-muted); line-height: 1.55; }
.flag ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--ui-muted); }
.flag li { margin-bottom: 3px; }
/* flagged items are destinations, not just labels */
.flag li button.flagitem {
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
  background: none; border: none; padding: 1px 4px; margin-left: -4px;
  border-radius: var(--r-sm); color: var(--cp-link);
  text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 2px;
  transition: text-decoration-color var(--t-state), background var(--t-state);
}
.flag li button.flagitem:hover {
  text-decoration-color: currentColor; background: var(--cp-surface-soft);
}
.flag.warn { border-color: var(--ink-amber); }
.flag.bad { border-color: var(--ink-red); }
.flag.ok { border-color: var(--ink-green); }
.repolist { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.repo {
  border: 1px solid var(--cp-border); border-radius: var(--r-lg);
  background: var(--cp-surface); padding: 11px 13px;
}
.repo .rmain { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.repo .rname { font-weight: 600; font-size: 13px; }
.repo .rpath {
  font-family: Consolas, "Courier New", Courier, monospace; font-size: 11px;
  color: var(--ui-muted); word-break: break-all;
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.dot.warn { background: var(--cp-warning); }
.dot.bad { background: var(--cp-danger); }
.dot.ok { background: var(--cp-success); }

/* Under 520px the rail becomes a horizontal tab strip. Stacking five full-width
   rows cost ~340px of vertical space before any content appeared. */
@media (max-width: 520px) {
  .rail {
    flex-direction: row; align-items: center; gap: 2px;
    border-right: none; border-bottom: 1px solid var(--cp-border);
    padding: 6px 8px; overflow-x: auto; overflow-y: hidden;
  }
  .rail .room { padding: 0 8px 0 2px; flex: 0 0 auto; max-width: 34vw; }
  .rail .room h1 { font-size: 12.5px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rail .room .sub { display: none; }
  .rail button.nav { width: auto; flex: 0 0 auto; padding: 5px 9px; gap: 5px; }
  .rail .foot {
    margin-top: 0; margin-left: auto; padding: 0 0 0 8px;
    border-top: none; border-left: 1px solid var(--cp-border);
    display: flex; align-items: center; flex: 0 0 auto;
  }
  .rail .foot .btn.switch { width: auto; margin: 0; white-space: nowrap; }
  .rail .foot .rootpath { display: none; }
}

/* ---------- inventory ---------- */
.invwrap { display: grid; grid-template-columns: minmax(0, 40%) minmax(0, 1fr); min-height: 0; flex: 1; }
.invwrap.solo { grid-template-columns: 1fr; }
/* Declared here, above the responsive block below, because a later declaration
   of equal specificity silently overrides a media query. This rule used to sit
   further down the file and pinned the tree to 320px at every width -- the
   collapse rule never won. */
.filewrap { display: grid; grid-template-columns: minmax(0, 30%) minmax(0, 1fr); min-height: 0; flex: 1; }
.backbar { display: none; }
/* Below this the two panes swap instead of sitting side by side, so a selected
   row always has somewhere to go. Kept low: a side panel is usually 400-900px,
   and collapsing at 1100 meant it was never actually two panes. */
@media (max-width: 720px) {
  .invwrap, .filewrap { grid-template-columns: 1fr; }
  .invwrap .list, .invwrap .detail,
  .filewrap .tree, .filewrap .viewer { grid-column: 1; grid-row: 1; }
  .invwrap:not(.showdetail) .detail,
  .filewrap:not(.showdetail) .viewer { display: none; }
  .invwrap.showdetail .list,
  .filewrap.showdetail .tree { display: none; }
  .invwrap .list, .filewrap .tree { border-right: none; }
  .backbar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid var(--cp-border); background: var(--cp-bg-elevated);
  }
}

.toolbar { padding: 14px 18px 10px; border-bottom: 1px solid var(--cp-border); background: var(--cp-bg-elevated); }
.searchrow { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
input[type="search"], select {
  font: inherit; font-size: 13px; padding: 7px 10px; border-radius: var(--r-md);
  border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--cp-text);
}
input[type="search"] { flex: 1; min-width: 0; }
.count { font-size: 12px; color: var(--ui-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.facets { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font: inherit; font-size: 11.5px; padding: 4px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--ui-muted);
}
.chip { transition: background var(--t-state), border-color var(--t-state), color var(--t-state); }
.chip:hover { border-color: var(--cp-border-strong); color: var(--cp-text); }
.chip[aria-pressed="true"] { background: var(--cp-accent); border-color: var(--cp-accent); color: var(--cp-accent-fg); font-weight: 600; }
.chip .c { opacity: .75; font-variant-numeric: tabular-nums; }

.list { overflow-y: auto; border-right: 1px solid var(--cp-border); padding: 8px; }
.invwrap.solo .list { border-right: none; }
.row {
  width: 100%; text-align: left; font: inherit; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: var(--r-md);
  padding: 9px 11px; display: block; margin-bottom: 2px; color: inherit;
}
.row { transition: background var(--t-state), border-color var(--t-state); }
.row:hover { background: var(--cp-surface-soft); }
.row[aria-current="true"] { background: var(--cp-surface-soft); border-color: var(--cp-accent); }
.row .r1 { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.row .id { font-family: Consolas, monospace; font-size: 11px; color: var(--ui-muted); flex: 0 0 auto; }
.row .nm { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .r2 { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.row .meta { font-size: 11px; color: var(--ui-muted); }

.badge {
  font-size: 10.5px; padding: 1px 7px; border-radius: 999px; font-weight: 600;
  border: 1px solid currentColor; background: transparent; white-space: nowrap;
}
/* Outline, not filled. A tinted fill of the same hue sits between the label and
   the page background and eats 1+ point of contrast, which several catalogue
   themes cannot spare. The hue already carries the meaning, so the text stays on
   the page background where the theme's own contrast guarantee holds. */
.b-blue { color: var(--ink-blue); }
.b-green { color: var(--ink-green); }
.b-amber { color: var(--ink-amber); }
.b-red { color: var(--ink-red); }
.b-purple { color: var(--ink-purple); }
.b-gray { color: var(--cp-text-muted); border-color: var(--cp-border); }

.detail { overflow-y: auto; padding: 18px 20px 40px; }
.detail .empty { color: var(--ui-muted); font-size: 13px; padding: 40px 0; text-align: center; }
.detail h3 { font-size: 16px; margin: 0 0 6px; letter-spacing: -.01em; }
.detail .path {
  font-family: Consolas, monospace; font-size: 11.5px; color: var(--ui-muted);
  word-break: break-all; margin-bottom: 12px;
}
.detail .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.field { margin-bottom: 14px; }
.field .fk { font-size: 11.5px; color: var(--ui-muted); margin-bottom: 4px; }
.field .fv { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.btn {
  font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: var(--r-md); cursor: pointer;
  border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--cp-text);
}
.btn { transition: border-color var(--t-state), color var(--t-state); }
.btn:hover { border-color: var(--cp-accent); color: var(--cp-accent); }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn[disabled]:hover { border-color: var(--cp-border); color: var(--cp-text); }

/* ---------- files ---------- */
.tree { overflow-y: auto; border-right: 1px solid var(--cp-border); padding: 10px; }
.tree .grp { font-size: 11.5px; color: var(--ui-muted); padding: 10px 8px 5px; display: flex; justify-content: space-between; }
.tree .f {
  width: 100%; text-align: left; font: inherit; font-size: 12.5px; cursor: pointer;
  background: transparent; border: none; border-radius: var(--r-sm); padding: 5px 9px; color: var(--ui-muted);
  display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
}
.tree .f { transition: background var(--t-state), color var(--t-state); }
.tree .f:hover { background: var(--cp-surface-soft); color: var(--cp-text); }
.tree .f[aria-current="true"] { background: var(--cp-accent); color: var(--cp-accent-fg); font-weight: 600; }
.tree .f .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree .f .sz { font-size: 10.5px; opacity: .8; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
/* room documents: name over filename, so you know which file you are reading */
.tree .f.doc { flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 9px; }
.tree .f.doc .nm { font-weight: 600; text-transform: capitalize; }
.tree .f.doc .sz {
  font-family: Consolas, "Courier New", Courier, monospace; opacity: .75;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.viewer { overflow-y: auto; padding: 20px 26px 60px; min-width: 0; }
.viewer .vhead {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--cp-border);
}
.viewer .vhead .p { font-family: Consolas, monospace; font-size: 12px; color: var(--ui-muted); word-break: break-all; }

/* ---------- markdown ---------- */
.md { font-size: 13.5px; line-height: 1.65; max-width: 82ch; }
.md h1 { font-size: 22px; margin: 22px 0 10px; letter-spacing: -.02em; }
.md h2 { font-size: 18px; margin: 22px 0 9px; letter-spacing: -.015em; }
.md h3 { font-size: 15px; margin: 18px 0 8px; }
.md h4 { font-size: 13.5px; margin: 16px 0 6px; }
.md h1:first-child, .md h2:first-child, .md h3:first-child { margin-top: 0; }
.md p { margin: 0 0 12px; }
.md ul, .md ol { margin: 0 0 12px; padding-left: 22px; }
.md li { margin-bottom: 4px; }
.md code { background: var(--cp-surface-soft); color: var(--cp-text); padding: 1px 5px; border-radius: var(--r-sm); font-size: 12px; }
.md pre {
  background: var(--cp-surface-soft); border: 1px solid var(--cp-border); border-radius: var(--r-md);
  padding: 12px 14px; overflow-x: auto; font-size: 12px; line-height: 1.55; margin: 0 0 14px;
}
.md pre code { background: none; padding: 0; }
.md blockquote {
  margin: 0 0 12px; padding: 2px 0 2px 14px; border-left: 1px solid var(--cp-border-strong);
  color: var(--cp-text-soft);
}
.md table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 0 0 14px; display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--cp-border); padding: 7px 10px; text-align: left; vertical-align: top; }
.md th { background: var(--cp-surface-soft); font-weight: 600; }
.md hr { border: none; border-top: 1px solid var(--cp-border); margin: 20px 0; }
.md a { word-break: break-word; }


/* ---------- picker ---------- */
.btn:active, .chip:active, .nav:active, .tree .f:active, .row:active { transform: translateY(1px); }
.btn:active { background: var(--cp-panel-strong); }
.chip:active, .nav:active { background: var(--cp-panel-strong); }
@media (prefers-reduced-motion: reduce) {
  .btn:active, .chip:active, .nav:active, .tree .f:active, .row:active { transform: none; }
}
.boot { display: grid; grid-template-columns: 224px 1fr; height: 100vh; }
.sk { background: var(--cp-panel-strong); border-radius: 6px; }
.sk-rail { border-radius: 0; border-right: 1px solid var(--cp-border); }
.sk-main { padding: 24px 28px; display: flex; flex-direction: column; gap: 14px; }
.sk-h { height: 26px; width: 40%; }
.sk-cards { height: 78px; }
.sk-l { height: 13px; } .sk-l.short { width: 55%; }
@media (prefers-reduced-motion: no-preference) { .sk { animation: pulse 1.4s ease-in-out infinite; } }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
@media (max-width: 560px) { .boot { grid-template-columns: 1fr; } .sk-rail { display: none; } }
.card .note { margin-top: 4px; font-size: 11px; line-height: 1.35; color: var(--ui-muted); }
/* Segmented control: one visible group, current option marked. */
.seg { display: flex; width: 100%; border: 1px solid var(--cp-border); border-radius: var(--r-md);
  overflow: hidden; background: var(--cp-surface); }
.seg-o { flex: 1 1 0; appearance: none; border: 0; background: transparent; cursor: pointer;
  padding: 6px 4px; font: inherit; font-size: 12px; line-height: 1.2; color: var(--cp-text-muted);
  transition: background var(--t-state), color var(--t-state); }
.seg-o + .seg-o { border-left: 1px solid var(--cp-border); }
.seg-o:hover { background: var(--cp-surface-soft); color: var(--cp-text); }
.seg-o:active { background: var(--cp-panel-strong); }
.seg-o[aria-checked="true"] { background: var(--cp-accent); color: var(--cp-accent-fg); font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--cp-accent); }
.seg-o:focus-visible { outline: 2px solid var(--cp-link); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .seg-o { transition: none; } }
/* ---- Teams page ---- */
.teamshead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 14px; }
.teamshead h2 { margin: 0 0 4px; font-size: 19px; letter-spacing: -0.01em; }
.teamshead .sub { margin: 0; font-size: 12px; color: var(--ui-muted); max-width: 62ch; line-height: 1.5; }
.theadacts { display: flex; gap: 8px; flex: 0 0 auto; }
.btn.primary { background: var(--cp-accent); color: var(--cp-accent-fg); border-color: var(--cp-accent); font-weight: 600; }
.btn.primary:hover { background: var(--cp-accent-hover); border-color: var(--cp-accent-hover); }
.btn.sm { font-size: 11.5px; padding: 4px 9px; }
.btn.ok { border-color: var(--cp-success); color: var(--cp-success); }

.promptout { margin: 0 0 16px; border: 1px solid var(--cp-border); border-radius: var(--r-md); background: var(--cp-surface); }
.phead { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 12px; border-bottom: 1px solid var(--cp-border); font-size: 13px; }
.pacts { display: flex; gap: 6px; }
.ptext { margin: 0; padding: 12px 14px; font-size: 12px; line-height: 1.55; white-space: pre-wrap;
  word-break: break-word; max-height: 340px; overflow: auto; color: var(--cp-text); }

.convs { display: grid; gap: 12px; }
.conv { border: 1px solid var(--cp-border); border-left: 3px solid var(--cp-border-strong);
  border-radius: var(--r-md); background: var(--cp-surface); padding: 13px 15px; }
.conv.bad { border-left-color: var(--ink-red); }
.conv.warn { border-left-color: var(--ink-amber); }
.conv.good { border-left-color: var(--ink-green); }
.convh { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.convh h4 { margin: 0 0 5px; font-size: 14.5px; line-height: 1.3; }
.convmeta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.convmeta .mi { font-size: 11.5px; color: var(--ui-muted); }
.convwhen { text-align: right; flex: 0 0 auto; display: flex; flex-direction: column; gap: 1px; }
.convwhen .wv { font-size: 12.5px; font-weight: 600; }
.convwhen.bad .wv { color: var(--ink-red); }
.convwhen.warn .wv { color: var(--ink-amber); }
.convwhen .wl { font-size: 10.5px; color: var(--ui-muted); text-transform: uppercase; letter-spacing: .04em; }
.conv .why { margin: 9px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--cp-text-soft); }
.cid { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; }
.cid code { font-size: 11px; color: var(--ui-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srcs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 10px 0 0; }
.srcs .lbl { font-size: 11px; color: var(--ui-muted); text-transform: uppercase; letter-spacing: .04em; margin-right: 2px; }
.chip.src { cursor: pointer; }
.probs { margin: 10px 0 0; padding-left: 17px; font-size: 12.5px; line-height: 1.6; color: var(--cp-text); }
.probs li { margin: 0 0 2px; }
.clean { margin: 10px 0 0; font-size: 12.5px; color: var(--ink-green); }
.convacts { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0 0; padding-top: 11px; border-top: 1px solid var(--cp-border); }
.gaps { display: grid; gap: 8px; }
.gap { border: 1px solid var(--cp-border); border-radius: var(--r-sm); padding: 9px 12px; background: var(--cp-surface); }
.gap .gk { font-size: 12.5px; font-weight: 600; margin: 0 0 2px; }
.gap .gd { font-size: 12.5px; line-height: 1.55; color: var(--cp-text-soft); }
.nav .n.warn { color: var(--ink-amber); font-weight: 600; }
/* Inside the selected nav the accent fill owns the foreground, so a severity
   hue there would be colour-on-colour. Inherit instead. */
.rail button.nav[aria-current="true"] .n,
.rail button.nav[aria-current="true"] .n.warn { color: inherit; opacity: 1; }
.card .v.good { color: var(--ink-green); }
.card .v.warn { color: var(--ink-amber); }
.card .v.bad  { color: var(--ink-red); }
.empty.big { max-width: 60ch; }
.empty.big p { font-size: 12.5px; line-height: 1.6; color: var(--ui-muted); margin: 9px 0 0; }
@media (max-width: 560px) {
  .convh { flex-direction: column; gap: 8px; }
  .convwhen { text-align: left; flex-direction: row; gap: 6px; align-items: baseline; }
  .theadacts { width: 100%; }
  .theadacts .btn { flex: 1 1 auto; }
}
/* ---- theme picker ---- */
.themebox { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; }
.tlbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ui-muted); }
.tsel { width: 100%; font: inherit; font-size: 12px; padding: 4px 6px; border-radius: var(--r-sm);
  border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--cp-text); }
.trow { display: flex; gap: 6px; align-items: center; }
.trow .seg { flex: 1 1 auto; }
.tlink { flex: 0 0 auto; background: none; border: 0; cursor: pointer; font: inherit; font-size: 11.5px;
  color: var(--cp-link); padding: 2px 4px; border-radius: var(--r-sm); }
.tlink:hover { text-decoration: underline; }
.twarn { margin: 2px 0 0; font-size: 11px; line-height: 1.45; color: var(--ink-amber); }
.tally { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; margin: 0 6px 6px 0;
  font-size: 12px; color: var(--ui-muted); background: transparent; border: 0; border-radius: 0; }
.tally .c { font-variant-numeric: tabular-nums; color: var(--cp-text); font-weight: 600; }
.tally + .tally { border-left: 1px solid var(--cp-border); padding-left: 12px; }
.picker { padding: 26px 28px 40px; max-width: 720px; grid-column: 1 / -1; justify-self: start; }
/* No rail is rendered with the picker, so collapse the two-column grid entirely. */
#app:not(:has(.rail)) { display: block; overflow: auto; }
.picker h2.head { margin-bottom: 4px; }
.pastebar { display: flex; gap: 8px; margin: 18px 0 6px; }
.pastebar input {
  flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 9px 12px;
  border-radius: var(--r-md); border: 1px solid var(--cp-border);
  background: var(--cp-surface); color: var(--cp-text);
  font-family: Consolas, "Courier New", Courier, monospace;
}
.pastebar button {
  font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; cursor: pointer;
  border-radius: var(--r-md); border: 1px solid var(--cp-accent);
  background: var(--cp-accent); color: var(--cp-accent-fg);
  transition: background var(--t-state);
}
.pastebar button:hover { background: var(--cp-accent-hover); }
.pickerr { color: var(--ink-red); font-size: 12.5px; margin: 4px 0 0; min-height: 16px; }
.psec { margin-top: 22px; }
.psec > h3 { font-size: 12.5px; margin: 0 0 9px; }
.crumbs {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-family: Consolas, monospace; font-size: 11.5px; color: var(--ui-muted); margin-bottom: 8px;
}
.crumbs button {
  font: inherit; font-size: 11.5px; background: none; border: none; cursor: pointer;
  color: var(--cp-link); padding: 2px 4px; border-radius: var(--r-sm);
}
.crumbs button:hover { background: var(--cp-surface-soft); }
.dirlist {
  border: 1px solid var(--cp-border); border-radius: var(--r-md);
  max-height: 330px; overflow-y: auto; background: var(--cp-surface);
}
.dirlist button {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; text-align: left; font: inherit; font-size: 13px; cursor: pointer;
  background: none; border: none; border-bottom: 1px solid var(--cp-border);
  padding: 9px 13px; color: var(--cp-text); transition: background var(--t-state);
}
.dirlist button:last-child { border-bottom: none; }
.dirlist button:hover { background: var(--cp-surface-soft); }
.dirlist .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dirlist .up { color: var(--ui-muted); font-family: Consolas, monospace; }
.roomgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.roomgrid button {
  text-align: left; font: inherit; cursor: pointer; color: inherit;
  background: var(--cp-surface); border: 1px solid var(--cp-border);
  border-radius: var(--r-md); padding: 11px 13px;
  transition: border-color var(--t-state), background var(--t-state);
}
.roomgrid button:hover { border-color: var(--cp-accent); }
.roomgrid .n { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
.roomgrid .p {
  font-family: Consolas, monospace; font-size: 10.5px; color: var(--ui-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;   /* truncate the front, keep the room name */
}

/* ---------- narrow panel ---------- */
@media (max-width: 560px) {
  #app { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .rail { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; }
  .rail .room { padding: 0 6px 0 0; flex: 1 1 100%; }
  .rail button.nav { width: auto; flex: 1 1 auto; justify-content: center; padding: 6px 10px; }
  .rail .foot { margin-top: 0; flex: 1 1 100%; padding: 6px 0 0; }
  .rail .foot .rootpath { display: none; }

  .picker { padding: 18px 16px 32px; }
  .pastebar { flex-direction: column; align-items: stretch; }
  .pastebar button { width: 100%; }
  .roomgrid { grid-template-columns: 1fr; }
  .dirlist { max-height: 260px; }
  .crumbs { font-size: 11px; }

  .scroll { padding: 14px 14px 32px; }
  .toolbar { padding: 10px 12px 8px; }
  .searchrow { flex-wrap: wrap; }
  .searchrow input[type="search"] { flex: 1 1 100%; order: -1; }
  .facetgroup .glabel { min-width: 100%; }
  .cards { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
  .repolist { grid-template-columns: 1fr; }
  .detail, .viewer { padding: 14px 14px 32px; }
}
.loading { padding: 40px; text-align: center; color: var(--ui-muted); font-size: 13px; }
.skeleton { padding: 18px 20px; }
.skeleton .sk {
  height: 11px; border-radius: var(--r-sm); margin-bottom: 10px;
  background: linear-gradient(90deg, var(--cp-surface-soft) 25%, var(--cp-border) 37%, var(--cp-surface-soft) 63%);
  background-size: 400% 100%; animation: shimmer 1.4s ease-in-out infinite;
}
.skeleton .sk.w40 { width: 40%; } .skeleton .sk.w70 { width: 70%; }
.skeleton .sk.w90 { width: 90%; } .skeleton .sk.tall { height: 22px; margin-bottom: 16px; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .skeleton .sk { animation: none; background: var(--cp-surface-soft); }
  * { transition-duration: .01ms !important; }
}
img.preview { max-width: 100%; height: auto; border: 1px solid var(--cp-border); border-radius: var(--r-md); }
.binmsg { padding: 28px 20px; color: var(--ui-muted); font-size: 13px; line-height: 1.6; }
.binmsg strong { color: var(--cp-text); }
.facetgroup { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px; }
.facetgroup .glabel {
  font-size: 11px; color: var(--ui-muted); min-width: 62px; font-weight: 600;
}
.facethint { font-size: 11px; color: var(--ui-muted); margin: 6px 0 0; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.err {
  margin: 20px; padding: 14px 16px; border: 1px solid var(--ink-red); border-radius: var(--r-lg);
  background: var(--cp-surface); font-size: 13px; line-height: 1.6;
}
.err h3 { margin: 0 0 6px; font-size: 14px; color: var(--ink-red); }

.empty { color: var(--ui-muted); font-size: 13px; padding: 40px 20px; text-align: center; }
.detail .path, .scroll .path { font-family: Consolas, monospace; font-size: 11.5px; color: var(--ui-muted); word-break: break-all; }
.chip .badge { border: none; padding: 0; font-size: 11.5px; }
.rail button.nav > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker button.room .p { font-family: Consolas, monospace; font-size: 11px; color: var(--ui-muted); margin-top: 3px; word-break: break-all; }
</style>
</head>
<body>
<div id="app"><div class="boot" role="status" aria-label="Loading room"><div class="sk sk-rail"></div><div class="sk-main"><div class="sk sk-h"></div><div class="sk sk-cards"></div><div class="sk sk-l"></div><div class="sk sk-l"></div><div class="sk sk-l short"></div></div></div></div>
<script>
window.__ROOM_PATH__ = ${jsSafe(roomPath || "")};
</script>
<script src="/client.js"></script>
</body>
</html>`;
}

/** JSON for embedding inside a <script> element: escape HTML-significant and
 *  line-separator characters that JSON.stringify leaves intact. */
function jsSafe(v) {
    return JSON.stringify(v)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
