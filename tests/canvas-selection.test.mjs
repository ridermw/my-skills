import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { makeRoom, serveRoom } from "./helpers/canvas-fixture.mjs";

const sdk = "data:text/javascript," + encodeURIComponent(`
    export const createCanvas = (definition) => definition;
    export async function joinSession(options) {
        globalThis.selectionTestCanvas = options.canvases[0];
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
const canvas = globalThis.selectionTestCanvas;
delete globalThis.selectionTestCanvas;
let nextInstance = 0;

function pauseScan(t, root, fail = false) {
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const opendir = fs.opendir;
    let pending = true;
    const stub = t.mock.method(fs, "opendir", async (target, ...args) => {
        if (target === root && pending) {
            pending = false;
            entered.resolve();
            await gate.promise;
            if (fail) throw Object.assign(new Error("Fixture scan failed"), { code: "EACCES" });
        }
        return opendir(target, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => {
        gate.resolve();
        stub.mock.restore();
        syncBuiltinESMExports();
    });
    return { entered: entered.promise, release: gate.resolve };
}

async function roomFixture(t, name) {
    const root = await fs.realpath(await makeRoom(t));
    await fs.writeFile(path.join(root, "room.yaml"), `project: ${name}\n`);
    await fs.writeFile(path.join(root, "00_originals/source-1.txt"), `${name} contents\n`);
    return root;
}

async function waitForScan(gate, pending) {
    assert.equal(await Promise.race([gate.entered.then(() => "reading"), pending.then(() => "settled")]), "reading");
}

async function request(server, route) {
    const response = await fetch(server.origin + route, { headers: { "x-room-token": server.token || server.state.token } });
    return { status: response.status, body: await response.json() };
}

function select(server, root) {
    return request(server, "/api/room" + (root ? "?path=" + encodeURIComponent(root) : ""));
}

function assertSuperseded(result) {
    assert.equal(result.status, 409);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, "ROOM_SELECTION_SUPERSEDED");
    assert.match(result.body.error, /superseded/i);
    assert.equal(result.body.room, undefined);
}

async function assertScope(server, root, name) {
    if (server.state) assert.equal(server.state.roomPath, root);
    const file = await request(server, "/api/file?rel=00_originals/source-1.txt");
    assert.equal(file.status, 200);
    assert.equal(file.body.file.text, `${name} contents\n`);
}

for (const scenario of ["older success", "older failure", "newest failure", "same-room refresh"]) {
    test(`room selection concurrency: HTTP ${scenario} preserves last-request ownership`, { timeout: 10000 }, async (t) => {
        const prior = await roomFixture(t, "Prior");
        const older = await roomFixture(t, "Older");
        const newer = await roomFixture(t, "Newer");
        const server = await serveRoom(t, prior);
        const gate = pauseScan(t, older, scenario === "older failure");
        const slow = select(server, older);
        await waitForScan(gate, slow);
        let oldResult;
        try {
            await assertScope(server, prior, "Prior");
            const newestPath = scenario === "newest failure" ? path.join(newer, "missing")
                : scenario === "same-room refresh" ? undefined : newer + "/.";
            const latest = await select(server, newestPath);
            assert.equal(latest.status, scenario === "newest failure" ? 500 : 200);
            if (scenario === "newest failure") {
                assert.equal(latest.body.ok, false);
                assert.match(latest.body.error, /ENOENT/);
            }
        } finally {
            gate.release();
            oldResult = await slow;
        }
        assertSuperseded(oldResult);
        const keepPrior = scenario === "newest failure" || scenario === "same-room refresh";
        await assertScope(server, keepPrior ? prior : newer, keepPrior ? "Prior" : "Newer");
        const refresh = await select(server);
        assert.equal(refresh.status, 200);
        assert.equal(refresh.body.room.root, keepPrior ? prior : newer);
    });
}

test("room selection concurrency: a no-room refresh supersedes pending initial selection explicitly", { timeout: 10000 }, async (t) => {
    const older = await roomFixture(t, "Older");
    const server = await serveRoom(t, "");
    const gate = pauseScan(t, older);
    const slow = select(server, older);
    await waitForScan(gate, slow);
    let oldResult;
    try {
        const latest = await select(server);
        assert.equal(latest.status, 409);
        assert.equal(latest.body.code, "ROOM_NOT_SELECTED");
    } finally {
        gate.release();
        oldResult = await slow;
    }
    assertSuperseded(oldResult);
    assert.equal(server.state.roomPath, "");
    assert.equal((await request(server, "/api/file?rel=00_originals/source-1.txt")).status, 409);
    assert.equal((await select(server, older)).status, 200);
    await assertScope(server, older, "Older");
});

test("room selection concurrency: separate canvas instances do not cancel each other", { timeout: 10000 }, async (t) => {
    const prior = await roomFixture(t, "Prior");
    const older = await roomFixture(t, "Older");
    const newer = await roomFixture(t, "Newer");
    const first = await serveRoom(t, prior);
    const second = await serveRoom(t, prior);
    const gate = pauseScan(t, older);
    const slow = select(first, older);
    await waitForScan(gate, slow);
    let oldResult;
    try {
        assert.equal((await select(second, newer)).status, 200);
    } finally {
        gate.release();
        oldResult = await slow;
    }
    assert.equal(oldResult.status, 200);
    await assertScope(first, older, "Older");
    await assertScope(second, newer, "Newer");
});

async function sdkFixture(t, root) {
    const instanceId = `selection-${nextInstance++}`;
    const opened = await canvas.open({ instanceId, input: root ? { path: root } : {} });
    t.after(() => canvas.onClose({ instanceId }));
    const url = new URL(opened.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    return { instanceId, opened, origin: url.origin, token };
}

for (const scenario of ["newest SDK success", "newest SDK failure", "same-room SDK reopen"]) {
    test(`room selection concurrency: ${scenario} supersedes an older HTTP scan`, { timeout: 10000 }, async (t) => {
        const prior = await roomFixture(t, "Prior");
        const older = await roomFixture(t, "Older");
        const newer = await roomFixture(t, "Newer");
        const server = await sdkFixture(t, prior);
        const gate = pauseScan(t, older);
        const slow = select(server, older);
        await waitForScan(gate, slow);
        let oldResult;
        try {
            const target = scenario === "newest SDK failure" ? path.join(newer, "missing")
                : scenario === "same-room SDK reopen" ? prior : newer;
            const opening = canvas.open({ instanceId: server.instanceId, input: { path: target } });
            if (scenario === "newest SDK failure") await assert.rejects(opening, { code: "ENOENT" });
            else assert.equal((await opening).url, server.opened.url);
        } finally {
            gate.release();
            oldResult = await slow;
        }
        assertSuperseded(oldResult);
        const keepPrior = scenario !== "newest SDK success";
        await assertScope(server, keepPrior ? prior : newer, keepPrior ? "Prior" : "Newer");
        const summary = await canvas.actions.find((action) => action.name === "get_summary").handler({ instanceId: server.instanceId });
        assert.equal(summary.root, keepPrior ? prior : newer);
    });
}

for (const latestFails of [false, true]) {
    test(`room selection concurrency: pending SDK reopen loses to newer HTTP ${latestFails ? "failure" : "success"}`, { timeout: 10000 }, async (t) => {
        const prior = await roomFixture(t, "Prior");
        const older = await roomFixture(t, "Older");
        const newer = await roomFixture(t, "Newer");
        const server = await sdkFixture(t, prior);
        const gate = pauseScan(t, older);
        const opening = canvas.open({ instanceId: server.instanceId, input: { path: older } })
            .then((value) => ({ value }), (error) => ({ error }));
        let oldResult;
        try {
            await waitForScan(gate, opening);
            await assertScope(server, prior, "Prior");
            const latest = await select(server, latestFails ? path.join(newer, "missing") : newer);
            assert.equal(latest.status, latestFails ? 500 : 200);
        } finally {
            gate.release();
            oldResult = await opening;
        }
        assert.equal(oldResult.error?.code, "ROOM_SELECTION_SUPERSEDED");
        assert.equal(oldResult.value, undefined);
        await assertScope(server, latestFails ? prior : newer, latestFails ? "Prior" : "Newer");
    });
}

test("room selection concurrency: initial SDK picker and focus-only reopen preserve selection", async (t) => {
    const server = await sdkFixture(t, "");
    assert.equal((await select(server)).body.code, "ROOM_NOT_SELECTED");
    const root = await roomFixture(t, "Selected");
    await canvas.open({ instanceId: server.instanceId, input: { path: root } });
    const focused = await canvas.open({ instanceId: server.instanceId, input: {} });
    assert.equal(focused.url, server.opened.url);
    await assertScope(server, root, "Selected");
});
