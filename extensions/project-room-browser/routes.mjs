// Single source of truth for the canvas HTTP API.
//
// extension.mjs (production) and serve.mjs (test runner) BOTH use this handler.
// They previously hand-maintained two copies of the route table, which meant the
// test server could answer differently from the real one -- a route added to
// production 404'd in tests, so tests were verifying a different program.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readRoom, readRoomFile, readRoomBytes, listSiblingRooms, browseDir, suggestStartingPoints } from "./room.mjs";
import { sweepPlan } from "./teams.mjs";
import { renderShell } from "./ui.mjs";

export function json(res, code, body) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

/**
 * Handle one request against a room `state` ({ roomPath }).
 * `state` is mutated when a room is opened, so the root is server-owned.
 */
export async function handleRequest(state, req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
        /* Capability check.
           /api/room accepts a caller-supplied `path` and makes it the server-owned
           root -- that is deliberate, because the picker has to open whatever folder
           the user chooses. Without a secret, though, any local process or any web
           page in the browser could POST /api/room?path=/etc and then read files
           through /api/file. The token is minted per server instance and handed only
           to the document this server itself serves, so an attacker who cannot read
           that document cannot drive the API.
           /api/raw is also reached from <img src>, which cannot set a header, so the
           token is accepted as a query parameter there too. */
        if (url.pathname.startsWith("/api/")) {
            const supplied = req.headers["x-room-token"] || url.searchParams.get("t") || "";
            if (!state.token || supplied !== state.token) {
                return json(res, 403, { ok: false, error: "Refused: missing or invalid canvas token." });
            }
            // A cross-site caller should never reach this API even with a token.
            const site = req.headers["sec-fetch-site"];
            if (site && site !== "same-origin" && site !== "none") {
                return json(res, 403, { ok: false, error: "Refused: cross-site request." });
            }
        }
        if (url.pathname === "/api/teams/sweep") {
            if (!state.roomPath) return json(res, 409, { ok: false, error: "No room is open." });
            const room = await readRoom(state.roomPath);
            if (!room.teams) return json(res, 200, { ok: false, error: "This room has no chat index to sweep." });
            if (room.teams.error) return json(res, 200, { ok: false, error: room.teams.error });
            const plan = sweepPlan(room.teams, { roomName: room.name });
            return json(res, 200, { ok: true, targets: plan.targets.length, text: plan.text });
        }

        if (url.pathname === "/api/room") {
            const p = url.searchParams.get("path") || state.roomPath;
            if (!p) return json(res, 400, { ok: false, error: "No room path supplied" });
            const room = await readRoom(p);
            state.roomPath = room.root;
            return json(res, 200, { ok: true, room });
        }

        if (url.pathname === "/api/file") {
            // The room root comes from server state, never the query string.
            // Accepting a caller-supplied root made every user-readable file
            // reachable via ?path=/etc&rel=passwd.
            const p = state.roomPath;
            const rel = url.searchParams.get("rel") || "";
            if (!p) return json(res, 409, { ok: false, error: "No room is open" });
            if (!rel) return json(res, 400, { ok: false, error: "rel is required" });
            return json(res, 200, { ok: true, file: await readRoomFile(p, rel) });
        }

        if (url.pathname === "/api/raw") {
            const p = state.roomPath;
            const rel = url.searchParams.get("rel") || "";
            if (!p) return json(res, 409, { ok: false, error: "No room is open" });
            if (!rel) return json(res, 400, { ok: false, error: "rel is required" });
            const { buf, mime } = await readRoomBytes(p, rel);
            // SVG can carry script and this origin also serves /api/file, so
            // sandbox the response and forbid MIME sniffing.
            res.writeHead(200, {
                "Content-Type": mime,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                "Content-Disposition": "inline",
            });
            return res.end(buf);
        }

        if (url.pathname === "/api/browse") {
            const dir = url.searchParams.get("dir") || "";
            if (!dir) return json(res, 200, { ok: true, ...(await suggestStartingPoints()), browse: null });
            return json(res, 200, { ok: true, browse: await browseDir(dir) });
        }

        if (url.pathname === "/api/rooms") {
            // Offer sibling rooms when opened without an explicit path.
            const base = state.roomPath ? path.dirname(state.roomPath) : "";
            const rooms = base ? await listSiblingRooms(base) : [];
            return json(res, 200, { ok: true, rooms });
        }

        if (url.pathname === "/client.js") {
            const js = await readFile(new URL("./client.js", import.meta.url), "utf8");
            res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(js);
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
            renderShell({
                token: state.token,
                roomPath: state.roomPath,
                roomName: path.basename(state.roomPath || ""),
            })
        );
    } catch (err) {
        json(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
    }
}
