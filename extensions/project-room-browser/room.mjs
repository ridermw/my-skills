// Reads a project-room folder from disk and turns it into structured JSON.
// No dependencies: hand-rolled CSV and a minimal YAML subset reader, because
// the room format is stable and small enough not to warrant a parser package.

import { readFile, readdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { parseChatIndex, teamsHealth } from "./teams.mjs";

/* ---------------- CSV ---------------- */
// Handles quoted fields, escaped quotes, and newlines inside quotes, which the
// inventory relies on heavily (key-claims cells contain both commas and quotes).
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let started = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
            started = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
            started = true;
        } else if (c === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
            started = false;
        } else if (c !== "\r") {
            field += c;
            started = true;
        }
    }
    if (started || field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function csvToObjects(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => {
        const o = {};
        header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
        return o;
    });
}

/* ---------------- YAML (minimal subset) ---------------- */
// room.yaml is flat `key: value` plus one level of nested map. That is all this
// handles on purpose; anything richer should not live in a room manifest.
function stripComment(v) {
    // only treat ` #` as a comment start, so values containing '#' survive
    const i = v.search(/\s+#/);
    return (i === -1 ? v : v.slice(0, i)).trim();
}

const unquote = (v) => {
    const t = String(v).trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
};

/**
 * Split a scalar from its trailing comment WITHOUT cutting inside quotes.
 * The previous version trimmed at the first " #", so `title: "design #1"`
 * silently became "design" and there was no way to escape it.
 */
function scalarAndComment(rest) {
    const t = String(rest);
    let quote = null;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === "#" && (i === 0 || /\s/.test(t[i - 1]))) {
            return t.slice(0, i).trim();
        }
    }
    return t.trim();
}

/**
 * Parse the subset of YAML a room manifest actually uses:
 * scalars, nested maps one level deep, sequences of scalars, sequences of maps,
 * inline [a, b] lists, and block scalars (| and >).
 *
 * Everything here exists because a real manifest silently lost data: a repo
 * list parsed to {}, a list-of-maps dropped every path, quoted values were cut
 * at a '#', block scalars vanished, and a BOM ate the first key.
 */
export function parseSimpleYaml(text) {
    const out = {};
    // A BOM makes trimStart() report indent 1, which orphaned the first key.
    const lines = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");

    let currentKey = null;      // top-level key currently being filled
    let seqItem = null;         // the map currently being built inside a sequence
    let block = null;           // { key, indent, fold, lines } while reading | or >

    const finishBlock = () => {
        if (!block) return;
        const body = block.lines;
        out[block.key] = block.fold ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n").replace(/\n+$/, "");
        block = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, "");
        const indent = line.length - line.trimStart().length;

        if (block) {
            // a block scalar continues while lines stay more-indented (or blank)
            if (!line.trim() || indent > block.indent) {
                block.lines.push(line.slice(Math.min(indent, block.indent + 2)));
                continue;
            }
            finishBlock();
        }

        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // sequence item
        const seq = trimmed.match(/^-\s*(.*)$/);
        if (seq && currentKey) {
            if (!Array.isArray(out[currentKey])) {
                out[currentKey] = Object.keys(out[currentKey] || {}).length ? out[currentKey] : [];
            }
            if (!Array.isArray(out[currentKey])) continue;
            const item = seq[1];
            const asMap = item.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
            if (asMap) {
                // "- name: alpha" opens a map item; its siblings follow indented
                seqItem = { [asMap[1]]: unquote(scalarAndComment(asMap[2])) };
                out[currentKey].push(seqItem);
            } else if (item) {
                seqItem = null;
                out[currentKey].push(unquote(scalarAndComment(item)));
            }
            continue;
        }

        const m = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (!m) continue;
        const [, key, rest] = m;

        // a sibling of the current sequence-map item
        if (seqItem && indent > 0 && Array.isArray(out[currentKey])) {
            seqItem[key] = unquote(scalarAndComment(rest));
            continue;
        }

        if (indent === 0) {
            seqItem = null;
            const value = scalarAndComment(rest);
            if (value === "|" || value === ">" || /^[|>][-+]?$/.test(value)) {
                block = { key, indent, fold: value.startsWith(">"), lines: [] };
                currentKey = null;
            } else if (value === "") {
                out[key] = {};
                currentKey = key;
            } else if (/^\[.*\]$/.test(value)) {
                out[key] = value
                    .slice(1, -1)
                    .split(",")
                    .map((x) => unquote(x.trim()))
                    .filter(Boolean);
                currentKey = null;
            } else {
                out[key] = unquote(value);
                currentKey = null;
            }
        } else if (currentKey && out[currentKey] && !Array.isArray(out[currentKey]) && typeof out[currentKey] === "object") {
            out[currentKey][key] = unquote(scalarAndComment(rest));
        }
    }
    finishBlock();
    return out;
}

/**
 * A room can span several repositories, so normalise the manifest's various
 * spellings into one list. `target_repo` (scalar) is kept for compatibility.
 */
export function repoList(room) {
    const raw = [];
    for (const key of ["target_repo", "target_repos", "repos", "repositories"]) {
        const v = room[key];
        if (!v) continue;
        if (Array.isArray(v)) {
            for (const item of v) {
                if (item && typeof item === "object") {
                    const name = item.name || item.repo || item.label || null;
                    const loc = item.path || item.url || item.location || item.remote || null;
                    if (loc) raw.push((name ? name + "=" : "") + loc);
                    else if (name) raw.push(name);
                } else raw.push(item);
            }
        }
        else if (typeof v === "string") raw.push(...v.split(",").map((x) => x.trim()));
        else if (typeof v === "object") {
            // mapping form: name: path
            for (const [name, path_] of Object.entries(v)) raw.push(path_ ? name + "=" + path_ : name);
        }
    }
    const seen = new Set();
    return raw
        .map((r) => String(r).trim())
        .filter((r) => r && !seen.has(r) && seen.add(r))
        .map((entry) => {
            const eq = entry.indexOf("=");
            const label = eq > -1 ? entry.slice(0, eq).trim() : null;
            const loc = eq > -1 ? entry.slice(eq + 1).trim() : entry;
            const isUrl = /^(https?:|git@|ssh:)/i.test(loc);
            return { label, location: loc, isUrl, name: label || loc.replace(/\/+$/, "").split("/").pop() };
        });
}

/* ---------------- filesystem ---------------- */
const SKIP = new Set([".DS_Store", ".git", "node_modules", "Thumbs.db"]);

async function walk(dir, root, depth = 0, acc = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (SKIP.has(e.name) || e.name.startsWith("._")) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full);
        if (e.isDirectory()) {
            acc.push({ rel, name: e.name, dir: true });
            if (depth < 4) await walk(full, root, depth + 1, acc);
        } else if (e.isFile()) {
            let size = 0;
            let mtime = null;
            try {
                const s = await stat(full);
                size = s.size;
                mtime = s.mtime.toISOString().slice(0, 10);
            } catch {
                /* unreadable file still worth listing */
            }
            acc.push({ rel, name: e.name, dir: false, size, mtime, ext: path.extname(e.name).toLowerCase() });
        }
    }
    return acc;
}

async function readIfPresent(root, rel) {
    try {
        return await readFile(path.join(root, rel), "utf8");
    } catch {
        return null;
    }
}

function daysSince(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + "T00:00:00Z");
    const then = d.getTime();
    if (Number.isNaN(then)) return null;
    // 2026-02-30 passes the regex but rolls over to March, so confirm the date
    // round-trips before trusting any age computed from it.
    if (d.toISOString().slice(0, 10) !== iso) return null;
    return Math.floor((Date.now() - then) / 86400000);
}

/**
 * Read a room folder into the shape the UI consumes.
 */
/* The canonical header in SKILL.md calls column 10 "Current or superseded", but
   real rooms in the wild use "Lifecycle". Accept either and expose one name, so
   the facets, filters and the not-safe-to-cite warning work in both. */
function normaliseRow(r) {
    if (r.Lifecycle == null && r["Current or superseded"] != null) {
        return { ...r, Lifecycle: r["Current or superseded"] };
    }
    return r;
}

export async function readRoom(roomPath) {
    const root = path.resolve(roomPath);
    const s = await stat(root); // throws if missing — caller reports it
    if (!s.isDirectory()) throw new Error("Not a directory: " + root);

    const yamlText = await readIfPresent(root, "room.yaml");
    const room = yamlText ? parseSimpleYaml(yamlText) : {};

    // The manifest names where the inventory lives; fall back to convention.
    const invRel = room.maintenance_links?.inventory?.replace(/\.md$/, ".csv") || "02_inventory/source_inventory.csv";
    let invText = await readIfPresent(root, invRel);
    if (!invText) invText = await readIfPresent(root, "02_inventory/source_inventory.csv");
    const sources = invText ? csvToObjects(invText).map(normaliseRow) : [];

    const files = await walk(root, root);
    const byTop = new Map();
    for (const f of files) {
        if (f.dir) continue;
        const top = f.rel.split(path.sep)[0];
        const key = f.rel.includes(path.sep) ? top : "(root)";
        byTop.set(key, (byTop.get(key) || 0) + 1);
    }

    // Which inventory rows point at files that are no longer on disk, and which
    // files in a *source* folder were never inventoried.
    //
    // Only some folders hold sources. The rest are the room's own machinery:
    // per-source summaries, generated assets, tools, the inventory and the
    // review logs. Flagging those as "uninventoried" would bury the real
    // signal under ~90 false positives, so they are excluded by design.
    // 05_outputs holds the room's own drafts and is excluded from the inventory by
    // the skill, so treating it as a source directory reported every deliverable
    // as uninventoried drift.
    const SOURCE_DIRS = new Set(["00_originals", "01_inbox", "06_evidence"]);
    const INDEX_FILES = new Set(["README.md", "readme.md", "index.md"]);

    // Compare paths on a normalised key: macOS is case-insensitive and OneDrive
    // returns NFD, so raw string comparison reported false drift both ways.
    // Case-fold ONLY where the filesystem is case-insensitive. On Linux an
    // inventory row for "Report.md" must not be satisfied by "report.md" on disk,
    // because opening the inventoried path would fail. Unicode normalisation is
    // portable and stays unconditional (OneDrive hands back NFD).
    const foldCase = process.platform === "darwin" || process.platform === "win32";
    const key = (p) => {
        const n = String(p || "").normalize("NFC");
        return foldCase ? n.toLowerCase() : n;
    };
    const fileKeys = new Set(files.filter((f) => !f.dir).map((f) => key(f.rel)));
    const invKeys = new Set(sources.map((r) => key(r.Path)).filter(Boolean));
    const hasFile = (p) => fileKeys.has(key(p));
    const missingOnDisk = sources
        .filter((r) => r.Path && !hasFile(r.Path) && !/\[\s*REMOVED\b[^\]]*\]/i.test(r.Change || "") && !/^unavailable$/i.test((r.Lifecycle || "").trim()))
        .map((r) => ({ id: r["Source ID"], path: r.Path }));

    const inSourceDir = (rel) => SOURCE_DIRS.has(rel.split(path.sep)[0]);
    const uninventoried = files
        .filter((f) => !f.dir && !invKeys.has(key(f.rel)))
        .filter((f) => inSourceDir(f.rel))
        .filter((f) => !INDEX_FILES.has(f.name))
        .filter((f) => !f.rel.includes(path.sep + "_superseded" + path.sep))
        .map((f) => f.rel);

    // 01_inbox is the staging area, so anything sitting there uninventoried is
    // intake that has not been processed yet. Called out separately because it
    // is an action for the user, not drift.
    const inboxPending = uninventoried.filter((rel) => rel.startsWith("01_inbox" + path.sep));

    // If none of the expected source folders exist, the uninventoried check
    // covered nothing and a clean result would be meaningless.
    const topLevel = new Set(files.filter((f) => f.rel.includes(path.sep)).map((f) => f.rel.split(path.sep)[0]));
    const recognisedDirs = [...SOURCE_DIRS].filter((d) => topLevel.has(d));
    const unrecognisedLayout = recognisedDirs.length === 0 && files.length > 0;

    const logs = {};
    for (const [key, rel] of Object.entries(room.maintenance_links || {})) {
        if (typeof rel !== "string" || !rel.endsWith(".md")) continue;
        const text = await readIfPresent(root, rel);
        if (text != null) logs[key] = { rel, text };
    }
    for (const [key, rel] of [
        ["readme", "README.md"],
        ["change_log", "99_review/change_log.md"],
        ["conflict_log", "99_review/conflict_log.md"],
        ["duplicate_log", "99_review/duplicate_log.md"],
        ["missing_context", "99_review/missing_context.md"],
    ]) {
        if (logs[key]) continue;
        const text = await readIfPresent(root, rel);
        if (text != null) logs[key] = { rel, text };
    }

    const repos = [];
    for (const r of repoList(room)) {
        if (r.isUrl) {
            repos.push({ ...r, exists: null });
            continue;
        }
        const abs = path.resolve(untilde(r.location));
        let exists = false;
        let isGit = false;
        try {
            exists = (await stat(abs)).isDirectory();
            if (exists) {
                try {
                    await stat(path.join(abs, ".git"));
                    isGit = true;
                } catch {
                    /* a plain directory is still a valid target */
                }
            }
        } catch {
            exists = false;
        }
        repos.push({ ...r, resolved: abs, exists, isGit });
    }

    const expiry = parseInt(room.render_expiry_days || "", 10);
    const staleRenders = [];
    if (!Number.isNaN(expiry)) {
        for (const r of sources) {
            if (!/render/i.test(r.Authority || "")) continue;
            const age = daysSince(r.Date);
            if (age != null && age > expiry) staleRenders.push({ id: r["Source ID"], path: r.Path, date: r.Date, age });
        }
    }

    // Sources that must not be treated as current. The room's own review logs
    // record a runbook kept as "Historical (abandoned approach)" that still
    // contains app settings which are fatal if run, so lifecycle is a safety
    // signal here, not just bookkeeping.
    const NOT_CURRENT = /superseded|historical|abandoned/i;
    const notCurrent = sources
        .filter((s) => NOT_CURRENT.test(s.Lifecycle || ""))
        .map((s) => ({
            id: s["Source ID"],
            path: s.Path,
            authority: s.Authority,
            lifecycle: s.Lifecycle,
            // "in part" means some sections are still authoritative, so it is a
            // read-carefully case rather than a do-not-use case.
            partial: /in part/i.test(s.Lifecycle || ""),
            runnable: /runbook|procedure|script|playbook|\.py$|\.sh$|\.ps1$/i.test((s.Path || "") + " " + (s["Source type"] || "")),
        }));

    // Teams conversations are a first-class source class, indexed separately
    // from the file inventory: the inventory lists FILES, the chat index lists
    // CONVERSATIONS (a thread can span many captures, or none yet).
    const chatRel = room.maintenance_links?.chat_index || "02_inventory/chat-index.md";
    let chatText = await readIfPresent(root, chatRel);
    if (chatText == null) chatText = await readIfPresent(root, "02_inventory/chat-index.md");
    let teams = null;

    /* The chat index and the file inventory are maintained separately, so the
       index can fall behind. Reporting "last captured 15 days ago" while a newer
       transcript for the same 1:1 sits in the inventory is a false staleness
       reading, so cross-check the two and report the disagreement rather than
       trusting the index alone. */
    const CONVERSATION_ARTIFACT = /transcript|recap|1:1|1x1|chat|insights|meeting summary/i;
    function unregisteredCaptures(convs) {
        // Only tokens unique to ONE conversation can attribute a file, otherwise
        // two similarly-named threads would claim the same source.
        const tokenise = (s) =>
            String(s || "")
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((w) => w.length > 3 && !["with", "team", "weekly", "sync", "chat", "meeting"].includes(w));
        const counts = new Map();
        for (const c of convs) for (const w of new Set(tokenise(c.name))) counts.set(w, (counts.get(w) || 0) + 1);

        const registered = new Set();
        for (const c of convs) for (const s of c.sourceIds || []) registered.add(String(s).replace(/^\D+/, ""));

        const out = new Map();
        for (const c of convs) {
            const distinctive = [...new Set(tokenise(c.name))].filter((w) => counts.get(w) === 1);
            if (!distinctive.length) continue;
            for (const s of sources) {
                const id = String(s["Source ID"] || "");
                const num = (id.match(/S(\d+)/) || [])[1];
                if (!num || registered.has(String(Number(num))) || registered.has(num)) continue;
                const blob = ((s.Path || "") + " " + (s["Source type"] || "")).toLowerCase();
                if (!CONVERSATION_ARTIFACT.test(blob)) continue;
                if (!distinctive.some((w) => blob.includes(w))) continue;
                // Only newer material changes the staleness picture.
                if (c.lastCaptured && !(String(s.Date || "") > c.lastCaptured)) continue;
                if (!out.has(c.index)) out.set(c.index, []);
                out.get(c.index).push({ id, date: s.Date, path: s.Path, type: s["Source type"] });
            }
        }
        return out;
    }

    try {
        const idx = chatText ? parseChatIndex(chatText) : null;
        if (idx) {
            teams = { rel: chatRel, ...teamsHealth(idx) };
            const extra = unregisteredCaptures(teams.conversations);
            let n = 0;
            for (const c of teams.conversations) {
                c.unregistered = extra.get(c.index) || [];
                n += c.unregistered.length;
                // A newer unregistered capture means the index's own date, and
                // therefore the staleness verdict, cannot be trusted.
                if (c.unregistered.length) {
                    c.staleDateDisputed = true;
                    // The index's date is the only evidence for "stale", and a newer
                    // unregistered capture contradicts it. Leaving isStale set kept
                    // the thread in the sweep targets and kept offering Re-capture --
                    // the misleading action this is supposed to replace. Reconciling
                    // the index is the real work, so drop the stale claim and let
                    // the dispute itself carry the problem.
                    c.isStale = false;
                    c.hasProblem =
                        c.noCaptures ||
                        c.authoredIncomplete ||
                        c.incompleteCaptures.length > 0 ||
                        c.missingArtifacts.length > 0 ||
                        true; // the unregistered capture is itself the problem
                }
            }
            teams.counts.unregistered = n;
            teams.counts.stale = teams.conversations.filter((c) => c.isStale).length;
        }
    } catch (e) {
        teams = { rel: chatRel, error: String(e && e.message) };
    }

    return {
        root,
        name: room.project || path.basename(root),
        room,
        sources,
        columns: sources.length ? Object.keys(sources[0]) : [],
        files: files.filter((f) => !f.dir),
        folders: [...byTop.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
        logs,
        repos,
        teams,
        // Validity is separate from health: a folder with no manifest or no
        // inventory is not a healthy room, it is an unreadable one. Without
        // this, an empty folder scores a clean bill of health.
        valid: {
            hasManifest: Boolean(yamlText),
            hasInventory: Boolean(invText),
            inventoryRows: sources.length,
            isEmptyFolder: files.filter((f) => !f.dir).length === 0,
        },
        health: {
            refreshedDaysAgo: daysSince(room.last_refreshed),
            verifiedDaysAgo: daysSince(room.status_verified),
            renderExpiryDays: Number.isNaN(expiry) ? null : expiry,
            staleRenders,
            notCurrent,
            missingOnDisk,
            uninventoried,
            inboxPending,
            unrecognisedLayout,
            recognisedDirs,
        },
    };
}

/** Resolve a path inside the room, refusing anything that escapes it. */
function resolveInside(roomPath, rel) {
    const root = path.resolve(roomPath);
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("Refused: path escapes the room");
    }
    return target;
}

/**
 * Lexical containment is not enough: path.resolve leaves symlinks intact, so a
 * link inside the room could point anywhere. Compare the REAL paths too.
 */
async function assertInsideReal(roomPath, target) {
    let realRoot;
    let realTarget;
    try {
        realRoot = await realpath(path.resolve(roomPath));
    } catch {
        realRoot = path.resolve(roomPath);
    }
    try {
        realTarget = await realpath(target);
    } catch {
        return target; // does not exist yet; lexical check already passed
    }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        throw new Error("Refused: path escapes the room");
    }
    // Return the RESOLVED path so the caller reads that, not the original.
    // Reading the unresolved path would re-follow symlinks and reopen the race.
    return realTarget;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);
const TEXT_EXT = new Set([
    ".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm",
    ".js", ".mjs", ".ts", ".py", ".sh", ".bash", ".zsh", ".sql", ".kql", ".ini", ".cfg", ".toml",
    ".log", ".vtt", ".srt", ".env", ".gitignore", ".ps1", ".rb", ".go", ".rs", ".java", ".cs",
]);

const MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp",
    ".ico": "image/x-icon",
};

/** A NUL byte in the first 8KB is the standard heuristic for "not text". */
function looksBinary(buf) {
    const n = Math.min(buf.length, 8192);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
}

const MAX_TEXT = 2 * 1024 * 1024;

/**
 * Read one file from inside the room, classifying it so the UI never has to
 * render binary content as text. Returns { kind: "text" | "image" | "binary" }.
 */
export async function readRoomFile(roomPath, rel) {
    const target = await assertInsideReal(roomPath, resolveInside(roomPath, rel));
    const s = await stat(target);
    if (!s.isFile()) throw new Error("Not a file");

    const ext = path.extname(target).toLowerCase();
    const meta = { rel, size: s.size, ext, mtime: s.mtime.toISOString().slice(0, 10) };

    if (IMAGE_EXT.has(ext)) return { ...meta, kind: "image", truncated: false };

    const buf = await readFile(target);

    // UTF-16 declares itself with a BOM. Without this it decodes as UTF-8 and
    // renders as NUL-riddled mojibake, making a readable source look corrupt.
    const utf16 =
        buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
            ? buf[0] === 0xff
                ? "utf16le"
                : "utf16be"
            : null;
    if (utf16) {
        const slice = buf.subarray(0, MAX_TEXT);
        const le = utf16 === "utf16le" ? slice : slice.swap16();
        return { ...meta, kind: "text", encoding: utf16, truncated: buf.length > MAX_TEXT, text: le.toString("utf16le").replace(/^\uFEFF/, "") };
    }

    // Trust the bytes over the extension: an unknown extension holding text is
    // still readable, and a .md holding binary is not.
    if (!TEXT_EXT.has(ext) && looksBinary(buf)) return { ...meta, kind: "binary", truncated: false };

    const truncated = buf.length > MAX_TEXT;
    // Decoding a hard byte slice corrupts the character straddling the cut, so
    // walk back to a UTF-8 boundary before decoding.
    let end = Math.min(buf.length, MAX_TEXT);
    if (truncated) {
        let back = 0;
        while (end > 0 && back < 4 && (buf[end] & 0xc0) === 0x80) {
            end--;
            back++;
        }
    }
    return { ...meta, kind: "text", truncated, text: buf.subarray(0, end).toString("utf8").replace(/^\uFEFF/, "") };
}

/** Raw bytes for inline image preview. */
const MAX_RAW = 25 * 1024 * 1024;

export async function readRoomBytes(roomPath, rel) {
    const target = await assertInsideReal(roomPath, resolveInside(roomPath, rel));
    const s = await stat(target);
    if (!s.isFile()) throw new Error("Not a file");
    const ext = path.extname(target).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new Error("Refused: not an image");
    if (s.size > MAX_RAW) throw new Error("Refused: file exceeds the preview limit");
    return { buf: await readFile(target), mime: MIME[ext] || "application/octet-stream" };
}

/**
 * Sibling rooms, so the picker can offer them when no path is supplied.
 */
export async function listSiblingRooms(parentDir) {
    const out = [];
    let entries = [];
    try {
        entries = await readdir(parentDir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const full = path.join(parentDir, e.name);
        try {
            await stat(path.join(full, "room.yaml"));
            out.push({ name: e.name, path: full });
        } catch {
            /* not a room */
        }
    }
    return out;
}

async function isRoom(dir) {
    try {
        await stat(path.join(dir, "room.yaml"));
        return true;
    } catch {
        return false;
    }
}

/**
 * List sub-directories of `dir` for the picker's file browser. Directories
 * only: this never exposes file contents, and reading a room still goes
 * through readRoom/readRoomFile, which are scoped to the chosen root.
 */
export async function browseDir(dir) {
    const resolved = path.resolve(untilde(dir));
    const s = await stat(resolved);
    if (!s.isDirectory()) throw new Error("Not a directory");

    const entries = [];
    for (const e of await readdir(resolved, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const full = path.join(resolved, e.name);
        entries.push({ name: e.name, path: full, isRoom: await isRoom(full) });
    }
    entries.sort((a, b) => (a.isRoom === b.isRoom ? a.name.localeCompare(b.name) : a.isRoom ? -1 : 1));

    const parent = path.dirname(resolved);
    return {
        path: resolved,
        parent: parent === resolved ? null : parent,
        isRoom: await isRoom(resolved),
        entries,
    };
}

function untilde(p) {
    if (!p) return p;
    if (p === "~") return process.env.HOME || p;
    if (p.startsWith("~/")) return path.join(process.env.HOME || "", p.slice(2));
    return p;
}

/**
 * Likely places a project room lives, each checked cheaply so the picker can
 * open with real starting points rather than an empty dead end.
 */
export async function suggestStartingPoints() {
    const home = process.env.HOME || "";
    const candidates = [];

    // OneDrive/CloudStorage roots vary per tenant, so discover rather than guess.
    const cloud = path.join(home, "Library", "CloudStorage");
    try {
        for (const e of await readdir(cloud, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            candidates.push(path.join(cloud, e.name, "Documents"));
        }
    } catch {
        /* not a mac, or no cloud storage */
    }
    candidates.push(path.join(home, "Documents"), path.join(home, "git"), home, process.cwd());

    const seen = new Set();
    const roots = [];
    const rooms = [];
    for (const c of candidates) {
        if (!c || seen.has(c)) continue;
        seen.add(c);
        try {
            const s = await stat(c);
            if (!s.isDirectory()) continue;
        } catch {
            continue;
        }
        roots.push({ name: c.replace(home, "~"), path: c });
        // shallow hunt: <root>/*/10-project-rooms/* and <root>/*/*
        for (const found of await hunt(c, 5)) {
            if (!rooms.some((r) => r.path === found.path)) rooms.push(found);
        }
    }
    return { roots, rooms: rooms.slice(0, 30) };
}

/** Bounded breadth-first hunt for folders containing room.yaml. */
async function hunt(root, maxDepth) {
    const found = [];
    let level = [root];
    for (let depth = 0; depth < maxDepth && level.length; depth++) {
        const next = [];
        for (const dir of level.slice(0, 60)) {
            let entries = [];
            try {
                entries = await readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
                const full = path.join(dir, e.name);
                if (await isRoom(full)) found.push({ name: e.name, path: full });
                else next.push(full);
            }
            if (found.length > 30) return found;
        }
        level = next;
    }
    return found;
}
