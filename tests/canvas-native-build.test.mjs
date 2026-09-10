import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const build = fileURLToPath(new URL("../scripts/build-canvas-reader.mjs", import.meta.url));
const binary = path.join(repository, "extensions/project-room-browser/bin",
    process.platform === "win32" ? "room-reader.exe" : "room-reader");

test("native build produces a runnable host helper and preserves an unchanged executable", { timeout: 300000 }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "canvas-build-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const options = {
        cwd: repository, timeout: 240000,
        env: { ...process.env, CARGO_BUILD_TARGET: "not-a-real-target" },
    };
    await assert.doesNotReject(exec(process.execPath, [build], options));
    const before = await stat(binary);
    assert.equal(before.isFile(), true);
    const result = spawnSync(binary, [root], {
        input: '{"id":1,"op":"shutdown"}\n', encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(replies[0].protocol, 1);
    assert.equal(replies[0].ok, true);
    assert.equal(replies[1].id, 1);
    assert.equal(replies[1].ok, true);
    await exec(process.execPath, [build], options);
    assert.equal((await stat(binary)).mtimeMs, before.mtimeMs);
});
