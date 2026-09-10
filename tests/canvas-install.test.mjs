import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { makeRoom } from "./helpers/canvas-fixture.mjs";

const exec = promisify(execFile);
const installer = fileURLToPath(new URL("../scripts/install-canvas.mjs", import.meta.url));

test("installation copies a runnable native canvas without build output or removing user files", { timeout: 120000 }, async (t) => {
    const root = await makeRoom(t);
    const base = await mkdtemp(path.join(tmpdir(), "canvas-install-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const destination = path.join(base, "project-room-browser");
    await assert.doesNotReject(exec(process.execPath, [installer, "--destination", destination]));
    assert.equal((await readdir(destination)).includes("native"), false);
    assert.equal((await readdir(destination)).includes("node_modules"), false);
    await writeFile(path.join(destination, "user-note.txt"), "Keep this\n");
    await exec(process.execPath, [installer, "--destination", destination]);
    assert.equal(await readFile(path.join(destination, "user-note.txt"), "utf8"), "Keep this\n");
    const child = spawn(process.execPath, [path.join(destination, "serve.mjs"), "0", root], { stdio: ["ignore", "pipe", "pipe"] });
    const exited = once(child, "exit");
    const lines = createInterface({ input: child.stdout });
    try {
        const [line] = await once(lines, "line");
        const url = new URL(line.replace("project-room canvas on ", ""));
        const token = new URLSearchParams(url.hash.slice(1)).get("token");
        const response = await fetch(url.origin + "/api/room", { headers: { "x-room-token": token } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).room.name, "Canvas fixture");
    } finally {
        lines.close();
        child.kill();
        await exited;
    }
});

test("installation refuses a broad destination before creating files", async () => {
    await assert.rejects(exec(process.execPath, [installer, "--destination", path.parse(installer).root]), /destination/i);
});
