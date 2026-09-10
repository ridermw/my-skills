import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const native = fileURLToPath(new URL("../extensions/project-room-browser/native/", import.meta.url));
const bin = fileURLToPath(new URL("../extensions/project-room-browser/bin/", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--test")) {
    throw new Error("Usage: node scripts/build-canvas-reader.mjs [--test]");
}
const mode = args[0] === "--test" ? "test" : "build";
const { stdout } = await exec("rustc", ["--version", "--verbose"]);
const host = stdout.match(/^host: ([a-zA-Z0-9_-]+)$/m)?.[1];
const platform = { darwin: "apple-darwin", linux: "linux", win32: "windows" }[process.platform];
if (!host || !platform || !host.includes(platform)) {
    throw new Error("Rust must provide a native macOS, Linux, or Windows host toolchain");
}
const target = path.join(native, "target");
const cargoArgs = [
    mode, "--locked", "--manifest-path", path.join(native, "Cargo.toml"),
    "--target", host, "--target-dir", target,
    ...(mode === "build" ? ["--release"] : []),
];
await new Promise((resolve, reject) => {
    const child = spawn("cargo", cargoArgs, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Native reader ${mode} failed (${signal || code})`));
    });
});

async function digest(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

if (mode === "build") {
    const executable = process.platform === "win32" ? "room-reader.exe" : "room-reader";
    const source = path.join(target, host, "release", executable);
    const destination = path.join(bin, executable);
    const expected = await digest(source);
    let current;
    try {
        current = await digest(destination);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    // An unchanged executable may be in use by another canvas, notably on Windows.
    if (current !== expected) {
        await mkdir(bin, { recursive: true });
        const staging = await mkdtemp(path.join(bin, ".build-"));
        try {
            const staged = path.join(staging, executable);
            await copyFile(source, staged);
            if (process.platform !== "win32") await chmod(staged, 0o755);
            await rename(staged, destination);
        } finally {
            await rm(staging, { recursive: true, force: true });
        }
    }
    console.log(`Native room reader ready: ${destination}`);
}
