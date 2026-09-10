import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleUrl = new URL("../extensions/project-room-browser/reader.mjs", import.meta.url);
const fakeHelper = fileURLToPath(new URL("./helpers/reader-protocol-fixture.mjs", import.meta.url));

async function fixture(t) {
    const base = await mkdtemp(path.join(tmpdir(), "canvas-reader-"));
    const root = path.join(base, "room");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, "file.txt"), "inside evidence\n");
    await writeFile(path.join(outside, "file.txt"), "outside evidence\n");
    const readers = [];
    t.after(async () => {
        try {
            await Promise.all(readers.map((reader) => reader.close()));
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });
    return {
        base, root, outside,
        async open(options) {
            let reader;
            await assert.doesNotReject(async () => {
                const { RoomReader } = await import(moduleUrl);
                reader = await RoomReader.open(root, options);
            });
            readers.push(reader);
            return reader;
        },
    };
}

function fake(t, scenario) {
    const spawn = childProcess.spawn;
    const children = [];
    const mocked = t.mock.method(childProcess, "spawn", (_file, _args, options) => {
        const child = spawn(process.execPath, [fakeHelper, scenario], options);
        children.push(child);
        return child;
    });
    syncBuiltinESMExports();
    t.after(() => {
        mocked.mock.restore();
        syncBuiltinESMExports();
    });
    return children;
}

test("native transport returns metadata and exact binary prefixes from real opened files", async (t) => {
    const setup = await fixture(t);
    const bytes = Buffer.from([0, 10, 13, 255, 65, 66]);
    await writeFile(path.join(setup.root, "binary.dat"), bytes);
    const reader = await setup.open();
    const file = await reader.openFile("binary.dat");
    try {
        assert.equal(file.stat.type, "file");
        assert.equal(file.stat.size, 6);
        assert.match(file.stat.identity, /^\d+:\d+$/);
        assert.deepEqual(await file.readPrefix(4), Buffer.from([0, 10, 13, 255]));
        assert.deepEqual(await file.readPrefix(6), Buffer.from([0, 10, 13, 255, 65, 66]));
    } finally {
        await file.close();
    }
    await assert.rejects(file.readPrefix(1), /closed/i);
    await file.close();
});

test("native transport retains a root grant after its original pathname is replaced", async (t) => {
    const setup = await fixture(t);
    const reader = await setup.open();
    const moved = path.join(setup.base, "moved");
    let replaced = true;
    try {
        await rename(setup.root, moved);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        replaced = false;
    }
    if (replaced) await symlink(setup.outside, setup.root, process.platform === "win32" ? "junction" : "dir");
    const file = await reader.openFile("file.txt");
    try {
        assert.equal((await file.readPrefix(100)).toString(), "inside evidence\n");
    } finally {
        await file.close();
    }
    if (!replaced) {
        await reader.close();
        await rename(setup.root, moved);
    }
});

test("native transport distinguishes missing files, escapes, and closed readers", async (t) => {
    const setup = await fixture(t);
    const reader = await setup.open();
    await assert.rejects(reader.openFile("missing"), { code: "ENOENT" });
    await assert.rejects(reader.openFile("../outside/file.txt"), /escapes the room/i);
    const directory = await reader.openDirectory(".");
    const names = [];
    try {
        for (let entry; (entry = await directory.read());) names.push(entry.name);
    } finally {
        await directory.close();
    }
    assert.deepEqual(names, ["file.txt"]);
    await reader.close();
    await assert.rejects(reader.openFile("file.txt"), /closed/i);
});

for (const scenario of ["bad-json", "wrong-version", "oversized-header"]) {
    test(`native transport refuses ${scenario} startup and terminates the helper`, async (t) => {
        const setup = await fixture(t);
        const children = fake(t, scenario);
        const { RoomReader } = await import(moduleUrl);
        await assert.rejects(RoomReader.open(setup.root), { code: "ROOM_READER_PROTOCOL" });
        assert.equal(children.length, 1);
        assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
    });
}

for (const scenario of ["unexpected-id", "bad-stat", "crash", "short-body", "oversized-payload"]) {
    test(`native transport rejects ${scenario} without returning file contents`, async (t) => {
        const setup = await fixture(t);
        fake(t, scenario);
        const reader = await setup.open();
        await assert.rejects(async () => {
            const file = await reader.openFile("file.txt");
            try {
                return await file.readPrefix(16);
            } finally {
                await file.close();
            }
        }, (error) => /^ROOM_READER_(?:PROTOCOL|EXIT)$/.test(error.code));
    });
}

test("native transport caps pending requests and cancels every abandoned operation", async (t) => {
    const setup = await fixture(t);
    const children = fake(t, "queue");
    const reader = await setup.open();
    const requests = Array.from({ length: 33 }, () => reader.openFile("file.txt"));
    const settled = Promise.allSettled(requests);
    await assert.rejects(requests[32], { code: "ROOM_READER_LIMIT" });
    await reader.close();
    const results = await settled;
    assert.equal(results.length, 33);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
});

test("native transport closes an unresponsive owned helper", { timeout: 8000 }, async (t) => {
    const setup = await fixture(t);
    const children = fake(t, "hang");
    const reader = await setup.open();
    await reader.close();
    assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
});

test("native transport abort does not turn helper unavailability into optional absence", async (t) => {
    const setup = await fixture(t);
    const { RoomReader } = await import(moduleUrl);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(RoomReader.open(setup.root, { signal: controller.signal }), { code: "ROOM_READER_ABORTED" });
    const original = childProcess.spawn;
    const mocked = t.mock.method(childProcess, "spawn", (_file, args, options) =>
        original(path.join(setup.base, "missing-helper"), args, options));
    syncBuiltinESMExports();
    try {
        await assert.rejects(RoomReader.open(setup.root), { code: "ROOM_READER_UNAVAILABLE" });
    } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
    }
});

test("native transport rejects an invalid cancellation signal before launching a helper", async (t) => {
    const setup = await fixture(t);
    const { RoomReader } = await import(moduleUrl);
    const spawn = childProcess.spawn;
    const children = [];
    const mocked = t.mock.method(childProcess, "spawn", (...args) => {
        const child = spawn(...args);
        children.push({ child, closed: once(child, "close") });
        return child;
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(RoomReader.open(setup.root, { signal: {} }), TypeError);
        assert.equal(children.length, 0, "invalid options must not leave a native process behind");
    } finally {
        for (const { child, closed } of children) {
            child.kill();
            await closed;
        }
        mocked.mock.restore();
        syncBuiltinESMExports();
    }
});

for (const stream of ["stdout", "stderr"]) {
    test(`native transport surfaces ${stream} failures and releases the owned helper`, async (t) => {
        const setup = await fixture(t);
        const children = fake(t, "queue");
        const reader = await setup.open();
        const pending = reader.openFile("file.txt").then(
            () => ({ success: true }), (error) => ({ error }),
        );
        assert.doesNotThrow(() => children[0][stream].emit("error", new Error("Fixture stream failure")));
        assert.equal((await pending).error.code, "ROOM_READER_EXIT");
        await reader.close();
        assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
    });
}

test("native path containment accepts filesystem roots without duplicating separators", async () => {
    const { relativeRoomPath, normalizeRoomRoot } = await import("../extensions/project-room-browser/paths.mjs");
    assert.equal(relativeRoomPath("/", "/room.yaml", path.posix), "room.yaml");
    assert.equal(relativeRoomPath("C:\\", "C:\\room.yaml", path.win32), "room.yaml");
    assert.equal(relativeRoomPath("\\\\server\\share\\", "\\\\server\\share\\room.yaml", path.win32), "room.yaml");
    assert.throws(() => relativeRoomPath("C:\\room", "C:\\room-other\\file", path.win32), /escapes/);
    assert.throws(() => relativeRoomPath("/room", "../outside", path.posix), /escapes/);
    assert.throws(() => normalizeRoomRoot(""), /root|path/i);
    assert.throws(() => normalizeRoomRoot("bad\0path"), /root|path/i);
    assert.throws(() => normalizeRoomRoot("bad\ud800path"), /root|path/i);
    assert.throws(() => relativeRoomPath("/room", "bad\ud800path"), /path/i);
    assert.equal(normalizeRoomRoot("room "), path.resolve("room "));
});
