import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--destination")) {
    throw new Error("Usage: node scripts/install-canvas.mjs [--destination /absolute/path/project-room-browser]");
}
const source = fileURLToPath(new URL("../extensions/project-room-browser/", import.meta.url));
const destination = args[1] || path.join(homedir(), ".copilot/extensions/project-room-browser");
if (!path.isAbsolute(destination) || path.basename(destination) !== "project-room-browser" ||
    path.resolve(destination) === path.resolve(source)) {
    throw new Error("Invalid installation destination: use a separate absolute project-room-browser directory");
}

async function directory(target) {
    try {
        const info = await lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Refused installation destination: " + target);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await mkdir(target);
    }
}

await mkdir(path.dirname(destination), { recursive: true });
await directory(destination);
if (await realpath(destination) === await realpath(source)) throw new Error("Installation destination is the source directory");
await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./build-canvas-reader.mjs", import.meta.url)),
], { maxBuffer: 4 * 1024 * 1024 });

const staging = await mkdtemp(path.join(destination, ".install-"));
try {
    const files = (await readdir(source, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && (/\.(?:mjs|js)$/.test(entry.name) || entry.name === "README.md"))
        .map((entry) => entry.name);
    async function collect(relative) {
        for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
            const name = path.join(relative, entry.name);
            if (entry.isDirectory()) await collect(name);
            else if (entry.isFile()) files.push(name);
            else throw new Error("Refused non-regular runtime asset: " + name);
        }
    }
    await collect("assets");
    files.push(path.join("bin", process.platform === "win32" ? "room-reader.exe" : "room-reader"));
    for (const relative of files) {
        const parents = path.dirname(relative).split(path.sep).filter((part) => part !== ".");
        let target = destination;
        for (const parent of parents) {
            target = path.join(target, parent);
            await directory(target);
        }
        const temporary = path.join(staging, path.basename(relative));
        await copyFile(path.join(source, relative), temporary);
        await rename(temporary, path.join(destination, relative));
    }
} finally {
    await rm(staging, { recursive: true, force: true });
}
console.log("Installed native project-room canvas: " + destination);
