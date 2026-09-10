// Reads a project-room folder from disk and turns it into structured JSON.
// No dependencies: hand-rolled CSV and a minimal YAML subset reader, because
// the room format is stable and small enough not to warrant a parser package.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { parseChatIndex, teamsHealth, refreshTeamsHealth } from "./teams.mjs";
import { isoDateTime } from "./dates.mjs";
import { RoomReader } from "./reader.mjs";
import { untilde } from "./paths.mjs";

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
    if (inQuotes) throw new Error("Invalid CSV: unterminated quoted field");
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
            const asMap = item.match(/^([A-Za-z0-9_.-]+):(?=\s|$)\s*(.*)$/);
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

        const m = trimmed.match(/^([A-Za-z0-9_.-]+):(?=\s|$)\s*(.*)$/);
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

// Fixed per-room policy: count all encountered entries before exclusions.
// The next entry refuses the scan, never a partial/healthy coverage result.
const MAX_SCAN_ENTRIES = 10_000;

async function withReader(input, action) {
    if (input instanceof RoomReader) return action(input);
    const reader = await RoomReader.open(input);
    try {
        return await action(reader);
    } finally {
        await reader.close();
    }
}

async function walk(reader) {
    const acc = [];
    const pending = ["."];
    let examined = 0;
    while (pending.length) {
        const dir = pending.pop();
        // Stream one directory at a time; depth consumes queued paths, not handles.
        const entries = await reader.openDirectory(dir);
        try {
            for (;;) {
                const e = await entries.read();
                if (!e) break;
                if (examined === MAX_SCAN_ENTRIES) {
                    const error = new Error("Refused: room scan exceeds 10,000 examined entries; coverage is unverified");
                    error.code = "ROOM_SCAN_LIMIT";
                    throw error;
                }
                examined++;
                if (SKIP.has(e.name) || e.name.startsWith("._")) continue;
                const rel = path.join(dir, e.name);
                if (e.type === "directory") {
                    acc.push({ rel, name: e.name, dir: true });
                    pending.push(rel);
                } else if (e.type === "file") {
                    const file = await reader.openFile(rel);
                    try {
                        const s = file.stat;
                        if (s.type !== "file") throw new Error("Refused: room entry changed type during scan: " + rel);
                        const mtime = new Date(s.modifiedMs).toISOString().slice(0, 10);
                        acc.push({ rel, name: e.name, dir: false, size: s.size, mtime, ext: path.extname(e.name).toLowerCase() });
                    } finally {
                        await file.close();
                    }
                }
            }
        } finally {
            await entries.close();
        }
    }
    return acc;
}

const MAX_METADATA = 2 * 1024 * 1024;

async function readIfPresent(reader, rel) {
    try {
        const handle = await reader.openFile(rel);
        try {
            const s = handle.stat;
            if (s.type !== "file") throw new Error("Not a file: " + rel);
            const sizeError = "Refused: metadata exceeds the 2 MiB limit: " + rel;
            if (s.size > MAX_METADATA) throw new Error(sizeError);
            const buf = await handle.readPrefix(MAX_METADATA + 1);
            if (buf.length > MAX_METADATA) throw new Error(sizeError);
            return buf.toString("utf8");
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

async function fileIdentity(reader, rel) {
    try {
        const file = await reader.openFile(rel);
        try {
            return file.stat.type === "file" ? file.stat.identity : null;
        } finally {
            await file.close();
        }
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function daysSince(iso) {
    const then = isoDateTime(iso);
    return then == null ? null : Math.floor((Date.now() - then) / 86400000);
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
    return withReader(roomPath, readRoomFromReader);
}

async function readRoomFromReader(reader) {
    const root = reader.root;
    const now = Date.now();

    const yamlText = await readIfPresent(reader, "room.yaml");
    const room = yamlText ? parseSimpleYaml(yamlText) : {};
    if (room.maintenance_links !== undefined) {
        const links = room.maintenance_links;
        if (!links || typeof links !== "object" || Array.isArray(links)) {
            throw new Error("Invalid maintenance_links: expected a map of file paths");
        }
        for (const [key, rel] of Object.entries(links)) {
            if (typeof rel !== "string" || !rel.trim() || rel.includes("\0")) {
                throw new Error("Invalid maintenance_links." + key + ": expected a nonempty file path");
            }
        }
    }

    // The manifest names where the inventory lives; fall back to convention.
    const invRel = room.maintenance_links?.inventory?.replace(/\.md$/, ".csv") || "02_inventory/source_inventory.csv";
    let invText = await readIfPresent(reader, invRel);
    if (invText == null) invText = await readIfPresent(reader, "02_inventory/source_inventory.csv");
    const sources = invText ? csvToObjects(invText).map(normaliseRow) : [];

    const files = await walk(reader);
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

    // Resolve both host-native disk paths and room-format paths through the
    // filesystem: case/Unicode aliases count only when they name the same file.
    const fileKeys = new Map();
    for (const f of files) {
        if (!f.dir) fileKeys.set(f.rel, await fileIdentity(reader, f.rel));
    }
    const sourceKeys = new Map();
    for (const r of sources) {
        if (r.Path && !sourceKeys.has(r.Path)) sourceKeys.set(r.Path, await fileIdentity(reader, r.Path));
    }
    const invKeys = new Set([...sourceKeys.values()].filter((key) => key !== null));
    const hasFile = (p) => sourceKeys.get(p) != null;
    const missingOnDisk = sources
        .filter((r) => r.Path && !hasFile(r.Path) && !/\[\s*REMOVED\b[^\]]*\]/i.test(r.Change || "") && !/^unavailable$/i.test((r.Lifecycle || "").trim()))
        .map((r) => ({ id: r["Source ID"], path: r.Path }));

    const inSourceDir = (rel) => SOURCE_DIRS.has(rel.split(path.sep)[0]);
    const uninventoried = files
        .filter((f) => !f.dir && !invKeys.has(fileKeys.get(f.rel)))
        .filter((f) => inSourceDir(f.rel))
        .filter((f) => f.rel.split(path.sep).length !== 2 || !INDEX_FILES.has(f.name))
        .filter((f) => !f.rel.includes(path.sep + "_superseded" + path.sep))
        .map((f) => f.rel);

    // 01_inbox is the staging area, so anything sitting there uninventoried is
    // intake that has not been processed yet. Called out separately because it
    // is an action for the user, not drift.
    const inboxPending = uninventoried.filter((rel) => rel.startsWith("01_inbox" + path.sep));

    // If none of the expected source folders exist, the uninventoried check
    // covered nothing and a clean result would be meaningless.
    const topLevel = new Set(files.filter((f) => f.dir && !f.rel.includes(path.sep)).map((f) => f.rel));
    const recognisedDirs = [...SOURCE_DIRS].filter((d) => topLevel.has(d));
    const unrecognisedLayout = recognisedDirs.length === 0 && files.length > 0;

    const logs = {};
    for (const [key, rel] of Object.entries(room.maintenance_links || {})) {
        if (typeof rel !== "string" || !rel.endsWith(".md")) continue;
        const text = await readIfPresent(reader, rel);
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
        const text = await readIfPresent(reader, rel);
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
    const NOT_CURRENT = /superseded|historical|abandoned|\b(?:unknown|unavailable)\b/i;
    const isNotCurrent = (s) =>
        NOT_CURRENT.test(s.Lifecycle || "") || /^superseded$/i.test((s.Authority || "").trim());
    const notCurrent = sources
        .filter(isNotCurrent)
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
    let chatRel = room.maintenance_links?.chat_index || "02_inventory/chat-index.md";
    let chatText = await readIfPresent(reader, chatRel);
    if (chatText == null) {
        chatRel = "02_inventory/chat-index.md";
        chatText = await readIfPresent(reader, chatRel);
    }
    let teams = null;

    /* The chat index and the file inventory are maintained separately, so the
       index can fall behind. Reporting "last captured 15 days ago" while a newer
       transcript for the same 1:1 sits in the inventory is a false staleness
       reading, so cross-check the two and report the disagreement rather than
       trusting the index alone. */
    const CONVERSATION_ARTIFACT = /(?:^|[^\p{L}\p{N}])(?:transcripts?|recaps?|chats?|insights|1[:x]1|meeting[^\p{L}\p{N}]+summar(?:y|ies))(?=$|[^\p{L}\p{N}])/iu;
    function unregisteredCaptures(convs) {
        // Only tokens unique to ONE conversation can attribute a file, otherwise
        // two similarly-named threads would claim the same source.
        const tokenise = (s) =>
            String(s || "")
                .toLowerCase()
                .split(/[^\p{L}\p{N}]+/u)
                .filter((w) => w.length > 3 && !["with", "team", "weekly", "sync", "chat", "meeting"].includes(w));
        const counts = new Map();
        for (const c of convs) for (const w of new Set(tokenise(c.name))) counts.set(w, (counts.get(w) || 0) + 1);

        const registered = new Set();
        for (const c of convs) for (const s of c.sourceIds || []) registered.add(String(s));

        const matchers = convs.map((c) => ({
            conversation: c,
            distinctive: [...new Set(tokenise(c.name))].filter((w) => counts.get(w) === 1),
        }));
        const byConversation = new Map();
        const attributionConflicts = [];
        const unattributedCaptures = [];
        for (const s of sources) {
            const id = String(s["Source ID"] || "");
            if (!id || registered.has(id)) continue;
            const blob = (s.Path || "") + " " + (s["Source type"] || "");
            if (!CONVERSATION_ARTIFACT.test(blob)) continue;
            const tokens = new Set(tokenise(blob));
            const candidates = matchers
                .filter(({ distinctive }) => distinctive.some((w) => tokens.has(w)))
                .map(({ conversation }) => conversation);
            const source = { id, date: s.Date ?? null, path: s.Path ?? null, type: s["Source type"] ?? null };
            if (candidates.length === 1) {
                const [c] = candidates;
                source.current = !isNotCurrent(s);
                if (!byConversation.has(c.index)) byConversation.set(c.index, []);
                byConversation.get(c.index).push(source);
            } else if (candidates.length > 1) {
                attributionConflicts.push({
                    source,
                    candidates: candidates.map((c) => ({ index: c.index, name: c.name, chatId: c.chatId })),
                });
            } else {
                unattributedCaptures.push(source);
            }
        }
        return { byConversation, attributionConflicts, unattributedCaptures };
    }

    try {
        const idx = chatText != null ? parseChatIndex(chatText) : null;
        if (chatText != null && !idx) throw new Error("Invalid chat index: no parseable conversations");
        if (idx) {
            teams = { rel: chatRel, ...teamsHealth(idx, { now }) };
            const extra = unregisteredCaptures(teams.conversations);
            teams.attributionConflicts = extra.attributionConflicts;
            teams.unattributedCaptures = extra.unattributedCaptures;
            for (const c of teams.conversations) {
                c.unregistered = extra.byConversation.get(c.index) || [];
                c.attributionConflicts = extra.attributionConflicts.filter(
                    (conflict) => conflict.candidates.some((candidate) => candidate.index === c.index)
                );
                const last = isoDateTime(c.lastCaptured);
                // Membership gaps do not prove newer coverage; only a valid,
                // non-future date on an unambiguous source can dispute the index.
                c.staleDateDisputed = c.identityConflicts.length === 0 && last != null &&
                    c.unregistered.some((source) => {
                        const captured = isoDateTime(source.date);
                        return source.current && captured != null && captured <= now && captured > last;
                    });
                if (c.staleDateDisputed) c.isStale = false;
            }
            refreshTeamsHealth(teams);
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

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);

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
    return withReader(roomPath, (reader) => readFileFromReader(reader, rel));
}

async function readFileFromReader(reader, rel) {
    const handle = await reader.openFile(rel);
    try {
        const s = handle.stat;
        if (s.type !== "file") throw new Error("Not a file");

        const ext = path.extname(handle.resolvedRel).toLowerCase();
        const meta = { rel, size: s.size, ext, mtime: new Date(s.modifiedMs).toISOString().slice(0, 10) };

        if (IMAGE_EXT.has(ext)) return { ...meta, kind: s.size <= MAX_RAW ? "image" : "binary", truncated: false };

        // Look ahead one complete UTF-8 character / UTF-16 surrogate pair.
        const buf = await handle.readPrefix(MAX_TEXT + 4);
        const truncated = buf.length > MAX_TEXT;

        // UTF-16 declares itself with a BOM.
        const utf16 =
            buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
                ? buf[0] === 0xff
                    ? "utf16le"
                    : "utf16be"
                : null;
        if (utf16) {
            let end = Math.min(buf.length, MAX_TEXT);
            end -= end % 2;
            if (truncated && end >= 2 && end + 2 <= buf.length) {
                const unit = (offset) => utf16 === "utf16le" ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
                const last = unit(end - 2);
                const next = unit(end);
                if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 2;
            }
            const slice = buf.subarray(0, end);
            const le = utf16 === "utf16le" ? slice : slice.swap16();
            return { ...meta, kind: "text", encoding: utf16, truncated, text: le.toString("utf16le").replace(/^\uFEFF/, "") };
        }

        // The UTF-16 BOM branch above takes precedence; extensions do not override binary bytes.
        if (looksBinary(buf)) return { ...meta, kind: "binary", truncated: false };

        let end = Math.min(buf.length, MAX_TEXT);
        if (truncated) {
            let back = 0;
            while (end > 0 && back < 4 && (buf[end] & 0xc0) === 0x80) {
                end--;
                back++;
            }
        }
        return { ...meta, kind: "text", truncated, text: buf.subarray(0, end).toString("utf8").replace(/^\uFEFF/, "") };
    } finally {
        await handle.close();
    }
}

/** Raw bytes for inline image preview. */
const MAX_RAW = 25 * 1024 * 1024;

export async function readRoomBytes(roomPath, rel) {
    return withReader(roomPath, (reader) => readBytesFromReader(reader, rel));
}

async function readBytesFromReader(reader, rel) {
    const handle = await reader.openFile(rel);
    try {
        const s = handle.stat;
        if (s.type !== "file") throw new Error("Not a file");
        const ext = path.extname(handle.resolvedRel).toLowerCase();
        if (!IMAGE_EXT.has(ext)) throw new Error("Refused: not an image");
        if (s.size > MAX_RAW) throw new Error("Refused: file exceeds the preview limit");
        const buf = await handle.readPrefix(MAX_RAW + 1);
        if (buf.length > MAX_RAW) throw new Error("Refused: file exceeds the preview limit");
        return { buf, mime: MIME[ext] || "application/octet-stream" };
    } finally {
        await handle.close();
    }
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

/** Breadcrumb targets derived from native path roots, including UNC shares. */
export function pathBreadcrumbs(absolutePath, pathImpl = path) {
    if (!pathImpl.isAbsolute(absolutePath)) throw new Error("Expected an absolute path");
    let current = pathImpl.format(pathImpl.parse(pathImpl.normalize(absolutePath)));
    const breadcrumbs = [];
    for (;;) {
        const parsed = pathImpl.parse(current);
        breadcrumbs.push({ name: parsed.base || parsed.root, path: current });
        const parent = pathImpl.dirname(current);
        if (parent === current) return breadcrumbs.reverse();
        current = parent;
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
        breadcrumbs: pathBreadcrumbs(resolved),
        isRoom: await isRoom(resolved),
        entries,
    };
}

/**
 * Likely places a project room lives, each checked cheaply so the picker can
 * open with real starting points rather than an empty dead end.
 */
export async function suggestStartingPoints() {
    const home = homedir();
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
