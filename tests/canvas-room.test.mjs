import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, open, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { browseDir, parseSimpleYaml, readRoom, readRoomBytes, readRoomFile, repoList } from "../extensions/project-room-browser/room.mjs";
import * as roomModule from "../extensions/project-room-browser/room.mjs";
import { sweepPlan } from "../extensions/project-room-browser/teams.mjs";
import { makeRoom } from "./helpers/canvas-fixture.mjs";

const exec = promisify(execFile);
const moduleUrl = new URL("../extensions/project-room-browser/room.mjs", import.meta.url).href;
const TEXT_LIMIT = 2 * 1024 * 1024;
const RAW_LIMIT = 25 * 1024 * 1024;
const METADATA_LIMIT = 2 * 1024 * 1024;
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

for (const [name, text] of [
    ["header", '"Source ID,Path'],
    ["final field", 'Source ID,Path\nS001,"00_originals/report.md'],
    ["multiline field", 'Source ID,Path\nS001,"first line\r\nsecond line\n'],
    ["escaped quote at EOF", 'Source ID,Path\nS001,"unfinished ""'],
]) {
    test(`CSV quoted EOF rejects an unterminated ${name} instead of returning partial metadata`, () => {
        assert.throws(() => roomModule.parseCsv(text), /unterminated.*quot/i);
        assert.throws(() => roomModule.csvToObjects(text), /unterminated.*quot/i);
    });
}

for (const ending of ["", "\n", "\r\n"]) {
    test(`CSV quoted EOF preserves closed, escaped and multiline fields with ${JSON.stringify(ending)}`, () => {
        const text = 'Source ID,Path,Note\r\nS001,"00_originals/a,b.md","first\r\nsecond ""quoted"""\r\nS002,"",""' + ending;
        assert.deepEqual(roomModule.parseCsv(text), [
            ["Source ID", "Path", "Note"],
            ["S001", "00_originals/a,b.md", 'first\r\nsecond "quoted"'],
            ["S002", "", ""],
        ]);
    });
}

test("CSV quoted EOF prevents readRoom from reporting a malformed inventory as valid", async (t) => {
    const { root } = await fixture(t);
    await put(root, "02_inventory/source_inventory.csv", '"Source ID,Path\nS001,00_originals/report.md');
    await assert.rejects(readRoom(root), /unterminated.*quot/i);
});

for (const [input, expected] of [
    [String.raw`C:\rooms\alpha`, String.raw`C:\rooms\alpha`],
    ["https://example.test/repo", "https://example.test/repo"],
    ["urn:example:room:alpha", "urn:example:room:alpha"],
    [String.raw`"C:\rooms\quoted"`, String.raw`C:\rooms\quoted`],
    ["'label: still a scalar'", "label: still a scalar"],
]) {
    test(`YAML sequence preserves the colon-bearing scalar ${input}`, () => {
        assert.deepEqual(parseSimpleYaml(`repos:\n  - ${input}\n`), { repos: [expected] });
    });
}

test("YAML mapping separators require whitespace or end for both matcher sites", () => {
    const parsed = parseSimpleYaml([
        "project: Canonical", "status:ready", "https://example.test/repo",
        "repos:", "  - name: alpha", String.raw`    path: C:\rooms\alpha`,
        "    url:https://ignored.example.test", "  - name:", "    url:\thttps://example.test/repo", "",
    ].join("\n"));
    assert.deepEqual(parsed, {
        project: "Canonical",
        repos: [{ name: "alpha", path: String.raw`C:\rooms\alpha` }, { name: "", url: "https://example.test/repo" }],
    });
});

test("YAML canonical manifests retain nested links, map items and repository scalars", async (t) => {
    const { root } = await fixture(t, [
        "project: Canonical fixture", "review_status: needs_review",
        "maintenance_links:", "  inventory: 02_inventory/source_inventory.csv",
        "  change_log: 99_review/change_log.md",
        "repos:", "  - https://example.test/repo", "  - name: upstream", "    url: https://example.test/upstream",
        "note: |", "  Keep the original source IDs.", "",
    ].join("\n"));
    await put(root, "00_originals/report.md", "Source\n");
    await put(root, "02_inventory/source_inventory.csv", inventory);
    await put(root, "99_review/change_log.md", "# Changes\n");
    const room = await readRoom(root);
    assert.equal(room.name, "Canonical fixture");
    assert.equal(room.valid.hasInventory, true);
    assert.equal(room.logs.change_log.text, "# Changes\n");
    assert.equal(room.room.note, "Keep the original source IDs.");
    assert.deepEqual(repoList(room.room).map(({ location, isUrl }) => ({ location, isUrl })), [
        { location: "https://example.test/repo", isUrl: true },
        { location: "https://example.test/upstream", isUrl: true },
    ]);
    assert.deepEqual(room.health.missingOnDisk, []);
});

async function ignoredEntries(dir, count) {
    for (let first = 0; first < count; first += 64) {
        await Promise.all(Array.from({ length: Math.min(64, count - first) }, (_, offset) =>
            writeFile(path.join(dir, `._ignored-${first + offset}`), "")));
    }
}

test("scan budget accepts exactly 10000 examined entries including ignored types, then refuses overflow", async (t) => {
    const { root } = await fixture(t);
    await put(root, "00_originals/report.md", "Source\n");
    await put(root, "02_inventory/source_inventory.csv", inventory);
    await put(root, ".git/config", "Ignored contents\n");
    await put(root, "node_modules/dependency/index.js", "Ignored contents\n");
    await put(root, ".DS_Store", "");
    await symlink(path.join(root, "00_originals"), path.join(root, "source-alias"), "dir");
    // Five ordinary entries plus .git, node_modules, .DS_Store and the symlink.
    await ignoredEntries(root, 9991);
    const room = await readRoom(root);
    assert.equal(room.files.length, 3);
    assert.deepEqual(room.health.missingOnDisk, []);
    assert.deepEqual(room.health.uninventoried, []);
    await put(root, "._overflow", "");
    await assert.rejects(readRoom(root), (error) => {
        assert.equal(error.code, "ROOM_SCAN_LIMIT");
        assert.match(error.message, /10,000.*entries/i);
        assert.match(error.message, /unverified/i);
        return true;
    });
});

test("scan budget is shared across useful depth and still inspects folders without a manifest", async (t) => {
    const { root } = await fixture(t);
    await unlink(path.join(root, "room.yaml"));
    const deep = path.join(root, ...Array(80).fill("d"));
    await mkdir(deep, { recursive: true });
    await ignoredEntries(root, 5000);
    await ignoredEntries(deep, 4920);
    const room = await readRoom(root);
    assert.equal(room.valid.hasManifest, false);
    assert.equal(room.health.unrecognisedLayout, true);
    assert.deepEqual(room.files, []);
    await put(deep, "._overflow", "");
    await assert.rejects(readRoom(root), { code: "ROOM_SCAN_LIMIT" });
});

test("scan budget bounds directory handles and closes them on overflow and read errors", async (t) => {
    if (process.platform === "win32") {
        t.skip("This real descriptor-limit regression requires a POSIX shell");
        return;
    }
    const { root, base } = await fixture(t);
    const deep = path.join(root, ...Array(100).fill("d"));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, "deep.txt"), "Deep source\n");
    const overflow = path.join(base, "overflow");
    await mkdir(overflow);
    await ignoredEntries(overflow, 10001);
    const blocked = path.join(base, "blocked");
    const denied = path.join(blocked, "denied");
    await mkdir(denied, { recursive: true });
    await writeFile(path.join(denied, "source.txt"), "Denied source\n");
    await withDeniedAccess(t, denied, async () => {
        const script = `
            import assert from "node:assert/strict";
            import { readRoom } from ${JSON.stringify(moduleUrl)};
            for (let i = 0; i < 80; i++) {
                const room = await readRoom(process.argv[1]);
                assert.ok(room.files.some((file) => file.name === "deep.txt"));
                await assert.rejects(readRoom(process.argv[2]), { code: "ROOM_SCAN_LIMIT" });
                await assert.rejects(readRoom(process.argv[3]), /EACCES|EPERM/);
            }
            console.log("scan handles closed");
        `;
        const { stdout } = await exec("/bin/sh", [
            "-c", 'ulimit -n 64 && exec "$@"', "scan-test",
            process.execPath, "--input-type=module", "-e", script, root, overflow, blocked,
        ], { timeout: 90000 });
        assert.equal(stdout.trim(), "scan handles closed");
    });
});

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

for (const [key, rel, content] of maintenanceFiles) {
    test(`metadata limit accepts exactly 2 MiB at the ${key} path`, async (t) => {
        const { root } = await fixture(t);
        await put(root, rel, content + " ".repeat(METADATA_LIMIT - Buffer.byteLength(content)));
        const room = await readRoom(root);
        if (key === "manifest") assert.equal(room.name, "Linked fixture");
        else if (key === "inventory") assert.equal(room.sources[0]["Source ID"], "S001");
        else if (key === "chat") assert.equal(room.teams.conversations.length, 1);
        else assert.equal(Buffer.byteLength(room.logs[key].text), METADATA_LIMIT);
    });

    test(`metadata limit rejects rather than truncates an oversized ${key}`, async (t) => {
        const { root } = await fixture(t);
        await put(root, rel, content + " ".repeat(METADATA_LIMIT + 1 - Buffer.byteLength(content)));
        await assert.rejects(readRoom(root), (error) => {
            assert.match(error.message, /metadata.*limit/i);
            assert.ok(error.message.includes(rel), "The error must identify the oversized maintenance file");
            return true;
        });
    });
}

test("metadata limit rejects a sparse multi-GiB manifest under a constrained heap", async (t) => {
    const { root } = await fixture(t);
    const handle = await open(path.join(root, "room.yaml"), "r+");
    try {
        await handle.truncate(3 * 1024 * 1024 * 1024 + 1);
    } finally {
        await handle.close();
    }
    assert.ok((await stat(path.join(root, "room.yaml"))).blocks * 512 < METADATA_LIMIT);
    const { stdout } = await exec(process.execPath, [
        "--max-old-space-size=48", "--input-type=module", "-e", `
            import assert from "node:assert/strict";
            import { readRoom } from ${JSON.stringify(moduleUrl)};
            const before = process.memoryUsage().arrayBuffers;
            await assert.rejects(readRoom(process.argv[1]), /metadata.*limit/i);
            assert.ok(process.memoryUsage().arrayBuffers - before < 8 * 1024 * 1024);
            console.log("bounded metadata rejection");
        `, root,
    ], { timeout: 30000 });
    assert.equal(stdout.trim(), "bounded metadata rejection");
});

test("metadata reads close handles after valid, oversized and non-file inputs", async (t) => {
    if (process.platform === "win32") {
        t.skip("This real descriptor-limit regression requires a POSIX shell");
        return;
    }
    const { root, base } = await fixture(t);
    const oversized = path.join(base, "oversized");
    const invalid = path.join(base, "invalid");
    await put(oversized, "room.yaml", Buffer.alloc(METADATA_LIMIT + 1, 0x20));
    await mkdir(path.join(invalid, "room.yaml"), { recursive: true });
    const script = `
        import assert from "node:assert/strict";
        import { readRoom } from ${JSON.stringify(moduleUrl)};
        for (let i = 0; i < 80; i++) {
            assert.equal((await readRoom(process.argv[1])).name, "Fixture");
            await assert.rejects(readRoom(process.argv[2]), /metadata.*limit/i);
            await assert.rejects(readRoom(process.argv[3]), /Not a file/);
        }
        console.log("metadata handles closed");
    `;
    const { stdout } = await exec("/bin/sh", [
        "-c", 'ulimit -n 64 && exec "$@"', "metadata-test",
        process.execPath, "--input-type=module", "-e", script, root, oversized, invalid,
    ], { timeout: 30000 });
    assert.equal(stdout.trim(), "metadata handles closed");
});

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

test("chat fallback reports the effective default index path", async (t) => {
    const { root } = await fixture(t, "maintenance_links:\n  chat_index: absent/custom.md\n");
    await put(root, "02_inventory/chat-index.md", chatIndex);
    const room = await readRoom(root);
    assert.equal(room.teams.rel, "02_inventory/chat-index.md");
    assert.equal(room.teams.conversations[0].name, "Fixture chat");
});

for (const [name, text] of [["empty", ""], ["whitespace", " \n\t"], ["unparseable", "# Not a chat index\n"]]) {
    test(`an existing ${name} chat index reports an explicit error`, async (t) => {
        const { root } = await fixture(t);
        await put(root, "02_inventory/chat-index.md", text);
        const room = await readRoom(root);
        assert.equal(typeof room.teams?.error, "string");
        assert.match(room.teams.error, /chat index/i);
        assert.equal(room.teams.rel, "02_inventory/chat-index.md");
    });
}

test("an existing empty custom chat index is not replaced by a valid default", async (t) => {
    const { root } = await fixture(t, "maintenance_links:\n  chat_index: maintenance/custom.md\n");
    await put(root, "maintenance/custom.md", "");
    await put(root, "02_inventory/chat-index.md", chatIndex);
    const room = await readRoom(root);
    assert.equal(typeof room.teams?.error, "string");
    assert.equal(room.teams.rel, "maintenance/custom.md");
});

test("unregistered captures require exact distinctive tokens rather than name substrings", async (t) => {
    const { root } = await fixture(t);
    await put(root, "02_inventory/chat-index.md", "# Chat index\n\n"
        + "## 1. Alpha chat\n\n**chat_id:** `19:alpha`\n\n"
        + "## 2. Alphabet chat\n\n**chat_id:** `19:alphabet`\n");
    await put(root, "00_originals/alpha-transcript.md", "Alpha\n");
    await put(root, "00_originals/alphabet-transcript.md", "Alphabet\n");
    await put(root, "02_inventory/source_inventory.csv", "Source ID,Path,Source type,Date\n"
        + "S001,00_originals/alpha-transcript.md,transcript,2026-09-08\n"
        + "S002,00_originals/alphabet-transcript.md,transcript,2026-09-08\n");
    const room = await readRoom(root);
    assert.deepEqual(room.teams.conversations.map((conversation) => ({
        name: conversation.name,
        ids: conversation.unregistered.map((source) => source.id),
    })), [
        { name: "Alpha chat", ids: ["S001"] },
        { name: "Alphabet chat", ids: ["S002"] },
    ]);
    assert.equal(room.teams.counts.unregistered, 2);
});

test("unregistered captures compare full explicit Source IDs without collapsing prefixes or numbers", async (t) => {
    const { root } = await fixture(t);
    await put(root, "02_inventory/chat-index.md", "# Chat index\n\n"
        + "## 1. Alpha chat\n\n**chat_id:** `19:alpha`\n\n"
        + "| Source | File | Captured | Complete |\n|---|---|---|---|\n"
        + "| S004 | 00_originals/alpha-registered.md | 2026-09-01 | yes |\n");
    const rows = ["Source ID,Path,Source type,Date"];
    for (const [id, name] of [
        ["S004", "registered"], ["MEMO-S004", "memo"], ["OTHER-S004", "other"], ["S4", "short"],
    ]) {
        await put(root, `00_originals/alpha-${name}.md`, "Transcript\n");
        rows.push(`${id},00_originals/alpha-${name}.md,transcript,2026-09-08`);
    }
    await put(root, "02_inventory/source_inventory.csv", rows.join("\n"));
    const room = await readRoom(root);
    const conversation = room.teams.conversations[0];
    assert.deepEqual(conversation.sourceIds, ["S004"]);
    assert.deepEqual(conversation.unregistered.map((source) => source.id), ["MEMO-S004", "OTHER-S004", "S4"]);
});

for (const sourceDir of ["00_originals", "01_inbox", "06_evidence"]) {
    test(`source layout recognises an empty top-level ${sourceDir} directory`, async (t) => {
        const { root } = await fixture(t);
        await mkdir(path.join(root, sourceDir));
        const room = await readRoom(root);
        assert.deepEqual(room.health.recognisedDirs, [sourceDir]);
        assert.equal(room.health.unrecognisedLayout, false);
        assert.deepEqual(room.health.uninventoried, []);
    });
}

test("source layout does not recognise a file named like a source directory", async (t) => {
    const { root } = await fixture(t);
    await put(root, "00_originals", "Not a directory\n");
    const room = await readRoom(root);
    assert.deepEqual(room.health.recognisedDirs, []);
    assert.equal(room.health.unrecognisedLayout, true);
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
        const prefix = Buffer.alloc(TEXT_LIMIT + 4, 0x61);
        prefix.write("Sparse fixture\n");
        await handle.write(prefix);
        await handle.truncate(size);
    } finally {
        await handle.close();
    }
    const info = await stat(path.join(root, "large.txt"));
    assert.ok(info.blocks * 512 < TEXT_LIMIT * 2, "Fixture must remain sparse, not allocate GiB on disk");
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

for (const [name, pathImpl, absolutePath, expected] of [
    ["POSIX root", path.posix, "/", [{ name: "/", path: "/" }]],
    ["POSIX descendants", path.posix, "/rooms/project/", [
        { name: "/", path: "/" }, { name: "rooms", path: "/rooms" }, { name: "project", path: "/rooms/project" },
    ]],
    ["Windows drive root", path.win32, "C:\\", [{ name: "C:\\", path: "C:\\" }]],
    ["Windows drive descendants", path.win32, "C:\\rooms\\project\\", [
        { name: "C:\\", path: "C:\\" }, { name: "rooms", path: "C:\\rooms" },
        { name: "project", path: "C:\\rooms\\project" },
    ]],
    ["UNC share root", path.win32, "\\\\server\\share", [
        { name: "\\\\server\\share\\", path: "\\\\server\\share\\" },
    ]],
    ["UNC descendants", path.win32, "\\\\server\\share\\rooms\\project", [
        { name: "\\\\server\\share\\", path: "\\\\server\\share\\" },
        { name: "rooms", path: "\\\\server\\share\\rooms" },
        { name: "project", path: "\\\\server\\share\\rooms\\project" },
    ]],
]) {
    test(`path breadcrumbs preserve the ${name} boundary`, () => {
        assert.equal(typeof roomModule.pathBreadcrumbs, "function");
        assert.deepEqual(roomModule.pathBreadcrumbs(absolutePath, pathImpl), expected);
    });
}

test("path breadcrumbs reject relative inputs rather than deriving targets from process cwd", () => {
    assert.equal(typeof roomModule.pathBreadcrumbs, "function");
    assert.throws(() => roomModule.pathBreadcrumbs("rooms/project", path.posix), /absolute path/i);
    assert.throws(() => roomModule.pathBreadcrumbs("C:rooms", path.win32), /absolute path/i);
});

test("browseDir provides native root-to-target breadcrumbs for a real fixture directory", async (t) => {
    const { root, base } = await fixture(t);
    const result = await browseDir(root);
    assert.ok(Array.isArray(result.breadcrumbs));
    const filesystemRoot = path.parse(root).root;
    assert.deepEqual(result.breadcrumbs[0], { name: filesystemRoot, path: filesystemRoot });
    assert.deepEqual(result.breadcrumbs.slice(-2), [
        { name: path.basename(base), path: base }, { name: "room", path: root },
    ]);
    assert.equal(result.path, root);
    assert.equal(result.parent, base);
    assert.equal(result.isRoom, true);
});

async function indexedConversations(t, { names = ["Alpha chat"], sources = [] } = {}) {
    const { root } = await fixture(t);
    const sections = ["# Chat index"];
    const rows = ["Source ID,Path,Source type,Date,Current or superseded,Authority"];
    for (const [i, name] of names.entries()) {
        const id = "S" + String(i + 1).padStart(3, "0");
        const rel = `00_originals/registered-${i + 1}.json`;
        await put(root, rel, "{}");
        rows.push(`${id},${rel},chat,2020-02-01,current,authoritative`);
        sections.push(
            `## ${i + 1}. ${name}`, `**chat_id:** \`19:fixture-${i + 1}\``, "",
            "| Source | File | Captured | Complete |", "| --- | --- | --- | --- |",
            `| ${id} current | ${rel} | 2020-02-01 | complete |`, "",
        );
    }
    for (const source of sources) {
        await put(root, source.path, "Fixture capture\n");
        rows.push([
            source.id, source.path, source.type || "transcript", source.date || "",
            source.lifecycle ?? "current", source.authority ?? "authoritative",
        ].join(","));
    }
    await put(root, "02_inventory/chat-index.md", sections.join("\n"));
    await put(root, "02_inventory/source_inventory.csv", rows.join("\n"));
    return { root, index: sections.join("\n") };
}

for (const [file, type, artifact] of [
    ["chatter.md", "Document", false],
    ["recapitalization-notes.md", "Document", false],
    ["transcriptome.csv", "Dataset", false],
    ["prechat.md", "Document", false],
    ["insightsarchive.md", "Document", false],
    ["chat\u00e9.md", "Document", false],
    ["\u00e9chat.md", "Document", false],
    ["ordinary.md", "Document", false],
    ["transcripts.json", "JSON", true],
    ["recaps.json", "JSON", true],
    ["meeting_summaries.md", "Document", true],
    ["meeting-summary.md", "Document", true],
    ["CHATS.json", "JSON", true],
    ["copilot-insights.json", "JSON", true],
    ["1x1-notes.json", "JSON", true],
    ["ordinary.md", "Teams 1:1", true],
    ["ordinary.md", "Meeting summary", true],
    ["ordinary.md", "transcript", true],
]) {
    test(`artifact terms classify ${file} / ${type} without substring guesses`, async (t) => {
        const source = { id: "MEMO-S0900", path: "00_originals/" + file, type, date: "2020-02-01" };
        const { root } = await indexedConversations(t, { sources: [source] });
        const room = await readRoom(root);
        assert.equal(room.sources.length, 2);
        assert.equal(room.sources[1]["Source ID"], source.id);
        assert.deepEqual(room.teams.unattributedCaptures, artifact ? [source] : []);
        assert.equal(room.teams.counts.unattributedCaptures, artifact ? 1 : 0);
        assert.deepEqual(room.teams.conversations[0].unregistered, []);
    });
}

test("ambiguous multi-name inventory sources preserve both stale verdicts and expose attribution conflicts", async (t) => {
    const source = {
        id: "MEMO-S900", path: "00_originals/alpha-beta-transcript.md",
        date: new Date().toISOString().slice(0, 10), type: "transcript",
    };
    const { root } = await indexedConversations(t, { names: ["Alpha chat", "Beta chat"], sources: [source] });
    const { teams } = await readRoom(root);
    assert.ok(teams.conversations.every((c) => c.unregistered.length === 0));
    const conflict = {
        source,
        candidates: [
            { index: 1, name: "Alpha chat", chatId: "19:fixture-1" },
            { index: 2, name: "Beta chat", chatId: "19:fixture-2" },
        ],
    };
    assert.deepEqual(teams.attributionConflicts, [conflict]);
    for (const c of teams.conversations) {
        assert.deepEqual(c.attributionConflicts, [conflict]);
        assert.equal(c.staleDateDisputed, false);
        assert.equal(c.isStale, true);
        assert.equal(c.needsReconciliation, true);
        assert.equal(c.needsRecapture, true);
    }
    assert.equal(teams.counts.unregistered, 0);
    assert.equal(teams.counts.attributionConflicts, 1);
    assert.equal(teams.counts.stale, 2);
    assert.equal(teams.counts.needsReconciliation, 2);
    assert.equal(sweepPlan(teams).targets.length, 2);
});

test("unique inventory attribution cannot resolve an existing conversation identity conflict", async (t) => {
    const source = {
        id: "S900", path: "00_originals/alpha-transcript.md",
        date: new Date().toISOString().slice(0, 10), type: "transcript",
    };
    const { root, index } = await indexedConversations(t, { names: ["Alpha chat", "Beta chat"], sources: [source] });
    await put(root, "02_inventory/chat-index.md", index + "\n## Quick map\n"
        + "| # | Conversation | chat_id | Sources | Fully captured? |\n"
        + "| --- | --- | --- | --- | --- |\n"
        + "| 2 | Alpha chat | `19:fixture-1` | S900 | complete |\n");
    const { teams } = await readRoom(root);
    assert.deepEqual(teams.conversations[0].unregistered, [source]);
    assert.equal(teams.identityConflicts.length, 1);
    assert.equal(teams.conversations[0].staleDateDisputed, false);
    assert.equal(teams.conversations[0].isStale, true);
    assert.equal(teams.counts.stale, 2);
});

test("an unregistered date cannot prove newer coverage when the effective capture date is unknown", async (t) => {
    const source = {
        id: "S900", path: "00_originals/alpha-transcript.md",
        date: new Date().toISOString().slice(0, 10), type: "transcript",
    };
    const { root, index } = await indexedConversations(t, { sources: [source] });
    await put(root, "02_inventory/chat-index.md", index.replace("2020-02-01", "2020-02-30"));
    const { teams } = await readRoom(root);
    const [c] = teams.conversations;
    assert.deepEqual(c.unregistered, [source]);
    assert.equal(c.lastCaptured, null);
    assert.equal(c.unknownCaptureDate, true);
    assert.equal(c.staleDateDisputed, false);
    assert.equal(c.needsReconciliation, true);
});

for (const { name, date, disputed } of [
    { name: "older", date: "2020-01-31", disputed: false },
    { name: "equal", date: "2020-02-01", disputed: false },
    { name: "undated", date: "", disputed: false },
    { name: "rollover", date: "2020-02-30", disputed: false },
    { name: "malformed", date: "not-a-date", disputed: false },
    { name: "future", date: "2099-01-01", disputed: false },
    { name: "valid newer", date: new Date().toISOString().slice(0, 10), disputed: true },
]) {
    test(`uniquely attributed ${name} inventory captures remain gaps with date-specific staleness evidence`, async (t) => {
        const source = { id: "MEMO-S900", path: "00_originals/alpha-transcript.md", date, type: "transcript" };
        const { root } = await indexedConversations(t, { sources: [source] });
        const { teams } = await readRoom(root);
        const [c] = teams.conversations;
        assert.deepEqual(c.unregistered, [source]);
        assert.equal(c.lastCaptured, "2020-02-01");
        assert.equal(c.staleDateDisputed, disputed);
        assert.equal(c.isStale, !disputed);
        assert.equal(c.needsReconciliation, true);
        assert.equal(c.hasProblem, true);
        assert.equal(teams.counts.unregistered, 1);
        assert.equal(teams.counts.stale, disputed ? 0 : 1);
        assert.equal(teams.counts.needsReconciliation, 1);
        assert.equal(sweepPlan(teams).targets.length, disputed ? 0 : 1);
    });
}

for (const { lifecycle, authority, disputed } of [
    { lifecycle: "Historical (abandoned approach)", authority: "supporting", disputed: false },
    { lifecycle: "likely superseded", authority: "authoritative", disputed: false },
    { lifecycle: "unknown", authority: "authoritative", disputed: false },
    { lifecycle: "Unavailable", authority: "authoritative", disputed: false },
    { lifecycle: "current", authority: "superseded", disputed: false },
    { lifecycle: "current", authority: "authoritative", disputed: true },
    { lifecycle: "current", authority: "unknown", disputed: true },
]) {
    test(`inventory recency evidence respects lifecycle ${lifecycle} and authority ${authority}`, async (t) => {
        const source = {
            id: "S900", path: "00_originals/alpha-transcript.md",
            date: new Date().toISOString().slice(0, 10), type: "transcript",
        };
        const { root } = await indexedConversations(t, { sources: [{ ...source, lifecycle, authority }] });
        const room = await readRoom(root);
        const [c] = room.teams.conversations;
        assert.deepEqual(c.unregistered, [source]);
        assert.equal(c.needsReconciliation, true);
        assert.equal(c.staleDateDisputed, disputed);
        assert.equal(c.isStale, !disputed);
        assert.equal(c.lastCaptured, "2020-02-01");
        assert.equal(room.teams.counts.unregistered, 1);
        assert.equal(room.teams.counts.stale, disputed ? 0 : 1);
        assert.equal(room.health.notCurrent.some((row) => row.id === "S900"), !disputed);
        assert.equal(sweepPlan(room.teams).targets.length, disputed ? 0 : 1);
    });
}

test("Unicode conversation tokens attribute only the exact distinctive inventory source", async (t) => {
    const source = {
        id: "S900", path: "00_originals/\u9879\u76ee\u51e4\u51f0-transcript.md",
        date: new Date().toISOString().slice(0, 10), type: "transcript",
    };
    const { root } = await indexedConversations(t, {
        names: ["\u9879\u76ee\u51e4\u51f0", "\u9879\u76ee\u767d\u9e6d"], sources: [source],
    });
    const { teams } = await readRoom(root);
    assert.deepEqual(teams.conversations[0].unregistered, [source]);
    assert.deepEqual(teams.conversations[1].unregistered, []);
    assert.equal(teams.conversations[0].staleDateDisputed, true);
    assert.equal(teams.conversations[1].isStale, true);
    assert.deepEqual(teams.attributionConflicts, []);
});

test("readRoom resolves tilde roots consistently with browseDir in an isolated home", async (t) => {
    const { base, root, outside } = await fixture(t);
    await put(base, "room.yaml", "project: Isolated home\n");
    const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", `
        import assert from "node:assert/strict";
        import { browseDir, readRoom } from ${JSON.stringify(moduleUrl)};
        for (const [input, expectedName] of [["~/room", "Fixture"], ["~", "Isolated home"]]) {
            const listing = await browseDir(input);
            let room;
            await assert.doesNotReject(async () => { room = await readRoom(input); });
            assert.equal(room.root, listing.path);
            assert.equal(room.name, expectedName);
        }
        assert.equal((await readRoom("~/room")).root, process.argv[1]);
        console.log("isolated tilde roots");
    `, root], { env: { ...process.env, HOME: base, USERPROFILE: base }, cwd: outside, timeout: 30000 });
    assert.equal(stdout.trim(), "isolated tilde roots");
});

for (const lifecycleColumn of ["Lifecycle", "Current or superseded"]) {
    test(`unknown ${lifecycleColumn} belongs in notCurrent independently of Authority`, async (t) => {
        const { root } = await fixture(t);
        for (const id of ["S001", "S002", "S003"]) await put(root, `00_originals/${id}.md`, "Fixture\n");
        await put(root, "02_inventory/source_inventory.csv",
            `Source ID,Path,Authority,${lifecycleColumn}\n`
            + "S001,00_originals/S001.md,authoritative,unknown\n"
            + "S002,00_originals/S002.md,unknown,current\n"
            + "S003,00_originals/S003.md,supporting,unknown (awaiting review)\n");
        const room = await readRoom(root);
        assert.deepEqual(room.health.notCurrent.map((source) => source.id), ["S001", "S003"]);
        assert.equal(room.sources[1].Authority, "unknown");
        assert.equal(room.sources[1].Lifecycle, "current");
    });
}

async function withNativeHomeFallback(t, assertions) {
    const { base, root, outside } = await fixture(t);
    await mkdir(path.join(outside, "Documents"));
    const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !["HOME", "USERPROFILE"].includes(key.toUpperCase())));
    env.USERPROFILE = base;
    const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", `
        import assert from "node:assert/strict";
        import path from "node:path";
        import os from "node:os";
        import fs from "node:fs/promises";
        import { syncBuiltinESMExports } from "node:module";
        const [base, root] = process.argv.slice(1);
        const home = os.homedir();
        assert.equal(process.env.HOME, undefined);
        if (process.platform === "win32") assert.equal(home, base);
        // Keep the native account lookup real without traversing real home contents.
        const realReaddir = fs.readdir;
        const realBase = await fs.realpath(base);
        fs.readdir = async (target, ...options) => {
            const absolute = path.resolve(target);
            if (![base, realBase].some((allowed) => absolute === allowed || absolute.startsWith(allowed + path.sep))) return [];
            return realReaddir(target, ...options);
        };
        syncBuiltinESMExports();
        assert.equal((await import("node:fs/promises")).readdir, fs.readdir);
        const api = await import(${JSON.stringify(moduleUrl)});
        const homeExists = await fs.stat(home).then((info) => info.isDirectory(), (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
        });
        ${assertions}
        console.log("native home fallback checked");
    `, base, root], { env, cwd: outside, timeout: 30000 });
    assert.equal(stdout.trim(), "native home fallback checked");
}

test("native home fallback resolves tilde paths with HOME missing", async (t) => {
    await withNativeHomeFallback(t, `
        const relative = path.relative(home, root).split(path.sep).join("/");
        const input = "~/" + relative;
        assert.notEqual(path.resolve(relative), root);
        let room;
        await assert.doesNotReject(async () => { room = await api.readRoom(input); });
        assert.equal(room.root, root);
        assert.equal(room.name, "Fixture");
        assert.equal((await api.browseDir(input)).path, root);
        if (homeExists) assert.equal((await api.browseDir("~")).path, path.resolve(home));
    `);
});

test("native home fallback supplies absolute starting points with HOME missing", async (t) => {
    await withNativeHomeFallback(t, `
        const result = await api.suggestStartingPoints();
        assert.equal(result.roots.some((entry) => entry.path === home), homeExists);
        assert.ok(result.roots.every((entry) => path.isAbsolute(entry.path)));
        if (homeExists) assert.equal(result.roots.find((entry) => entry.path === home).name, "~");
    `);
});

for (const second of ["1", "01"]) {
    test(`ordinal validation surfaces duplicate detail index ${second} as a room Teams error`, async (t) => {
        const { root } = await fixture(t);
        await put(root, "02_inventory/chat-index.md", "# Chat index\n\n"
            + "## 1. Alpha\n**chat_id:** `19:alpha`\n\n"
            + `## ${second}. Beta\n**chat_id:** \`19:beta\`\n`);
        const room = await readRoom(root);
        assert.equal(typeof room.teams.error, "string");
        assert.match(room.teams.error, /duplicate.*(?:index|ordinal)/i);
        assert.equal(room.teams.conversations, undefined);
        assert.equal(room.teams.counts, undefined);
    });
}

test("unattributed capture inventory rows remain separate from assigned sources and attribution conflicts", async (t) => {
    const today = new Date().toISOString().slice(0, 10);
    const sources = [
        { id: "S900", path: "00_originals/gamma-transcript.md", date: today, type: "transcript" },
        { id: "S901", path: "00_originals/alpha-beta-transcript.md", date: today, type: "transcript" },
        { id: "S902", path: "00_originals/alpha-transcript.md", date: "2020-01-01", type: "transcript" },
    ];
    const { root } = await indexedConversations(t, { names: ["Alpha chat", "Beta chat"], sources });
    const { teams } = await readRoom(root);
    assert.deepEqual(teams.unattributedCaptures, [sources[0]]);
    assert.equal(teams.counts.unattributedCaptures, 1);
    assert.equal(teams.counts.attributionConflicts, 1);
    assert.equal(teams.counts.unregistered, 1);
    assert.deepEqual(teams.conversations[0].unregistered, [sources[2]]);
    assert.deepEqual(teams.conversations[1].unregistered, []);
    assert.ok(teams.conversations.every((c) => c.isStale && !c.staleDateDisputed));
    const plan = sweepPlan(teams);
    assert.deepEqual(plan.targets.map((c) => c.index), [1, 2]);
    const data = JSON.parse(plan.text.match(/<untrusted_data>\n([\s\S]*?)\n<\/untrusted_data>/)[1]);
    assert.deepEqual(data.unattributedCaptures.items, [sources[0]]);
    assert.equal(data.unattributedCaptures.total, 1);
});

test("unattributed capture reconciliation survives a no-target sweep without changing conversation health", async (t) => {
    const today = new Date().toISOString().slice(0, 10);
    const source = { id: "S900", path: "00_originals/gamma-transcript.md", date: today, type: "transcript" };
    const { root, index } = await indexedConversations(t, { sources: [source] });
    await put(root, "02_inventory/chat-index.md", index.replaceAll("2020-02-01", today));
    const { teams } = await readRoom(root);
    assert.deepEqual(teams.unattributedCaptures, [source]);
    assert.equal(teams.counts.unattributedCaptures, 1);
    assert.equal(teams.counts.attributionConflicts, 0);
    assert.deepEqual(teams.conversations[0].unregistered, []);
    assert.equal(teams.conversations[0].hasProblem, false);
    assert.equal(teams.conversations[0].staleDateDisputed, false);
    const plan = sweepPlan(teams);
    assert.deepEqual(plan.targets, []);
    const data = JSON.parse(plan.text.match(/<untrusted_data>\n([\s\S]*?)\n<\/untrusted_data>/)[1]);
    assert.deepEqual(data.unattributedCaptures.items, [source]);
});

for (const ext of [".txt", ".md", ".csv"]) {
    test(`binary text extension ${ext} cannot bypass byte classification or break UTF-16 text`, async (t) => {
        const { root } = await fixture(t);
        const bytes = Buffer.from([0x41, 0, 0xff, 0x42]);
        await put(root, "binary" + ext, bytes);
        const result = await readRoomFile(root, "binary" + ext);
        assert.equal(result.kind, "binary");
        assert.equal(result.text, undefined);
        assert.equal(result.truncated, false);
        assert.equal(result.size, bytes.length);
        await put(root, "plain" + ext, "Plain caf\u00e9\n");
        assert.equal((await readRoomFile(root, "plain" + ext)).text, "Plain caf\u00e9\n");
        for (const encoding of ["utf16le", "utf16be"]) {
            let text = Buffer.from("\uFEFFValid \u{1f642}", "utf16le");
            if (encoding === "utf16be") text = text.swap16();
            await put(root, encoding + ext, text);
            const decoded = await readRoomFile(root, encoding + ext);
            assert.equal(decoded.kind, "text");
            assert.equal(decoded.encoding, encoding);
            assert.equal(decoded.text, "Valid \u{1f642}");
        }
    });
}

for (const [rel, size, kind, mime] of [
    ["small.png", 6, "image", "image/png"],
    ["boundary.png", RAW_LIMIT, "image", "image/png"],
    ["oversized.png", RAW_LIMIT + 1, "binary", null],
    ["oversized.JPG", RAW_LIMIT + 1, "binary", null],
    ["oversized.svg", RAW_LIMIT + 1, "binary", null],
]) {
    test(`image preview size limit classifies ${rel} at ${size} bytes`, async (t) => {
        const { root } = await fixture(t);
        const handle = await open(path.join(root, rel), "w");
        try {
            await handle.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]));
            await handle.truncate(size);
        } finally {
            await handle.close();
        }
        const preview = await readRoomFile(root, rel);
        assert.equal(preview.kind, kind);
        assert.equal(preview.size, size);
        assert.equal(preview.truncated, false);
        assert.equal(preview.text, undefined);
        if (kind === "image") {
            const raw = await readRoomBytes(root, rel);
            assert.equal(raw.buf.length, size);
            assert.equal(raw.mime, mime);
            assert.deepEqual([...raw.buf.subarray(0, 6)], [0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
        } else {
            await assert.rejects(readRoomBytes(root, rel), /exceeds the preview limit/);
        }
    });
}

test("image preview size limit rejects oversized payloads without allocating their bytes", async (t) => {
    const { root } = await fixture(t);
    const handle = await open(path.join(root, "oversized.png"), "w");
    try {
        await handle.truncate(RAW_LIMIT + 1);
    } finally {
        await handle.close();
    }
    const { stdout } = await exec(process.execPath, [
        "--max-old-space-size=48", "--input-type=module", "-e", `
            import assert from "node:assert/strict";
            import { readRoomFile, readRoomBytes } from ${JSON.stringify(moduleUrl)};
            const before = process.memoryUsage().arrayBuffers;
            const preview = await readRoomFile(process.argv[1], "oversized.png");
            assert.equal(preview.kind, "binary");
            assert.equal(preview.size, ${RAW_LIMIT + 1});
            await assert.rejects(readRoomBytes(process.argv[1], "oversized.png"), /exceeds the preview limit/);
            const allocated = process.memoryUsage().arrayBuffers - before;
            assert.ok(allocated < 1024 * 1024, "Image metadata allocated " + allocated + " bytes");
            console.log("metadata-only image rejection");
        `, root,
    ], { timeout: 30000 });
    assert.equal(stdout.trim(), "metadata-only image rejection");
});

test("chat ID metadata conflicts surface as a room Teams error without exposing conversations", async (t) => {
    const { root } = await fixture(t);
    await put(root, "02_inventory/chat-index.md", "# Chat index\n\n## 1. Alpha\n"
        + "chat_id: `19:alpha`\n**chat_id:** `19:beta`\n");
    const room = await readRoom(root);
    assert.equal(typeof room.teams.error, "string");
    assert.match(room.teams.error, /conflicting.*chat_id/i);
    assert.equal(room.teams.conversations, undefined);
    assert.equal(room.teams.counts, undefined);
});
