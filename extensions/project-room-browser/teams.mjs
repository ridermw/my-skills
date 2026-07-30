/**
 * Teams conversation layer.
 *
 * The source inventory indexes FILES. A room's chat index indexes CONVERSATIONS.
 * They are not the same thing: in the reference room, eleven inventory rows are
 * captures of only five distinct Teams threads. Without this distinction three
 * windows on one group chat look like three independent sources, and a
 * superseded capture reads as corroboration.
 *
 * This module parses that index and derives coverage health from it. It is
 * read-only and makes no network calls: a re-capture "sweep" produces an
 * instruction for an authenticated agent to run, it never fetches anything
 * itself.
 */

const RX = {
    heading: /^##\s+(.+?)\s*$/,
    numbered: /^(\d+)\s*[·.]\s*(.+)$/,
    chatId: /`(19:[^`]+)`/,
    created: /created\s+(\d{4}-\d{2}-\d{2})/i,
    tableRow: /^\|(.+)\|\s*$/,
    tableSep: /^\|[\s:|-]+\|$/,
};

const stripMd = (s) =>
    String(s || "")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\*\*([^*]*)\*\*/g, "$1")
        .replace(/\*([^*]*)\*/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim();

const cells = (line) =>
    line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());

/** true / false / null when the source says nothing either way. */
function tri(text) {
    const t = String(text || "");
    if (/✅|complete|yes\b/i.test(t) && !/❌/.test(t)) return true;
    if (/❌|✗|incomplete|truncated|\bno\b/i.test(t)) return false;
    return null;
}

/** Collect consecutive markdown table blocks out of a chunk of lines. */
function tablesIn(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (!RX.tableRow.test(lines[i]) || !RX.tableSep.test((lines[i + 1] || "").trim())) continue;
        const header = cells(lines[i]);
        const rows = [];
        let j = i + 2;
        for (; j < lines.length && RX.tableRow.test(lines[j]); j++) rows.push(cells(lines[j]));
        out.push({ header, rows, at: i });
        i = j - 1;
    }
    return out;
}

/** Pull `**Label:** value` pairs, which the index uses for conversation metadata. */
function labelled(lines) {
    const meta = {};
    for (const raw of lines) {
        const m = raw.match(/^\*\*([^:*]+):?\*\*:?\s*(.*)$/);
        if (!m) continue;
        const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
        const val = stripMd(m[2]);
        if (val) meta[key] = val;
    }
    return meta;
}

function classifyTable(t) {
    const h = t.header.map((x) => x.toLowerCase());
    if (h.includes("source") && (h.includes("captured") || h.includes("coverage"))) return "captures";
    if (h[0] === "date" || h.includes("verbatim transcript")) return "occurrences";
    if (h[0] === "gap") return "gaps";
    if (h.includes("chat_id") || h.includes("conversation")) return "map";
    return "other";
}

function parseCaptureRow(header, row) {
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
    const at = (name) => {
        const i = idx(name);
        return i > -1 ? row[i] : "";
    };
    const complete = at("complete");
    // A Source cell may carry a status annotation, e.g. "S074 \u2190 use this" or
    // "S038 \u26a0\ufe0f superseded". The bare id is the identity; the annotation is
    // status and must not contaminate the id used in prompts and lookups.
    const srcCell = stripMd(at("source"));
    const bareId = (srcCell.match(/S\d+/) || [])[0] || srcCell;
    const annotation = srcCell.replace(/S\d+/, "").trim();
    return {
        sourceId: bareId,
        sourceNote: annotation || null,
        isCurrent: /use this|current/i.test(annotation),
        isSuperseded: /supersed|stale|old/i.test(annotation),
        file: stripMd(at("file")),
        captured: stripMd(at("captured")),
        coverage: stripMd(at("coverage")),
        messages: stripMd(at("msgs")) || stripMd(at("messages")),
        complete: tri(complete),
        completeNote: stripMd(complete),
    };
}

function parseOccurrenceRow(header, row) {
    const out = { date: stripMd(row[0]), artifacts: [] };
    for (let i = 1; i < header.length; i++) {
        const label = stripMd(header[i]);
        const raw = row[i] || "";
        const present = !/❌|—|^\s*$/.test(raw.trim()) || /`S\d+`/.test(raw);
        out.artifacts.push({
            label,
            present: /`S\d+`/.test(raw) ? true : present ? true : false,
            sourceIds: [...raw.matchAll(/`(S\d+)`/g)].map((m) => m[1]),
            note: stripMd(raw),
        });
    }
    return out;
}

/**
 * Parse a room's chat index into conversations plus known gaps.
 * Returns null when the text does not look like a chat index at all.
 */
export function parseChatIndex(text) {
    if (!text || !/chat[\s_-]?index|chat_id/i.test(text)) return null;
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");

    // split into ## sections
    const sections = [];
    let cur = { title: "(intro)", lines: [] };
    for (const line of lines) {
        const m = line.match(RX.heading);
        if (m) {
            sections.push(cur);
            cur = { title: m[1], lines: [] };
        } else cur.lines.push(line);
    }
    sections.push(cur);

    const conversations = [];
    let knownGaps = [];
    let quickMap = [];
    let identityConflicts = null;
    let recipe = "";

    for (const sec of sections) {
        const numbered = sec.title.match(RX.numbered);
        const tables = tablesIn(sec.lines);

        if (/^known gaps/i.test(sec.title)) {
            const t = tables.find((x) => classifyTable(x) === "gaps") || tables[0];
            if (t) knownGaps = t.rows.map((r) => ({ gap: stripMd(r[0]), detail: stripMd(r[1]) }));
            continue;
        }
        if (/^re-?capture recipe/i.test(sec.title)) {
            recipe = sec.lines.join("\n").trim();
            continue;
        }
        if (/^quick map/i.test(sec.title)) {
            const t = tables[0];
            if (t) {
                quickMap = t.rows.map((r) => {
                    const c = t.header.map((h) => h.toLowerCase());
                    const get = (n) => {
                        const i = c.findIndex((x) => x.includes(n));
                        return i > -1 ? r[i] : "";
                    };
                    return {
                        ordinal: Number(stripMd(get("#"))) || null,
                        chatIdShort: stripMd(get("chat_id")),
                        name: stripMd(get("conversation")),
                        type: stripMd(get("type")),
                        sourceIds: [...(get("sources") || "").matchAll(/`?(S\d+)`?/g)].map((m) => m[1]),
                        fullyCaptured: tri(get("captured")),
                        capturedNote: stripMd(get("captured")),
                    };
                });
            }
            continue;
        }
        if (!numbered) continue;

        // a numbered section is one conversation
        const body = sec.lines.join("\n");
        const idm = body.match(RX.chatId);
        const meta = labelled(sec.lines);
        const title = numbered[2];
        const dash = title.split(/\s+[—–]\s+/);

        const conv = {
            index: Number(numbered[1]),
            name: stripMd(dash[0]),
            kindLabel: dash[1] ? stripMd(dash[1]) : "",
            chatId: idm ? idm[1] : null,
            created: (body.match(RX.created) || [])[1] || null,
            organizer: meta.organizer || null,
            recurs: meta.recurs || null,
            participants: meta.participants || meta.invited || null,
            whyItMatters: meta.why_it_matters || null,
            accessNote: meta.access_note || null,
            gapsNote: meta.gaps || null,
            captures: [],
            occurrences: [],
        };

        for (const t of tables) {
            const kind = classifyTable(t);
            if (kind === "captures") conv.captures.push(...t.rows.map((r) => parseCaptureRow(t.header, r)));
            else if (kind === "occurrences") conv.occurrences.push(...t.rows.map((r) => parseOccurrenceRow(t.header, r)));
        }
        conversations.push(conv);
    }

    if (!conversations.length && !quickMap.length) return null;

    // fold quick-map facts onto the conversations they describe
    for (const q of quickMap) {
        // chat_id is the only permanent identity ("topics get renamed,
        // participants change, exports get re-cut"), so it must win. The "#"
        // ordinal is positional and silently reattaches coverage to the wrong
        // thread if rows are ever reordered, so it is only a fallback.
        const byId =
            q.chatIdShort && conversations.find((c) => c.chatId && sameChat(c.chatId, q.chatIdShort));
        const byOrdinal = q.ordinal != null ? conversations.find((c) => c.index === q.ordinal) : null;
        const match = byId || byOrdinal || conversations.find((c) => namesMatch(c.name, q.name));
        // If both keys resolve but disagree, the document is inconsistent and we
        // must not silently pick one.
        if (byId && byOrdinal && byId !== byOrdinal) {
            (identityConflicts = identityConflicts || []).push({
                ordinal: q.ordinal,
                name: q.name,
                byIdName: byId.name,
                byOrdinalName: byOrdinal.name,
            });
        }
        if (match) {
            match.type = match.type || q.type;
            match.fullyCaptured = q.fullyCaptured;
            match.capturedNote = q.capturedNote;
            if (!match.captures.length && q.sourceIds.length) match.quickSourceIds = q.sourceIds;
        } else {
            conversations.push({
                index: conversations.length + 1,
                name: q.name,
                chatId: null,
                type: q.type,
                fullyCaptured: q.fullyCaptured,
                capturedNote: q.capturedNote,
                captures: [],
                occurrences: [],
                quickSourceIds: q.sourceIds,
            });
        }
    }

    for (const c of conversations) if (!c.type) c.type = inferType(c);
    return { conversations, knownGaps, recipe, quickMap, identityConflicts: identityConflicts || [] };
}

/**
 * Compare a full chat_id against the quick map's abbreviated form.
 *
 * A 1:1 id looks like "19:<userA>_<userB>@unq.gbl.spaces" and <userA> is the
 * SAME person for every 1:1 you own, so matching on the first segment made all
 * of your 1:1s collide into one identity. The abbreviated form elides the middle
 * of each segment with an ellipsis, so require every literal fragment of the
 * short form to appear in the full id, in order.
 */
function sameChat(full, short) {
    const norm = (s) => String(s || "").replace(/\s/g, "").toLowerCase();
    const a = norm(full);
    const b = norm(short);
    if (!a || !b) return false;
    if (a === b) return true;
    const frags = b.split("\u2026").filter(Boolean);
    if (!frags.length) return false;
    // Every fragment must appear, in order, and the first must anchor the start.
    if (!a.startsWith(frags[0])) return false;
    let at = frags[0].length;
    for (let i = 1; i < frags.length; i++) {
        const k = a.indexOf(frags[i], at);
        if (k < 0) return false;
        at = k + frags[i].length;
    }
    return true;
}

const looseName = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

function inferType(c) {
    const t = (c.kindLabel || "") + " " + (c.name || "");
    if (/meeting/i.test(t) || /^19:meeting_/i.test(c.chatId || "")) return "Meeting";
    if (/group/i.test(t)) return "Group";
    if (/1:1|1on1/i.test(t)) return "1:1";
    return "Chat";
}

function isFutureDate(s) {
    const m = String(s || "").match(/\d{4}-\d{2}-\d{2}/);
    if (!m) return false;
    const t = Date.parse(m[0] + "T00:00:00Z");
    return !Number.isNaN(t) && t > Date.now();
}

const DAY = 86400000;
function daysSince(iso, now) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const t = Date.parse(iso + "T00:00:00Z");
    return Number.isNaN(t) ? null : Math.floor(((now ?? Date.now()) - t) / DAY);
}

/**
 * Derive coverage health per conversation, plus a room-level roll-up.
 * `staleAfterDays` is how long a thread may go un-recaptured before it is flagged.
 */
export function teamsHealth(index, { staleAfterDays = 14, now = Date.now() } = {}) {
    if (!index) return null;

    /* A single age threshold measures how long ago we captured, not whether we
       captured everything that happened. A weekly series can miss an occurrence
       long before 14 days elapse, while a genuinely quiet 1:1 is not stale just
       because nobody spoke. Derive the window from the stated recurrence. */
    const cadenceDays = (c) => {
        // This index states cadence in the conversation NAME ("... weekly check-in")
        // rather than in a labelled field, so the name has to be part of the signal.
        const s = ((c.recurs || "") + " " + (c.kindLabel || "") + " " + (c.name || "")).toLowerCase();
        if (/daily/.test(s)) return 1;
        if (/weekly|every week/.test(s)) return 7;
        if (/fortnight|biweekly|every two weeks|every other week/.test(s)) return 14;
        if (/monthly/.test(s)) return 30;
        return null;
    };
    const conversations = index.conversations.map((c) => {
        const dates = c.captures.map((x) => x.captured).filter(Boolean).sort();
        const last = dates.length ? dates[dates.length - 1] : null;
        const age = daysSince(last, now);
        // A capture that was superseded by a later, complete capture is history,
        // not an open failure. Only the effective current captures can fail.
        // Counting every historical partial made threads that had already been
        // re-captured show up as needing a sweep.
        const superseded = new Set(c.captures.filter((x) => x.isSuperseded).map((x) => x.sourceId));
        const hasCurrentComplete = c.captures.some((x) => x.isCurrent && x.complete !== false);
        const incomplete = c.captures.filter(
            (x) => x.complete === false && !superseded.has(x.sourceId) && !(hasCurrentComplete && !x.isCurrent)
        );
        const missingArtifacts = [];
        for (const occ of c.occurrences) {
            for (const a of occ.artifacts) {
                // "none exists" records that the artifact was never produced, and an
                // upcoming occurrence has not happened yet. Neither is actionable.
                const impossible = /none exists|n\/a|not available|no recording/i.test(a.note || "");
                const upcoming = /upcoming|scheduled|future/i.test(occ.date + " " + (a.note || "")) || isFutureDate(occ.date);
                if (!a.present && !impossible && !upcoming) {
                    missingArtifacts.push({ date: occ.date, label: a.label, note: a.note });
                }
            }
        }
        // A thread with no capture rows at all has nothing to be stale, partial
        // or missing, so every derived check passes and the card would read
        // "Coverage looks current." That is the most dangerous possible answer.
        const noCaptures = c.captures.length === 0;
        // Allow one cadence period plus a grace period before calling a recurring
        // series stale; fall back to the flat threshold for non-recurring threads.
        const cadence = cadenceDays(c);
        const window = cadence ? cadence + Math.min(7, cadence) : staleAfterDays;
        // The index's own "Fully captured?" column is authored by whoever did the
        // capture and outranks anything we derive from the per-row tables.
        const authoredIncomplete = c.fullyCaptured === false;
        return {
            ...c,
            lastCaptured: last,
            daysSinceCapture: age,
            noCaptures,
            authoredIncomplete,
            cadenceDays: cadence,
            staleWindowDays: window,
            // >= not >: the room's own gap list calls a 14-day-old capture stale.
            isStale: age != null && age >= window,
            incompleteCaptures: incomplete,
            missingArtifacts,
            hasProblem:
                noCaptures ||
                authoredIncomplete ||
                (age != null && age >= window) ||
                incomplete.length > 0 ||
                missingArtifacts.length > 0,
            sourceIds: [...new Set([...(c.quickSourceIds || []), ...c.captures.map((x) => x.sourceId).filter(Boolean)])],
        };
    });

    return {
        conversations,
        staleAfterDays,
        counts: {
            conversations: conversations.length,
            captures: conversations.reduce((n, c) => n + c.captures.length, 0),
            stale: conversations.filter((c) => c.isStale).length,
            noCaptures: conversations.filter((c) => c.noCaptures).length,
            authoredIncomplete: conversations.filter((c) => c.authoredIncomplete).length,
            incomplete: conversations.filter((c) => c.incompleteCaptures.length).length,
            missingArtifacts: conversations.reduce((n, c) => n + c.missingArtifacts.length, 0),
        },
        knownGaps: index.knownGaps,
    };
}

/**
 * Build a re-capture instruction for an authenticated agent to run.
 *
 * The canvas deliberately does not call Microsoft Graph: it has no credentials
 * and is opened to inspect semi-trusted material. It reports what needs
 * refreshing; the agent, in its own authenticated context, does the fetching.
 */
export function sweepPlan(health, { roomName = "this room" } = {}) {
    if (!health) return null;
    const targets = health.conversations.filter((c) => c.hasProblem);

    const lines = [];
    lines.push(`Refresh the Teams sources for ${roomName}.`);
    lines.push("");
    if (!targets.length) {
        lines.push("No conversation is stale, truncated, or missing a per-occurrence artifact.");
        lines.push("Re-check for meetings that have occurred since the last capture.");
        return { targets: [], text: lines.join("\n") };
    }
    lines.push("Re-capture these conversations, newest page first, and follow every nextLink:");
    lines.push("");
    for (const c of targets) {
        lines.push(`- ${c.name}${c.type ? " (" + c.type + ")" : ""}`);
        if (c.chatId) lines.push(`  chat_id: ${c.chatId}`);
        const why = [];
        if (c.noCaptures) why.push("no capture is recorded for this thread at all");
        if (c.authoredIncomplete) why.push("the index marks this thread as not fully captured");
        if (c.isStale) why.push(`last captured ${c.lastCaptured} (${c.daysSinceCapture} days ago)`);
        for (const x of c.incompleteCaptures) why.push(`${x.sourceId} is a partial capture: ${x.completeNote || "incomplete"}`);
        for (const m of c.missingArtifacts) why.push(`${m.date} missing ${m.label}`);
        for (const w of why) lines.push(`  why: ${w}`);
    }
    lines.push("");
    lines.push("Rules:");
    lines.push("- Use the room's own re-capture tooling; never hand-transcribe a capture.");
    lines.push("- If a response reports hasMoreResults, follow nextLink and merge every page.");
    lines.push("- Record the resulting complete: flag from the LAST page, not the first.");
    lines.push("- Write new captures to the inbox, then update the inventory and the chat index.");
    if (health.knownGaps && health.knownGaps.length) {
        lines.push("");
        lines.push("Known gaps already recorded in the room:");
        for (const g of health.knownGaps) lines.push(`- ${g.gap}: ${g.detail}`);
    }
    return { targets, text: lines.join("\n") };
}
