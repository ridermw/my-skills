import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as routes from "../extensions/project-room-browser/routes.mjs";

const sdk = "data:text/javascript," + encodeURIComponent(`
    export const createCanvas = (definition) => definition;
    export async function joinSession(options) {
        globalThis.lifecycleCanvas = options.canvases[0];
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
const canvas = globalThis.lifecycleCanvas;
delete globalThis.lifecycleCanvas;
let nextInstance = 0;

async function fixture(t) {
    const base = await mkdtemp(path.join(tmpdir(), "canvas-lifecycle-"));
    const root = path.join(base, "room");
    const outside = path.join(base, "outside");
    const cleanups = [];
    t.after(async () => {
        try {
            for (const cleanup of cleanups.reverse()) await cleanup();
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });
    for (const [dir, label] of [[root, "Inside"], [outside, "Outside"]]) {
        await mkdir(path.join(dir, "00_originals"), { recursive: true });
        await mkdir(path.join(dir, "02_inventory"));
        await writeFile(path.join(dir, "room.yaml"), `project: ${label}\n`);
        await writeFile(path.join(dir, "00_originals/file.txt"), `${label} evidence\n`);
        await writeFile(path.join(dir, "00_originals/image.png"), `${label} image\n`);
        await writeFile(path.join(dir, "02_inventory/source_inventory.csv"),
            "Source ID,Path,Authority,Lifecycle,Key claims or content\n"
            + `S001,00_originals/file.txt,authoritative,current,${label} claim\n`);
    }
    return { base, root, outside, cleanups };
}

async function get(server, route) {
    const response = await fetch(server.origin + route, { headers: { "x-room-token": server.token } });
    assert.equal(response.status, 200);
    return response;
}

for (const mode of ["HTTP", "SDK"]) {
    test(`retained native grant protects ${mode} metadata and previews after root replacement`, async (t) => {
        const setup = await fixture(t);
        let server;
        let close;
        if (mode === "SDK") {
            const instanceId = `retained-${nextInstance++}`;
            const opened = await canvas.open({ instanceId, input: { path: setup.root } });
            const url = new URL(opened.url);
            server = { origin: url.origin, token: new URLSearchParams(url.hash.slice(1)).get("token"), instanceId };
            close = () => canvas.onClose({ instanceId });
        } else {
            const state = { roomPath: setup.root, token: "test-api", previewToken: "test-preview" };
            const listener = http.createServer((req, res) => routes.handleRequest(state, req, res));
            listener.listen(0, "127.0.0.1");
            await once(listener, "listening");
            server = { origin: `http://127.0.0.1:${listener.address().port}`, token: state.token };
            close = async () => {
                if (routes.disposeRoomState) await routes.disposeRoomState(state);
                if (listener.listening) {
                    listener.closeAllConnections();
                    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
                }
            };
        }
        setup.cleanups.push(close);
        assert.equal((await (await get(server, "/api/room")).json()).room.name, "Inside");
        const moved = path.join(setup.base, "moved");
        let replaced = true;
        try {
            await rename(setup.root, moved);
        } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
            replaced = false;
        }
        if (replaced) await symlink(setup.outside, setup.root, process.platform === "win32" ? "junction" : "dir");
        const file = await (await get(server, "/api/file?rel=00_originals/file.txt")).json();
        assert.equal(file.file.text, "Inside evidence\n");
        assert.equal(await (await get(server, "/api/raw?rel=00_originals/image.png")).text(), "Inside image\n");
        assert.equal((await (await get(server, "/api/room")).json()).room.name, "Inside");
        if (mode === "SDK") {
            const summary = await canvas.actions.find((action) => action.name === "get_summary")
                .handler({ instanceId: server.instanceId });
            const sources = await canvas.actions.find((action) => action.name === "find_sources")
                .handler({ instanceId: server.instanceId, input: { query: "Inside" } });
            assert.equal(summary.name, "Inside");
            assert.equal(sources.matched, 1);
        }
        await close();
        if (!replaced) await rename(setup.root, moved);
    });
}

function trackServers(t) {
    const create = http.createServer;
    const servers = [];
    const mock = t.mock.method(http, "createServer", (...args) => {
        const server = create(...args);
        servers.push(server);
        return server;
    });
    syncBuiltinESMExports();
    t.after(async () => {
        mock.mock.restore();
        syncBuiltinESMExports();
        for (const server of servers) {
            if (!server.listening) continue;
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
    });
    return servers;
}

test("overlapping first SDK opens share one managed server", async (t) => {
    trackServers(t);
    const instanceId = `first-open-${nextInstance++}`;
    t.after(() => canvas.onClose({ instanceId }));
    const [first, second] = await Promise.all([
        canvas.open({ instanceId, input: {} }),
        canvas.open({ instanceId, input: {} }),
    ]);
    assert.equal(first.url, second.url);
    await canvas.onClose({ instanceId });
    await assert.rejects(fetch(first.url));
});

test("SDK close during initialization does not leave a live server", { timeout: 10000 }, async (t) => {
    trackServers(t);
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const listen = http.Server.prototype.listen;
    const paused = t.mock.method(http.Server.prototype, "listen", function (...args) {
        const callback = args.pop();
        return listen.call(this, ...args, (...values) => {
            entered.resolve();
            gate.promise.then(() => callback(...values));
        });

    });
    const instanceId = `close-opening-${nextInstance++}`;
    t.after(async () => {
        gate.resolve();
        paused.mock.restore();
        await canvas.onClose({ instanceId });
    });
    const opening = canvas.open({ instanceId, input: {} })
        .then((value) => ({ value }), (error) => ({ error }));
    await entered.promise;
    const closing = canvas.onClose({ instanceId });
    gate.resolve();
    const [result] = await Promise.all([opening, closing]);
    if (result.value) await assert.rejects(fetch(result.value.url));
    else assert.match(result.error.message, /clos|cancel/i);
});

test("failed SDK initialization closes its bound server and permits a later reopen", async (t) => {
    const servers = trackServers(t);
    const listen = http.Server.prototype.listen;
    let first = true;
    const failed = t.mock.method(http.Server.prototype, "listen", function (...args) {
        if (!first) return listen.apply(this, args);
        first = false;
        args.pop();
        return listen.call(this, ...args, () => this.emit("error", new Error("Fixture initialization failed")));
    });
    const instanceId = `failed-open-${nextInstance++}`;
    t.after(async () => {
        failed.mock.restore();
        await canvas.onClose({ instanceId });
    });
    await assert.rejects(canvas.open({ instanceId, input: {} }), /Fixture initialization failed/);
    assert.ok(servers.every((server) => !server.listening), "failed initialization leaked a listener");
    const opened = await canvas.open({ instanceId, input: {} });
    assert.equal((await fetch(opened.url)).status, 200);
    await canvas.onClose({ instanceId });
    await assert.rejects(fetch(opened.url));
});
