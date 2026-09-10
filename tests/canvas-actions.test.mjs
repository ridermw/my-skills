import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeRoom, afterRoomResources } from "./helpers/canvas-fixture.mjs";

const sdk = "data:text/javascript," + encodeURIComponent(`
    export const createCanvas = (definition) => definition;
    export async function joinSession(options) {
        globalThis.canvasTestRegistration = options.canvases[0];
        return {};
    }
`);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "@github/copilot-sdk/extension") return { url: sdk, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
await import("../extensions/project-room-browser/extension.mjs");
hooks.deregister();
const canvas = globalThis.canvasTestRegistration;
delete globalThis.canvasTestRegistration;
const search = canvas.actions.find((action) => action.name === "find_sources").handler;
const getSummary = canvas.actions.find((action) => action.name === "get_summary").handler;
let nextInstance = 0;

test("authority schema example matches a canonical inventory through the real action", async (t) => {
    const action = canvas.actions.find((entry) => entry.name === "find_sources");
    assert.match(action.inputSchema.properties.authority.description, /e\.g\. authoritative/);
    const { root, instanceId } = await openFixture(t);
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"),
        "Source ID,Path,Authority,Current or superseded\n"
        + "S001,00_originals/source-1.txt,authoritative,current\n"
        + "S002,00_originals/source-2.txt,supporting,current\n");
    const result = await search({ instanceId, input: { authority: "authoritative" } });
    assert.equal(result.matched, 1);
    assert.deepEqual(result.rows.map((row) => row.id), ["S001"]);
});

async function openFixture(t, count = 25) {
    const root = await makeRoom(t, count);
    const instanceId = `test-${nextInstance++}`;
    const opened = await canvas.open({ instanceId, input: { path: root } });
    afterRoomResources(t, () => canvas.onClose({ instanceId }));
    return { root, instanceId, opened };
}

test("canvas opens with private out-of-band API and preview capabilities", async (t) => {
    const { root, opened } = await openFixture(t);
    const url = new URL(opened.url);
    const capabilities = new URLSearchParams(url.hash.slice(1));
    assert.match(capabilities.get("token") || "", /^[0-9a-f]{48}$/);
    assert.match(capabilities.get("preview") || "", /^[0-9a-f]{48}$/);
    assert.notEqual(capabilities.get("token"), capabilities.get("preview"));
    const publicHtml = await (await fetch(opened.url)).text();
    assert.equal(publicHtml.includes(capabilities.get("token")), false);
    assert.equal(publicHtml.includes(root), false);
});

test("source search honors omitted, zero and explicit finite row limits", async (t) => {
    const { instanceId } = await openFixture(t);
    for (const [input, count] of [[{}, 20], [{ limit: 0 }, 0], [{ limit: 3 }, 3], [{ limit: 30 }, 25]]) {
        const result = await search({ instanceId, input });
        assert.equal(result.ok, true);
        assert.equal(result.rows.length, count);
        assert.equal(result.matched, 25);
    }
});

test("source search counts all filtered matches before limiting returned rows", async (t) => {
    const { instanceId } = await openFixture(t);
    for (const [input, matched, returned] of [
        [{ query: "claim 2", limit: 3 }, 8, 3],
        [{ query: "claim 25", limit: 0 }, 1, 0],
        [{ authority: "Secondary" }, 0, 0],
        [{ lifecycle: "Unavailable" }, 0, 0],
        [{ query: "no such claim" }, 0, 0],
    ]) {
        const result = await search({ instanceId, input });
        assert.equal(result.ok, true);
        assert.equal(result.matched, matched);
        assert.equal(result.rows.length, returned);
    }
});

test("source search rejects invalid limits instead of silently widening the result", async (t) => {
    const { instanceId } = await openFixture(t);
    for (const limit of [-1, 0.5, Infinity, NaN, null, "3"]) {
        const result = await search({ instanceId, input: { limit } });
        assert.equal(result.ok, false, `accepted invalid limit ${String(limit)}`);
        assert.match(result.error, /limit/);
        assert.equal(result.rows, undefined);
    }
});

test("source actions retain canonical lifecycle values from the room reader", async (t) => {
    const { instanceId } = await openFixture(t);
    const result = await search({ instanceId, input: { lifecycle: "current", limit: 1 } });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].lifecycle, "current");
    const summary = await canvas.actions.find((action) => action.name === "get_summary").handler({ instanceId });
    assert.equal(summary.lifecycle.current, 25);
});

test("summary counts inherited-property names as ordinary authority and lifecycle buckets", async (t) => {
    const { root, instanceId } = await openFixture(t);
    const values = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "Primary"];
    const rows = ["Source ID,Path,Authority,Current or superseded"];
    for (const [i, value] of values.entries()) {
        rows.push(`S${i}a,00_originals/source-1.txt,${value},${value}`);
        rows.push(`S${i}b,00_originals/source-2.txt,${value},${value}`);
    }
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), rows.join("\n"));
    const result = JSON.parse(JSON.stringify(await getSummary({ instanceId })));
    for (const field of ["authority", "lifecycle"]) {
        assert.equal(Object.keys(result[field]).length, 6);
        for (const value of values) {
            assert.equal(Object.hasOwn(result[field], value), true);
            assert.equal(result[field][value], 2);
        }
    }
    assert.equal(result.sources, 12);
});

test("summary caps drift samples while reporting exact totals and omissions", async (t) => {
    const { root, instanceId } = await openFixture(t);
    await writeFile(path.join(root, "room.yaml"), "project: Drift fixture\nrender_expiry_days: 1\n");
    const rows = ["Source ID,Path,Authority,Current or superseded,Date"];
    for (let i = 0; i < 45; i++) {
        rows.push(`S${i},00_originals/missing-${i}.txt,Rendered,historical,2000-01-01`);
    }
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), rows.join("\n"));
    await mkdir(path.join(root, "01_inbox"));
    for (let i = 0; i < 25; i++) await writeFile(path.join(root, "01_inbox", `pending-${i}.txt`), "");
    const result = await getSummary({ instanceId });
    assert.equal(result.health.missingOnDisk.length, 20);
    const totals = { staleRenders: 45, notCurrent: 45, missingOnDisk: 45, uninventoried: 50, inboxPending: 25, recognisedDirs: 2 };
    for (const [field, total] of Object.entries(totals)) {
        assert.equal(result.healthTotals[field], total);
        assert.equal(result.health[field].length, Math.min(total, 20));
        assert.equal(result.healthOmitted[field], total - result.health[field].length);
    }
    assert.equal(result.sources, 45);
    assert.equal(result.authority.Rendered, 45);
    assert.equal(result.health.unrecognisedLayout, false);
});

test("summary omits oversized evidence whole without starving later exact samples", async (t) => {
    const { root, instanceId } = await openFixture(t);
    const hugeId = "S" + "x".repeat(5000);
    const hugeAuthority = "A".repeat(6000);
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), [
        "Source ID,Path,Authority,Current or superseded",
        `${hugeId},00_originals/source-1.txt,${hugeAuthority},historical`,
        "MEMO-S0007,00_originals/missing.txt,Primary,historical",
    ].join("\n"));
    const result = await getSummary({ instanceId });
    assert.equal(result.health.notCurrent.length, 1);
    assert.equal(result.health.notCurrent[0].id, "MEMO-S0007");
    assert.equal(result.health.notCurrent[0].path, "00_originals/missing.txt");
    assert.equal(result.healthTotals.notCurrent, 2);
    assert.equal(result.healthOmitted.notCurrent, 1);
    assert.equal(result.bucketTotals.authority, 2);
    assert.equal(result.bucketOmitted.authority, 1);
    assert.deepEqual(Object.entries(result.authority), [["Primary", 1]]);
    assert.equal(result.root, root);
    assert.equal(result.rootOmitted, false);
});

test("summary enforces UTF-8 collection and whole-result byte budgets", async (t) => {
    const { root, instanceId } = await openFixture(t, 0);
    const text = "\u754c";
    await writeFile(path.join(root, "room.yaml"),
        `project: ${text.repeat(6000)}\nnote: ${text.repeat(6000)}\nrender_expiry_days: 1\n`);
    const rows = ["Source ID,Path,Authority,Current or superseded,Date"];
    for (let i = 0; i < 70; i++) {
        rows.push(`S${i}${text.repeat(256)},00_originals/missing-${i}.txt,Rendered${i}${text.repeat(128)},historical${i}${text.repeat(128)},2000-01-01`);
    }
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), rows.join("\n"));
    const inbox = path.join(root, "01_inbox", "d".repeat(200));
    await mkdir(inbox, { recursive: true });
    for (let i = 0; i < 25; i++) await writeFile(path.join(inbox, `${i}-${"f".repeat(100)}.txt`), "");
    const result = await getSummary({ instanceId });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
    assert.equal(result.sources, 70);
    for (const field of ["authority", "lifecycle"]) {
        assert.equal(result.bucketTotals[field], 70);
        assert.equal(result.bucketOmitted[field], 70 - Object.keys(result[field]).length);
        assert.ok(Object.keys(result[field]).length <= 20);
        assert.ok(Buffer.byteLength(JSON.stringify(result[field])) <= 4096);
    }
    for (const [field, total] of Object.entries({ staleRenders: 70, notCurrent: 70, missingOnDisk: 70, uninventoried: 25, inboxPending: 25, recognisedDirs: 2 })) {
        assert.equal(result.healthTotals[field], total);
        assert.equal(result.healthOmitted[field], total - result.health[field].length);
        assert.ok(result.health[field].length <= 20);
        assert.ok(Buffer.byteLength(JSON.stringify(result.health[field])) <= 4096);
    }
    assert.match(result.name, /\[truncated\]$/);
    assert.match(result.note, /\[truncated\]$/);
});
