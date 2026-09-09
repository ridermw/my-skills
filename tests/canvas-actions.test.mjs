import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeRoom } from "./helpers/canvas-fixture.mjs";

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

async function openFixture(t) {
    const root = await makeRoom(t, 25);
    const instanceId = `test-${nextInstance++}`;
    const opened = await canvas.open({ instanceId, input: { path: root } });
    t.after(() => canvas.onClose({ instanceId }));
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
