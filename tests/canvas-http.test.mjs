import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeRoom, serveRoom } from "./helpers/canvas-fixture.mjs";

test("public shell exposes neither API capabilities nor the selected private room", async (t) => {
    const root = await makeRoom(t);
    const { origin, state } = await serveRoom(t, root);
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html.includes(state.token), false);
    assert.equal(html.includes(state.previewToken), false);
    assert.equal(html.includes(root), false);
    assert.equal((await fetch(`${origin}/api/room`)).status, 403);
});

test("room reads require the API header, not a query token", async (t) => {
    const root = await makeRoom(t);
    const { origin, state } = await serveRoom(t, root);
    assert.equal((await fetch(`${origin}/api/room?t=${state.token}`)).status, 403);
    const response = await fetch(`${origin}/api/room`, { headers: { "x-room-token": state.token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).room.root, root);
});

test("scan budget refusal over HTTP leaves the previous room and file scope unchanged", async (t) => {
    const root = await makeRoom(t);
    const oversized = await makeRoom(t, 0);
    for (let first = 0; first < 10000; first += 64) {
        await Promise.all(Array.from({ length: Math.min(64, 10000 - first) }, (_, offset) =>
            writeFile(path.join(oversized, `._ignored-${first + offset}`), "")));
    }
    const { origin, state } = await serveRoom(t, root);
    const headers = { "x-room-token": state.token };
    const response = await fetch(`${origin}/api/room?path=${encodeURIComponent(oversized)}`, { headers });
    assert.equal(response.status, 500);
    const refusal = await response.json();
    assert.equal(refusal.ok, false);
    assert.match(refusal.error, /10,000.*entries/i);
    assert.match(refusal.error, /unverified/i);
    assert.equal(refusal.room, undefined);
    assert.equal(state.roomPath, root);
    const current = await fetch(`${origin}/api/room`, { headers });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).room.root, root);
    const file = await fetch(`${origin}/api/file?rel=00_originals/source-1.txt`, { headers });
    assert.equal(file.status, 200);
    assert.equal((await file.json()).file.text, "Source 1 contents\n");
});

test("an authenticated instance with no selected room reports the picker state explicitly", async (t) => {
    const { origin, state } = await serveRoom(t, "");
    const response = await fetch(`${origin}/api/room`, { headers: { "x-room-token": state.token } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ROOM_NOT_SELECTED");
});

test("preview capability reads images but cannot be promoted to room or text access", async (t) => {
    const root = await makeRoom(t);
    const image = Buffer.from("89504e470d0a1a0a", "hex");
    await writeFile(path.join(root, "00_originals/image.png"), image);
    const { origin, state } = await serveRoom(t, root);
    const response = await fetch(`${origin}/api/raw?rel=00_originals/image.png&t=${state.previewToken}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    for (const route of ["/api/room", "/api/file?rel=00_originals/source-1.txt", "/api/browse"]) {
        assert.equal((await fetch(origin + route, { headers: { "x-room-token": state.previewToken } })).status, 403);
    }
    assert.equal((await fetch(`${origin}/api/raw?rel=00_originals/image.png&t=${state.token}`)).status, 403);
    assert.equal((await fetch(`${origin}/api/raw?rel=00_originals/source-1.txt&t=${state.previewToken}`)).status, 500);
});

test("cross-site API requests remain refused even with a valid capability", async (t) => {
    const root = await makeRoom(t);
    const { origin, state } = await serveRoom(t, root);
    const response = await fetch(`${origin}/api/room`, {
        headers: { "x-room-token": state.token, "sec-fetch-site": "cross-site" },
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /cross-site/);
});
