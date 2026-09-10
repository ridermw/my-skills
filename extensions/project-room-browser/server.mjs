import { createServer } from "node:http";
import { handleRequest, disposeRoomState } from "./routes.mjs";
import { createRoomState, canvasUrl } from "./capability.mjs";

export async function startRoomServer(initialPath = "", port = 0) {
    const state = createRoomState(initialPath);
    const server = createServer((req, res) => handleRequest(state, req, res));
    const entry = { server, state, url: null, closing: null };
    try {
        await new Promise((resolve, reject) => {
            const failed = (error) => reject(error);
            server.once("error", failed);
            server.listen(port, "127.0.0.1", () => {
                server.removeListener("error", failed);
                resolve();
            });
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Canvas server has no TCP address");
        entry.url = canvasUrl(address.port, state);
        return entry;
    } catch (error) {
        try {
            await closeRoomServer(entry);
        } catch (cleanup) {
            throw new AggregateError([error, cleanup], "Canvas initialization and cleanup failed");
        }
        throw error;
    }
}

export function closeRoomServer(entry) {
    if (entry.closing) return entry.closing;
    const stopped = new Promise((resolve, reject) => {
        if (!entry.server.listening) return resolve();
        entry.server.close((error) => error ? reject(error) : resolve());
    });
    const disposed = disposeRoomState(entry.state).finally(() => entry.server.closeAllConnections());
    entry.closing = (async () => {
        const results = await Promise.allSettled([stopped, disposed]);
        const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, "Canvas server disposal failed");
    })();
    return entry.closing;
}
