import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRoomRoot, relativeRoomPath } from "./paths.mjs";

const OWNER = Symbol("native room reader");
const MAX_HEADER = 256 * 1024;
const MAX_PAYLOAD = 25 * 1024 * 1024 + 1;
const MAX_PENDING = 32;
const KINDS = new Set(["file", "directory", "symlink", "other"]);
const COMMON = ["id", "ok", "payloadLength"];
const FIELDS = {
    open_file: ["handle", "resolvedRel", "stat"],
    read_prefix: [],
    open_directory: ["handle"],
    read_directory: ["entries", "done"],
    close_handle: [],
};
const executable = fileURLToPath(new URL(
    process.platform === "win32" ? "./bin/room-reader.exe" : "./bin/room-reader", import.meta.url,
));

function failure(code, message, cause) {
    return Object.assign(new Error(`${code}: ${message}`, cause ? { cause } : undefined), { code });
}

function protocol(message, cause) {
    return failure("ROOM_READER_PROTOCOL", message, cause);
}

function record(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).every((key) => keys.includes(key));
}

const integer = (value, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(value) && value >= 0 && value <= max;

function validateStat(stat) {
    if (!record(stat, ["type", "size", "modifiedMs", "identity"]) ||
        !KINDS.has(stat.type) || !integer(stat.size) ||
        !Number.isSafeInteger(stat.modifiedMs) || Math.abs(stat.modifiedMs) > 8_640_000_000_000_000 ||
        typeof stat.identity !== "string" || stat.identity.length > 64 || !/^\d+:\d+$/.test(stat.identity)) {
        throw protocol("Invalid opened-file metadata");
    }
}

export class RoomReader {
    #child;
    #ready = Promise.withResolvers();
    #exited = Promise.withResolvers();
    #status = "starting";
    #failure;
    #closePromise;
    #pending = new Map();
    #handles = new Set();
    #capacity = new Set();
    #nextId = 1;
    #header = [];
    #headerLength = 0;
    #bodyHeader;
    #body = [];
    #bodyLength = 0;
    #stderr = Buffer.alloc(0);
    #removeAbort = () => {};

    static async open(root, options = {}) {
        if (!record(options, ["signal"]) ||
            (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
            throw new TypeError("Room reader options must contain only an AbortSignal");
        }
        if (!["darwin", "linux", "win32"].includes(process.platform)) {
            throw failure("ROOM_READER_UNAVAILABLE", "No supported native reader for this platform");
        }
        if (options.signal?.aborted) throw failure("ROOM_READER_ABORTED", "Room access was cancelled");
        const reader = new RoomReader(OWNER, normalizeRoomRoot(root), options);
        try {
            await reader.#ready.promise;
            return reader;
        } catch (error) {
            try {
                await reader.close();
            } catch (cleanup) {
                throw new AggregateError([error, cleanup], "Native reader startup and cleanup failed");
            }
            throw error;
        }
    }

    constructor(owner, root, { signal }) {
        if (owner !== OWNER) throw new TypeError("Use RoomReader.open()");
        Object.defineProperty(this, "root", { value: root, enumerable: true });
        if (signal) {
            const abort = () => this.#fail(failure("ROOM_READER_ABORTED", "Room access was cancelled"));
            signal.addEventListener("abort", abort, { once: true });
            this.#removeAbort = () => signal.removeEventListener("abort", abort);
            if (signal.aborted) {
                abort();
                this.#exited.resolve();
                return;
            }
        }
        try {
            this.#child = spawn(executable, [root], {
                stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true,
            });
        } catch (error) {
            this.#fail(failure("ROOM_READER_UNAVAILABLE", "Build the native room reader before opening a room", error));
            this.#exited.resolve();
            return;
        }
        this.#child.once("error", (error) => this.#fail(failure(
            "ROOM_READER_UNAVAILABLE", "Cannot start the native room reader; run npm run build:canvas-reader", error,
        )));
        for (const name of ["stdin", "stdout", "stderr"]) {
            this.#child[name].on("error", (error) => {
                if (!this.disposed) this.#fail(failure("ROOM_READER_EXIT", `Native ${name} stream failed`, error));
            });
        }
        this.#child.stdout.on("data", (chunk) => this.#consume(chunk));
        this.#child.stderr.on("data", (chunk) => {
            this.#stderr = Buffer.from(Buffer.concat([this.#stderr, chunk.subarray(-8192)]).subarray(-8192));
        });
        this.#child.once("close", (code, exitSignal) => {
            if (!this.disposed) {
                this.#fail(this.#bodyHeader || this.#headerLength
                    ? protocol("Native reader exited with an incomplete response")
                    : failure("ROOM_READER_EXIT",
                        `Native reader exited (${exitSignal || code}): ${this.#stderr.toString("utf8")}`));
            }
            this.#removeAbort();
            this.#handles.clear();
            this.#exited.resolve();
        });
        if (this.disposed) this.#child.kill();
    }

    get disposed() {
        return this.#status === "closing" || this.#status === "closed" || this.#status === "failed";
    }

    #wakeCapacity() {
        for (const wake of this.#capacity) wake();
        this.#capacity.clear();
    }

    #rejectPending(error) {
        this.#ready.reject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        this.#wakeCapacity();
    }

    #fail(error) {
        if (this.disposed) return;
        this.#failure = error;
        this.#status = "failed";
        this.#rejectPending(error);
        this.#header = [];
        this.#body = [];
        this.#bodyHeader = undefined;
        this.#child?.kill();
    }

    #validate(header) {
        if (!record(header, [...COMMON, "protocol", "error", ...Object.values(FIELDS).flat()]) ||
            !integer(header.id) || typeof header.ok !== "boolean" ||
            !integer(header.payloadLength, MAX_PAYLOAD)) {
            throw protocol("Invalid response envelope");
        }
        const starting = this.#status === "starting";
        const pending = starting ? null : this.#pending.get(header.id);
        if ((starting && (header.id !== 0 || header.protocol !== 1)) || (!starting && !pending)) {
            throw protocol("Unexpected response ID or native protocol version");
        }
        const allowed = starting ? [...COMMON, "protocol"] : [...COMMON, ...FIELDS[pending.op]];
        if (!header.ok) {
            if (!record(header, [...COMMON, ...(starting ? ["protocol"] : []), "error"]) ||
                header.payloadLength !== 0 || !record(header.error, ["code", "message"]) ||
                typeof header.error.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(header.error.code) ||
                typeof header.error.message !== "string" || Buffer.byteLength(header.error.message) > 8192) {
                throw protocol("Invalid native error response");
            }
            return;
        }
        if (!record(header, allowed)) throw protocol("Unexpected response fields");
        if (starting) {
            if (header.payloadLength !== 0) throw protocol("Startup response must not carry file bytes");
            return;
        }
        if (pending.op !== "read_prefix" && header.payloadLength !== 0) {
            throw protocol("Unexpected binary payload");
        }
        if (pending.op === "read_prefix" && header.payloadLength > pending.limit) {
            throw protocol("Prefix response exceeds the requested limit");
        }
        if (pending.op === "open_file" || pending.op === "open_directory") {
            if (!integer(header.handle, 0xffff_ffff) || !header.handle ||
                this.#handles.has(header.handle) || this.#handles.size >= 32) {
                throw protocol("Invalid or duplicate native handle");
            }
        }
        if (pending.op === "open_file") {
            validateStat(header.stat);
            if (typeof header.resolvedRel !== "string" || !header.resolvedRel ||
                path.isAbsolute(header.resolvedRel) ||
                relativeRoomPath(this.root, header.resolvedRel) !== header.resolvedRel) {
                throw protocol("Invalid resolved room-relative path");
            }
        }
        if (pending.op === "read_directory") {
            if (!Array.isArray(header.entries) || header.entries.length > 32 || typeof header.done !== "boolean" ||
                (!header.entries.length && !header.done)) throw protocol("Invalid directory batch");
            for (const entry of header.entries) {
                if (!record(entry, ["name", "type"]) || typeof entry.name !== "string" ||
                    !entry.name || !entry.name.isWellFormed() || entry.name === "." || entry.name === ".." || entry.name.includes("\0") ||
                    entry.name.includes("/") || (process.platform === "win32" && entry.name.includes("\\")) ||
                    !KINDS.has(entry.type)) throw protocol("Invalid directory entry");
            }
        }
    }

    #deliver(header, bytes) {
        if (this.#status === "starting") {
            if (header.ok) {
                this.#status = "ready";
                this.#ready.resolve();
            } else {
                this.#fail(failure(header.error.code, header.error.message));
            }
            return;
        }
        const pending = this.#pending.get(header.id);
        this.#pending.delete(header.id);
        this.#wakeCapacity();
        if (!header.ok) {
            pending.reject(failure(header.error.code, header.error.message));
            return;
        }
        if (pending.op === "open_file" || pending.op === "open_directory") this.#handles.add(header.handle);
        if (pending.op === "close_handle") this.#handles.delete(pending.handle);
        pending.resolve({ ...header, bytes });
    }

    #consume(chunk) {
        if (this.disposed) return;
        try {
            let offset = 0;
            while (offset < chunk.length && !this.disposed) {
                if (this.#bodyHeader) {
                    const remaining = this.#bodyHeader.payloadLength - this.#bodyLength;
                    const length = Math.min(remaining, chunk.length - offset);
                    this.#body.push(chunk.subarray(offset, offset + length));
                    this.#bodyLength += length;
                    offset += length;
                    if (this.#bodyLength === this.#bodyHeader.payloadLength) {
                        const header = this.#bodyHeader;
                        const bytes = Buffer.concat(this.#body, this.#bodyLength);
                        this.#bodyHeader = undefined;
                        this.#body = [];
                        this.#bodyLength = 0;
                        this.#deliver(header, bytes);
                    }
                    continue;
                }
                const newline = chunk.indexOf(10, offset);
                const end = newline === -1 ? chunk.length : newline;
                this.#headerLength += end - offset;
                if (this.#headerLength + 1 > MAX_HEADER) throw protocol("Native response header exceeds 256 KiB");
                this.#header.push(chunk.subarray(offset, end));
                offset = end + (newline === -1 ? 0 : 1);
                if (newline === -1) break;
                const raw = Buffer.concat(this.#header, this.#headerLength);
                this.#header = [];
                this.#headerLength = 0;
                let header;
                try {
                    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
                } catch (error) {
                    throw protocol("Invalid native response JSON", error);
                }
                this.#validate(header);
                if (header.payloadLength) this.#bodyHeader = header;
                else this.#deliver(header, Buffer.alloc(0));
            }
        } catch (error) {
            this.#fail(error.code === "ROOM_READER_PROTOCOL" ? error : protocol("Invalid native response", error));
        }
    }

    async #request(op, input) {
        if (this.disposed) throw this.#failure || failure("ROOM_READER_CLOSED", "Room reader is closed");
        if (this.#pending.size >= MAX_PENDING) throw failure("ROOM_READER_LIMIT", "Too many pending native requests");
        if (!Number.isSafeInteger(this.#nextId)) throw failure("ROOM_READER_LIMIT", "Native request IDs are exhausted");
        const id = this.#nextId++;
        const frame = Buffer.from(JSON.stringify({ id, op, ...input }) + "\n");
        if (frame.length > MAX_HEADER) throw failure("ROOM_READER_LIMIT", "Native request exceeds 256 KiB");
        const pending = { ...Promise.withResolvers(), op, ...input };
        this.#pending.set(id, pending);
        try {
            this.#child.stdin.write(frame, (error) => {
                if (error && !this.disposed) this.#fail(failure("ROOM_READER_EXIT", "Native request write failed", error));
            });
        } catch (error) {
            this.#fail(failure("ROOM_READER_EXIT", "Native request write failed", error));
        }
        return pending.promise;
    }

    async #release(handle) {
        // Disposal must not leak a handle just because ordinary requests fill the wire budget.
        while (!this.disposed && this.#pending.size >= MAX_PENDING) {
            await new Promise((resolve) => this.#capacity.add(resolve));
        }
        if (!this.disposed) await this.#request("close_handle", { handle });
    }

    async openFile(rel) {
        const opened = await this.#request("open_file", { rel: relativeRoomPath(this.root, rel) });
        return new RoomFile(OWNER, {
            stat: opened.stat, resolvedRel: opened.resolvedRel,
            read: async (limit) => (await this.#request("read_prefix", { handle: opened.handle, limit })).bytes,
            close: () => this.#release(opened.handle),
        });
    }

    async openDirectory(rel) {
        const opened = await this.#request("open_directory", { rel: relativeRoomPath(this.root, rel) });
        return new RoomDirectory(OWNER, {
            read: () => this.#request("read_directory", { handle: opened.handle }),
            close: () => this.#release(opened.handle),
        });
    }

    close() {
        if (this.#closePromise) return this.#closePromise;
        this.#closePromise = this.#close();
        return this.#closePromise;
    }

    async #close() {
        this.#status = "closing";
        this.#rejectPending(this.#failure || failure("ROOM_READER_CLOSED", "Room reader is closed"));
        this.#header = [];
        this.#body = [];
        this.#bodyHeader = undefined;
        this.#removeAbort();
        this.#child?.stdin.end();
        const terminate = setTimeout(() => this.#child?.kill(), 2000);
        const force = setTimeout(() => this.#child?.kill("SIGKILL"), 4000);
        terminate.unref();
        force.unref();
        try {
            await this.#exited.promise;
        } finally {
            clearTimeout(terminate);
            clearTimeout(force);
            this.#status = "closed";
        }
    }
}

export class RoomFile {
    #read;
    #close;
    #closing;

    constructor(owner, { stat, resolvedRel, read, close }) {
        if (owner !== OWNER) throw new TypeError("Use RoomReader.openFile()");
        Object.defineProperties(this, {
            stat: { value: Object.freeze(stat), enumerable: true },
            resolvedRel: { value: resolvedRel, enumerable: true },
        });
        this.#read = read;
        this.#close = close;
    }

    async readPrefix(limit) {
        if (this.#closing) throw failure("ROOM_READER_CLOSED", "File handle is closed");
        if (!integer(limit, MAX_PAYLOAD)) throw failure("ROOM_READER_LIMIT", "Invalid prefix byte limit");
        return this.#read(limit);
    }

    close() {
        return this.#closing ??= this.#close();
    }
}

export class RoomDirectory {
    #read;
    #close;
    #closing;
    #reading = false;
    #failure;
    #entries = [];
    #index = 0;
    #done = false;

    constructor(owner, { read, close }) {
        if (owner !== OWNER) throw new TypeError("Use RoomReader.openDirectory()");
        this.#read = read;
        this.#close = close;
    }

    async read() {
        if (this.#closing) throw failure("ROOM_READER_CLOSED", "Directory handle is closed");
        if (this.#failure) throw this.#failure;
        if (this.#reading) throw failure("ROOM_READER_LIMIT", "Concurrent reads on one directory cursor are not supported");
        this.#reading = true;
        try {
            if (this.#index === this.#entries.length) {
                if (this.#done) return null;
                const batch = await this.#read();
                this.#entries = batch.entries;
                this.#index = 0;
                this.#done = batch.done;
            }
            return this.#entries[this.#index++] || null;
        } catch (error) {
            this.#failure = error;
            throw error;
        } finally {
            this.#reading = false;
        }
    }

    close() {
        return this.#closing ??= this.#close();
    }
}
