// Theme layer for the project-room canvas.
//
// Implements the canvas theme contract: the active theme's palette is injected
// server-side into the iframe as CSS custom properties, in two layers.
//
//   Layer 1 — raw palette (--bg/--fg/--ansi-*), derived straight from themes.json.
//             Reserved for deriving layer 2; application CSS must not use it.
//   Layer 2 — semantic tokens (--color-*, --severity-*), which is all the
//             application stylesheet is allowed to reference.
//
// Values are pre-computed rather than emitted as color-mix() at runtime: the
// contract allows either and calls pre-computed the safer default, and it also
// lets us measure real contrast in tests instead of guessing at a mix.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const DEFAULT_THEME = { themeName: "GitHub", variant: "dark" };

let CATALOGUE = null;

export async function catalogue() {
    if (!CATALOGUE) {
        CATALOGUE = JSON.parse(await readFile(new URL("./themes.json", import.meta.url), "utf8"));
    }
    return CATALOGUE;
}

/** Theme names a picker may offer, alphabetically. */
export async function themeNames() {
    return Object.keys(await catalogue()).sort((a, b) => a.localeCompare(b));
}

function copilotHome() {
    return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}
function themeFile() {
    return path.join(copilotHome(), "extensions", "project-room-browser", "artifacts", "theme.json");
}

/** Per-canvas, per-user choice. Absent or unparseable falls back to the default. */
export async function readTheme() {
    try {
        const raw = await readFile(themeFile(), "utf8");
        const j = JSON.parse(raw);
        const cat = await catalogue();
        if (j && cat[j.themeName] && (j.variant === "dark" || j.variant === "light")) {
            return { themeName: j.themeName, variant: j.variant };
        }
    } catch (e) {
        /* first run, or a corrupt file: fall through to the default */
    }
    return { ...DEFAULT_THEME };
}

export async function writeTheme(choice) {
    const cat = await catalogue();
    if (!cat[choice.themeName]) throw new Error("Unknown theme: " + choice.themeName);
    if (choice.variant !== "dark" && choice.variant !== "light") throw new Error("Unknown variant: " + choice.variant);
    const f = themeFile();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify({ themeName: choice.themeName, variant: choice.variant }, null, 2) + "\n", "utf8");
    return { themeName: choice.themeName, variant: choice.variant };
}

/* ---------- colour maths (pre-computing what color-mix would do) ---------- */

function parseHex(h) {
    let s = String(h || "").trim().replace(/^#/, "");
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** color-mix(in srgb, a P%, b) with both opaque. */
function mix(a, b, p) {
    const A = parseHex(a);
    const B = parseHex(b);
    if (!A || !B) return a;
    return toHex([0, 1, 2].map((i) => (A[i] * p + B[i] * (1 - p))));
}
/** color-mix(in srgb, c P%, transparent) -> rgba, so it still layers correctly. */
function alpha(c, p) {
    const C = parseHex(c);
    if (!C) return c;
    return `rgba(${C[0]}, ${C[1]}, ${C[2]}, ${Number(p.toFixed(3))})`;
}

/** Relative luminance + contrast, so tests can assert against real values. */
export function luminance(hex) {
    const c = parseHex(hex);
    if (!c) return null;
    const f = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export function contrast(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    if (l1 == null || l2 == null) return null;
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Resolve a theme name + variant into the two CSS layers. */
export async function resolveTheme(choice) {
    const cat = await catalogue();
    const entry = cat[choice.themeName] || cat[DEFAULT_THEME.themeName];
    const v = entry[choice.variant] || entry.dark || entry.light;
    const bg = v.bg;
    const fg = v.fg;
    const a = v.ansi || {};
    const ab = v.ansiBright || {};
    const contrastLevel = (v.meta && v.meta.contrastLevel) || "preferred";

    // Theme colours are used verbatim. Adjusting them would introduce values the
    // theme designer never chose; the contract's answer to a low-contrast theme is
    // to advise the user, not to silently override it (and the declared
    // meta.contrastLevel proved unreliable -- three "high" variants measure < 4.5:1,
    // so the advisory below is computed from the actual palette).
    const R = (h) => h;

    const sem = {
        "--color-bg": bg,
        "--color-surface": mix(bg, fg, 0.92),
        "--color-surface-raised": mix(bg, fg, 0.86),
        "--color-border": alpha(fg, 0.18),
        "--color-border-strong": alpha(fg, 0.32),
        "--color-fg": fg,
        "--color-text-muted": R(a.w || fg),
        "--color-text-disabled": alpha(fg, 0.35),
        // Muted text is often tuned to clear 4.5:1 against the page background
        // with no headroom, so the surface tint underneath a card pushes it
        // under. Pick between two colours the theme already defines rather than
        // inventing a third: keep muted where it survives, else fall back to the
        // theme's own foreground and let size/weight carry the hierarchy.
        "--color-text-muted-safe":
            (contrast(a.w || fg, mix(bg, fg, 0.92)) || 0) >= 4.5 ? a.w || fg : fg,
        "--color-accent": R(a.b || fg),
        "--color-accent-fg": (contrast(bg, R(a.b || fg)) || 0) >= 4.5 ? bg : fg,
        "--color-link": R(a.b || fg),
        "--color-link-hover": R(ab.b || a.b || fg),
        "--color-focus-ring": ab.b || a.b || fg,
        "--color-selection-bg": alpha(a.b || fg, 0.28),
        "--color-hover-bg": alpha(fg, 0.08),
        "--color-active-bg": alpha(fg, 0.14),
        "--severity-error": R(a.r || fg),
        "--severity-warn": R(a.y || fg),
        "--severity-ok": R(a.g || fg),
        "--severity-info": R(a.b || fg),
        "--severity-muted": R(a.w || fg),
        "--severity-alt": R(a.m || fg),
        // Tints for label fills: the same hue, faint enough to sit under its own text.
        "--tint-error": alpha(a.r || fg, 0.15),
        "--tint-warn": alpha(a.y || fg, 0.15),
        "--tint-ok": alpha(a.g || fg, 0.15),
        "--tint-info": alpha(a.b || fg, 0.15),
        "--tint-alt": alpha(a.m || fg, 0.15),
        "--tint-muted": alpha(a.w || fg, 0.15),
        "--theme-contrast-level": JSON.stringify(contrastLevel),
    };

    const raw = { "--bg": bg, "--fg": fg };
    for (const [k, val] of Object.entries(a)) raw["--ansi-" + k] = val;
    for (const [k, val] of Object.entries(ab)) raw["--ansi-bright-" + k] = val;

    // Measured, not declared. Measured against the raised SURFACE rather than the
    // page background, because that is where these actually land -- badges sit on
    // cards, not on bare background. Measuring the easier case would let the
    // advisory report "fine" for a theme the user can see is marginal.
    const lowContrast = [];
    const surface = sem["--color-surface"];
    for (const k of ["--color-fg", "--color-text-muted-safe", "--color-accent", "--severity-error", "--severity-warn", "--severity-ok", "--severity-alt"]) {
        const r = contrast(sem[k], surface);
        if (r != null && r < 4.5) lowContrast.push({ token: k, ratio: Number(r.toFixed(2)) });
    }

    return {
        name: cat[choice.themeName] ? choice.themeName : DEFAULT_THEME.themeName,
        variant: choice.variant,
        contrastLevel,
        lowContrast,
        raw,
        sem,
    };
}

/** The contents of <style id="canvas-theme">. */
export function themeCss(resolved) {
    const line = (o) => Object.entries(o).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    return [
        ":root {",
        "  /* layer 1 - raw palette, for deriving layer 2 and literal terminal content only */",
        line(resolved.raw),
        "",
        "  /* layer 2 - semantic tokens; application CSS uses only these */",
        line(resolved.sem),
        "}",
    ].join("\n");
}
