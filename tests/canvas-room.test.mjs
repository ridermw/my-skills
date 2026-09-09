import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, open, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { readRoom, readRoomBytes, readRoomFile } from "../extensions/project-room-browser/room.mjs";
import { makeRoom } from "./helpers/canvas-fixture.mjs";

const exec = promisify(execFile);
const moduleUrl = new URL("../extensions/project-room-browser/room.mjs", import.meta.url).href;
const TEXT_LIMIT = 2 * 1024 * 1024;
const RAW_LIMIT = 25 * 1024 * 1024;
const header = "Source ID,Path,Current or superseded,Change\n";
const inventory = header + "S001,00_originals/report.md,Current,\n";
const chatIndex = "# Chat index\n\n## 1. Fixture chat\n\n**chat_id:** `19:fixture`\n";

test("shared canvas fixture remains readable without optional maintenance files", async (t) => {
    const root = await makeRoom(t, 3);
    const room = await readRoom(root);
    assert.equal(room.name, "Canvas fixture");
    assert.deepEqual(room.valid, {
        hasManifest: true, hasInventory: true, inventoryRows: 3, isEmptyFolder: false,
    });
    assert.deepEqual(room.sources.map((source) => source["Source ID"]), ["S001", "S002", "S003"]);
    assert.equal(room.sources[1].Lifecycle, "current");
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.deepEqual(room.health.uninventoried, []);
    assert.deepEqual(room.health.notCurrent, []);
    assert.equal(room.health.unrecognisedLayout, false);
    assert.deepEqual(room.logs, {});
    assert.equal(room.teams, null);
    assert.equal((await readRoomFile(root, "00_originals/source-2.txt")).text, "Source 2 contents\n");
});

async function put(root, rel, content) {
    const target = path.join(root, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
}

async function fixture(t, manifest = "project: Fixture\n") {
    const base = await mkdtemp(path.join(os.tmpdir(), "canvas-room-test-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const root = path.join(base, "room");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await put(root, "room.yaml", manifest);
    return { base, root, outside };
}

const maintenanceFiles = [
    ["manifest", "room.yaml", "project: Linked fixture\n"],
    ["inventory", "02_inventory/source_inventory.csv", inventory],
    ["chat", "02_inventory/chat-index.md", chatIndex],
    ["readme", "README.md", "# Room readme\n"],
    ["change_log", "99_review/change_log.md", "# Change log\n"],
    ["conflict_log", "99_review/conflict_log.md", "# Conflict log\n"],
    ["duplicate_log", "99_review/duplicate_log.md", "# Duplicate log\n"],
    ["missing_context", "99_review/missing_context.md", "# Missing context\n"],
];

for (const [key, rel, content] of maintenanceFiles) {
    test(`maintenance rejects an outside symlink at the default ${key} path`, async (t) => {
        const { root, outside } = await fixture(t);
        const external = await put(outside, path.basename(rel), content);
        await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        if (key === "manifest") await unlink(path.join(root, rel));
        await symlink(external, path.join(root, rel));
        await assert.rejects(readRoom(root), /Refused: path escapes the room/);
    });

    test(`maintenance permits an inside symlink at the default ${key} path`, async (t) => {
        const { root } = await fixture(t);
        const internal = await put(root, "maintenance/" + path.basename(rel), content);
        await put(root, "00_originals/report.md", "A source\n");
        await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        if (key === "manifest") await unlink(path.join(root, rel));
        await symlink(internal, path.join(root, rel));
        const room = await readRoom(root);
        if (key === "manifest") assert.equal(room.name, "Linked fixture");
        else if (key === "inventory") assert.equal(room.sources[0]["Source ID"], "S001");
        else if (key === "chat") assert.notEqual(room.teams, null);
        else assert.equal(room.logs[key].text, content);
    });
}

for (const [key, filename, content] of [
    ["inventory", "inventory.csv", inventory],
    ["chat_index", "chat.md", chatIndex],
    ["change_log", "changes.md", "# Changes\n"],
]) {
    test(`maintenance rejects manifest-controlled traversal for ${key}`, async (t) => {
        const { root, outside } = await fixture(t, `maintenance_links:\n  ${key}: ../outside/${filename}\n`);
        await put(outside, filename, content);
        await assert.rejects(readRoom(root), /Refused: path escapes the room/);
    });

    test(`maintenance rejects manifest-controlled outside symlinks for ${key}`, async (t) => {
        const { root, outside } = await fixture(t, `maintenance_links:\n  ${key}: linked/${filename}\n`);
        await put(outside, filename, content);
        await symlink(outside, path.join(root, "linked"), "dir");
        await assert.rejects(readRoom(root), /Refused: path escapes the room/);
    });

    test(`maintenance permits manifest-controlled inside symlinks for ${key}`, async (t) => {
        const { root } = await fixture(t, `maintenance_links:\n  ${key}: linked/${filename}\n`);
        await put(root, "maintenance/" + filename, content);
        await put(root, "00_originals/report.md", "A source\n");
        await symlink(path.join(root, "maintenance"), path.join(root, "linked"), "dir");
        const room = await readRoom(root);
        if (key === "inventory") assert.equal(room.sources[0]["Source ID"], "S001");
        else assert.equal(room.logs[key].text, content);
    });
}

test("maintenance rejects a missing leaf beneath an outside directory symlink", async (t) => {
    const { root, outside } = await fixture(t, "maintenance_links:\n  inventory: linked/missing.csv\n");
    await symlink(outside, path.join(root, "linked"), "dir");
    await assert.rejects(readRoom(root), /Refused: path escapes the room/);
});

test("preview rejects a missing leaf beneath an outside directory symlink", async (t) => {
    const { root, outside } = await fixture(t);
    await symlink(outside, path.join(root, "linked"), "dir");
    await assert.rejects(readRoomFile(root, "linked/missing.txt"), /Refused: path escapes the room/);
});

for (const [name, target] of [["dangling", "missing.md"], ["cyclic", "README.md"]]) {
    test(`maintenance surfaces ${name} symlinks instead of treating them as absent`, async (t) => {
        const { root } = await fixture(t);
        await symlink(target, path.join(root, "README.md"));
        await assert.rejects(readRoom(root), /symbolic link|symlink|ELOOP|resolve/i);
    });
}

for (const manifest of [
    "maintenance_links: not-a-map\n",
    "maintenance_links: [inventory.csv]\n",
    "maintenance_links:\n  inventory:\n",
    'maintenance_links:\n  chat_index: ""\n',
    'maintenance_links:\n  change_log: "   "\n',
    'maintenance_links:\n  change_log: "bad\u0000.md"\n',
]) {
    test(`maintenance surfaces malformed link metadata ${JSON.stringify(manifest)}`, async (t) => {
        const { root } = await fixture(t, manifest);
        await assert.rejects(readRoom(root), /maintenance_links|invalid.*path/i);
    });
}

test("maintenance surfaces a directory where an optional file should be", async (t) => {
    const { root } = await fixture(t);
    await mkdir(path.join(root, "README.md"));
    await assert.rejects(readRoom(root), /EISDIR|Not a file/);
});

test("maintenance surfaces a non-directory path component", async (t) => {
    const { root } = await fixture(t, "maintenance_links:\n  inventory: blocker/inventory.csv\n");
    await put(root, "blocker", "not a directory");
    await assert.rejects(readRoom(root), { code: "ENOTDIR" });
});

async function withDeniedAccess(t, target, action) {
    const originalMode = (await stat(target)).mode & 0o777;
    await chmod(target, 0);
    try {
        let handle;
        try {
            handle = await open(target);
        } catch (error) {
            if (error.code !== "EACCES" && error.code !== "EPERM") throw error;
        }
        if (handle) {
            await handle.close();
            t.skip("The current account/filesystem bypasses the fixture's permission denial");
            return;
        }
        await action();
    } finally {
        await chmod(target, originalMode);
    }
}

test("maintenance surfaces permission denial instead of falling back", async (t) => {
    const { root } = await fixture(t);
    const target = await put(root, "02_inventory/source_inventory.csv", inventory);
    await withDeniedAccess(t, target, () => assert.rejects(readRoom(root), /EACCES|EPERM/));
});

test("absent optional data remains absent, including through a symlinked room root", async (t) => {
    const { root, base } = await fixture(t, "project: Optional\nmaintenance_links:\n  inventory: missing/nested/inventory.csv\n");
    const alias = path.join(base, "room-alias");
    await symlink(root, alias, "dir");
    const room = await readRoom(alias);
    assert.equal(room.name, "Optional");
    assert.equal(room.valid.hasManifest, true);
    assert.equal(room.valid.hasInventory, false);
    assert.deepEqual(room.sources, []);
    assert.deepEqual(room.logs, {});
    assert.equal(room.teams, null);
    await unlink(path.join(root, "room.yaml"));
    const empty = await readRoom(root);
    assert.equal(empty.valid.hasManifest, false);
    assert.equal(empty.valid.isEmptyFolder, true);
});

test("missing custom maintenance files fall back to ordinary in-room defaults", async (t) => {
    const { root } = await fixture(t, "maintenance_links:\n  inventory: absent/inventory.md\n  chat_index: absent/chat.md\n");
    await put(root, "02_inventory/source_inventory.csv", inventory);
    await put(root, "02_inventory/chat-index.md", chatIndex);
    await put(root, "00_originals/report.md", "Source\n");
    const room = await readRoom(root);
    assert.equal(room.sources[0].Lifecycle, "Current");
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.notEqual(room.teams, null);
});

test("empty custom inventory does not silently substitute an unrelated default inventory", async (t) => {
    const { root } = await fixture(t, "maintenance_links:\n  inventory: maintenance/empty.csv\n");
    await put(root, "maintenance/empty.csv", "");
    await put(root, "02_inventory/source_inventory.csv", inventory);
    const room = await readRoom(root);
    assert.deepEqual(room.sources, []);
    assert.equal(room.valid.hasInventory, false);
});

test("inventory Markdown maintenance reads are contained even when their CSV is safe", async (t) => {
    const { root, outside } = await fixture(t, "maintenance_links:\n  inventory: maintenance/inventory.md\n");
    await put(root, "maintenance/inventory.csv", header);
    const external = await put(outside, "inventory.md", "# Outside fixture inventory\n");
    await symlink(external, path.join(root, "maintenance/inventory.md"));
    await assert.rejects(readRoom(root), /Refused: path escapes the room/);
});

test("inventory identity resolves room-format paths and legitimate internal aliases", async (t) => {
    const { root, base } = await fixture(t);
    await put(root, "00_originals/report.md", "Source\n");
    await mkdir(path.join(root, "00_originals/nested"));
    await symlink(path.join(root, "00_originals"), path.join(root, "sources"), "dir");
    await put(root, "02_inventory/source_inventory.csv", header
        + "S001,00_originals/nested/../report.md,Current,\n"
        + "S002,sources/report.md,Current,\n");
    const alias = path.join(base, "room-alias");
    await symlink(root, alias, "dir");
    const room = await readRoom(alias);
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.deepEqual(room.health.uninventoried, []);
});

test("inventory identity rejects source paths that traverse outside the room", async (t) => {
    const { root, outside } = await fixture(t);
    await put(outside, "report.md", "Outside fixture source\n");
    await put(root, "02_inventory/source_inventory.csv", header + "S001,../outside/report.md,Current,\n");
    await assert.rejects(readRoom(root), /Refused: path escapes the room/);
});

for (const missing of [false, true]) {
    test(`inventory identity rejects an outside symlink with a ${missing ? "missing" : "present"} target`, async (t) => {
        const { root, outside } = await fixture(t);
        await put(root, "02_inventory/source_inventory.csv", header + "S001,linked/report.md,Current,\n");
        if (!missing) await put(outside, "report.md", "Outside fixture source\n");
        await symlink(outside, path.join(root, "linked"), "dir");
        await assert.rejects(readRoom(root), /Refused: path escapes the room/);
    });
}

test("inventory preserves distinct case-sensitive source identities", async (t) => {
    const { root } = await fixture(t);
    const original = await put(root, "00_originals/Report.md", "Upper\n");
    const lower = path.join(root, "00_originals/report.md");
    try {
        await writeFile(lower, "Lower\n", { flag: "wx" });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
        assert.equal((await stat(original)).ino, (await stat(lower)).ino);
        t.skip("The fixture filesystem does not support distinct case-only filenames");
        return;
    }
    await put(root, "02_inventory/source_inventory.csv", header + "S001,00_originals/Report.md,Current,\n");
    const room = await readRoom(root);
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.deepEqual(room.health.uninventoried, [path.join("00_originals", "report.md")]);
    await unlink(original);
    const missing = await readRoom(root);
    assert.deepEqual(missing.health.missingOnDisk, [{ id: "S001", path: "00_originals/Report.md" }]);
});

test("inventory accepts case aliases only when the real filesystem accepts them", async (t) => {
    const { root } = await fixture(t);
    await put(root, "00_originals/Report.md", "Source\n");
    let aliasExists = true;
    try {
        await stat(path.join(root, "00_originals/report.md"));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        aliasExists = false;
    }
    await put(root, "02_inventory/source_inventory.csv", header + "S001,00_originals/report.md,Current,\n");
    const room = await readRoom(root);
    assert.deepEqual(room.health.missingOnDisk, aliasExists ? [] : [{ id: "S001", path: "00_originals/report.md" }]);
    assert.deepEqual(room.health.uninventoried, aliasExists ? [] : [path.join("00_originals", "Report.md")]);
});

test("inventory follows actual filesystem Unicode identity rather than normalizing distinct names", async (t) => {
    const { root } = await fixture(t);
    await put(root, "00_originals/caf\u00e9.md", "Source\n");
    const alias = "00_originals/cafe\u0301.md";
    let aliasExists = true;
    try {
        await realpath(path.join(root, alias));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        aliasExists = false;
    }
    await put(root, "02_inventory/source_inventory.csv", header + `S001,${alias},Current,\n`);
    const room = await readRoom(root);
    assert.deepEqual(room.health.missingOnDisk, aliasExists ? [] : [{ id: "S001", path: alias }]);
    assert.equal(room.health.uninventoried.length, aliasExists ? 0 : 1);
});

test("walk includes a registered source deeper than five levels without following symlink cycles", async (t) => {
    const { root } = await fixture(t);
    const rel = "00_originals/a/b/c/d/e/f/g/h/source.md";
    await put(root, rel, "Deep source\n");
    await put(root, "02_inventory/source_inventory.csv", header + `S001,${rel},Current,\n`);
    await symlink(root, path.join(root, "00_originals/a/back-to-root"), "dir");
    const room = await readRoom(root);
    assert.equal(room.files.some((file) => file.rel === path.join(...rel.split("/"))), true);
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.deepEqual(room.health.uninventoried, []);
});

test("walk surfaces an unreadable directory rather than a healthy partial listing", async (t) => {
    const { root } = await fixture(t);
    const target = path.join(root, "00_originals/denied");
    await mkdir(target, { recursive: true });
    await put(root, "00_originals/denied/source.md", "Source\n");
    await withDeniedAccess(t, target, () => assert.rejects(readRoom(root), /EACCES|EPERM/));
});

test("coverage includes nested README/index sources while preserving generated and output exclusions", async (t) => {
    const { root } = await fixture(t);
    for (const rel of [
        "00_originals/README.md", "00_originals/readme.md", "00_originals/index.md",
        "01_inbox/README.md", "06_evidence/index.md", "05_outputs/draft.md",
        "00_originals/_superseded/old.md", "00_originals/nested/_superseded/old.md",
        "00_originals/node_modules/dependency.md", "00_originals/.git/config",
        "00_originals/nested/README.md", "01_inbox/nested/index.md",
        "06_evidence/nested/readme.md",
    ]) await put(root, rel, "Fixture\n");
    const room = await readRoom(root);
    assert.deepEqual(room.health.uninventoried.sort(), [
        path.join("00_originals", "nested", "README.md"),
        path.join("01_inbox", "nested", "index.md"),
        path.join("06_evidence", "nested", "readme.md"),
    ].sort());
    assert.deepEqual(room.health.inboxPending, [path.join("01_inbox", "nested", "index.md")]);
});

test("canonical lifecycle still drives historical and unavailable source health", async (t) => {
    const { root } = await fixture(t);
    await put(root, "00_originals/old.md", "Old source\n");
    await put(root, "02_inventory/source_inventory.csv", header
        + "S001,00_originals/old.md,Historical (abandoned approach),\n"
        + "S002,00_originals/unavailable.md,Unavailable,\n"
        + "S003,00_originals/removed.md,Current,[REMOVED]\n");
    const room = await readRoom(root);
    assert.equal(room.sources[0].Lifecycle, "Historical (abandoned approach)");
    assert.equal(room.health.notCurrent[0].id, "S001");
    assert.deepEqual(room.health.missingOnDisk, []);
});

test("superseded authority marks a canonically current source as not current", async (t) => {
    const { root } = await fixture(t);
    for (const name of ["superseded.md", "current.md", "abandoned.md"]) {
        await put(root, "00_originals/" + name, "Fixture source\n");
    }
    await put(root, "02_inventory/source_inventory.csv",
        "Source ID,Path,Authority,Current or superseded\n"
        + "S001,00_originals/superseded.md,superseded,current\n"
        + "S002,00_originals/current.md,authoritative,current\n"
        + "S003,00_originals/abandoned.md,supporting,abandoned\n");
    const room = await readRoom(root);
    assert.equal(room.sources[0].Lifecycle, "current");
    assert.equal(room.sources[0]["Current or superseded"], "current");
    assert.deepEqual(room.health.notCurrent.map((source) => source.id), ["S001", "S003"]);
    assert.deepEqual(room.health.notCurrent[0], {
        id: "S001", path: "00_originals/superseded.md",
        authority: "superseded", lifecycle: "current", partial: false, runnable: false,
    });
});

test("preview leaves small text and its metadata unchanged", async (t) => {
    const { root } = await fixture(t);
    const target = await put(root, "small.txt", "\uFEFFSmall caf\u00e9\n");
    const info = await stat(target);
    const result = await readRoomFile(root, "small.txt");
    assert.deepEqual(result, {
        rel: "small.txt", size: info.size, ext: ".txt",
        mtime: info.mtime.toISOString().slice(0, 10),
        kind: "text", truncated: false, text: "Small caf\u00e9\n",
    });
});

for (const [character, prefixLength] of [
    ["\u00e9", TEXT_LIMIT - 1],
    ["\u20ac", TEXT_LIMIT - 1],
    ["\u{1f642}", TEXT_LIMIT - 2],
    ["\u20ac", TEXT_LIMIT - 3],
]) {
    test(`preview preserves the UTF-8 boundary for ${character} at byte ${prefixLength}`, async (t) => {
        const { root } = await fixture(t);
        const bytes = Buffer.concat([Buffer.alloc(prefixLength, 0x61), Buffer.from(character + "tail")]);
        await put(root, "utf8.txt", bytes);
        const result = await readRoomFile(root, "utf8.txt");
        const fits = prefixLength + Buffer.byteLength(character) <= TEXT_LIMIT;
        assert.equal(result.text, "a".repeat(prefixLength) + (fits ? character : ""));
        assert.equal(result.truncated, true);
        assert.equal(result.size, bytes.length);
    });
}

for (const encoding of ["utf16le", "utf16be"]) {
    for (const odd of [false, true]) {
        test(`preview decodes ${encoding} BOM text with ${odd ? "an odd" : "an even"} byte length`, async (t) => {
            const { root } = await fixture(t);
            let bytes = Buffer.from("\uFEFFHello \u{1f642}", "utf16le");
            if (encoding === "utf16be") bytes = bytes.swap16();
            if (odd) bytes = Buffer.concat([bytes, Buffer.from([0x61])]);
            await put(root, "utf16.unknown", bytes);
            const result = await readRoomFile(root, "utf16.unknown");
            assert.equal(result.kind, "text");
            assert.equal(result.encoding, encoding);
            assert.equal(result.text, "Hello \u{1f642}");
            assert.equal(result.truncated, false);
        });
    }

    test(`preview does not split a ${encoding} surrogate pair at the byte limit`, async (t) => {
        const { root } = await fixture(t);
        const prefix = "a".repeat((TEXT_LIMIT - 4) / 2);
        let bytes = Buffer.from("\uFEFF" + prefix + "\u{1f642}tail", "utf16le");
        if (encoding === "utf16be") bytes = bytes.swap16();
        await put(root, "utf16.txt", bytes);
        const result = await readRoomFile(root, "utf16.txt");
        assert.ok(result.text === prefix, "Preview must not end with half of a surrogate pair");
        assert.equal(result.encoding, encoding);
        assert.equal(result.truncated, true);
    });
}

test("preview classifies unknown binary bytes without exposing them as text", async (t) => {
    const { root } = await fixture(t);
    await put(root, "data.unknown", Buffer.from([0x61, 0, 0xff, 0x62]));
    const result = await readRoomFile(root, "data.unknown");
    assert.equal(result.kind, "binary");
    assert.equal(result.truncated, false);
    assert.equal(result.text, undefined);
    await put(root, "text.unknown", "Unknown but readable\n");
    assert.equal((await readRoomFile(root, "text.unknown")).text, "Unknown but readable\n");
});

test("preview reads a bounded prefix of a real sparse multi-GiB file under a constrained heap", async (t) => {
    const { root } = await fixture(t);
    const size = 3 * 1024 * 1024 * 1024 + 1;
    const handle = await open(path.join(root, "large.txt"), "w");
    try {
        await handle.write("Sparse fixture\n");
        await handle.truncate(size);
    } finally {
        await handle.close();
    }
    const info = await stat(path.join(root, "large.txt"));
    assert.ok(info.blocks * 512 < TEXT_LIMIT, "Fixture must remain sparse, not allocate GiB on disk");
    const { stdout } = await exec(process.execPath, [
        "--max-old-space-size=48", "--input-type=module", "-e", `
            import assert from "node:assert/strict";
            import { readRoomFile } from ${JSON.stringify(moduleUrl)};
            const before = process.memoryUsage().arrayBuffers;
            const result = await readRoomFile(process.argv[1], "large.txt");
            assert.equal(result.kind, "text");
            assert.equal(result.size, ${size});
            assert.equal(result.truncated, true);
            assert.equal(result.text.length, ${TEXT_LIMIT});
            assert.ok(result.text.startsWith("Sparse fixture\\n"));
            const allocated = process.memoryUsage().arrayBuffers - before;
            assert.ok(allocated < 32 * 1024 * 1024, "Preview allocated " + allocated + " bytes");
            console.log("bounded sparse preview");
        `, root,
    ], { timeout: 30000 });
    assert.equal(stdout.trim(), "bounded sparse preview");
});

test("raw image preview retains byte/MIME semantics and refuses over-limit files", async (t) => {
    const { root } = await fixture(t);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
    await put(root, "small.png", bytes);
    const result = await readRoomBytes(root, "small.png");
    assert.deepEqual(result, { buf: bytes, mime: "image/png" });
    const image = await readRoomFile(root, "small.png");
    assert.equal(image.kind, "image");
    assert.equal(image.truncated, false);
    const handle = await open(path.join(root, "large.png"), "w");
    try {
        await handle.truncate(RAW_LIMIT + 1);
    } finally {
        await handle.close();
    }
    await assert.rejects(readRoomBytes(root, "large.png"), /exceeds the preview limit/);
    await put(root, "not-image.txt", "Text\n");
    await assert.rejects(readRoomBytes(root, "not-image.txt"), /not an image/);
});

test("preview closes file handles on text, binary, image and error returns", async (t) => {
    if (process.platform === "win32") {
        t.skip("This real descriptor-limit regression requires a POSIX shell");
        return;
    }
    const { root } = await fixture(t);
    await put(root, "text.txt", "Text\n");
    await put(root, "binary.unknown", Buffer.from([0, 1]));
    await put(root, "image.png", Buffer.from([0x89, 0x50]));
    await mkdir(path.join(root, "directory"));
    const script = `
        import assert from "node:assert/strict";
        import { readRoomFile, readRoomBytes } from ${JSON.stringify(moduleUrl)};
        const root = process.argv[1];
        for (let i = 0; i < 80; i++) {
            await readRoomFile(root, "text.txt");
            await readRoomFile(root, "binary.unknown");
            await readRoomFile(root, "image.png");
            await readRoomBytes(root, "image.png");
            await assert.rejects(readRoomFile(root, "directory"), /Not a file/);
            await assert.rejects(readRoomBytes(root, "text.txt"), /not an image/);
        }
        console.log("handles closed");
    `;
    const { stdout } = await exec("/bin/sh", [
        "-c", 'ulimit -n 64 && exec "$@"', "preview-test",
        process.execPath, "--input-type=module", "-e", script, root,
    ], { timeout: 30000 });
    assert.equal(stdout.trim(), "handles closed");
});
