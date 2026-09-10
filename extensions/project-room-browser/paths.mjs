import path from "node:path";
import { homedir } from "node:os";

export function untilde(value) {
    if (!value) return value;
    if (value === "~") return homedir();
    if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
    return value;
}

export function normalizeRoomRoot(value) {
    if (typeof value !== "string" || !value || value.includes("\0") || !value.isWellFormed()) {
        throw new Error("Invalid room root: expected a nonempty Unicode path without NUL bytes");
    }
    return path.resolve(untilde(value));
}

export function relativeRoomPath(root, rel, pathImpl = path) {
    if (typeof rel !== "string" || rel.includes("\0") || !rel.isWellFormed() || rel.length > 32768) {
        throw new Error("Refused: room path is invalid or exceeds 32,768 characters");
    }
    const target = pathImpl.resolve(root, rel);
    const relative = pathImpl.relative(pathImpl.resolve(root), target);
    if (pathImpl.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + pathImpl.sep)) {
        throw new Error("Refused: path escapes the room");
    }
    return relative || ".";
}
