// Standalone runner for the project-room canvas, for review and testing.
// Usage: node serve.mjs <port> [roomPath]      ("-" as roomPath boots with no room)
//
// Routes live in routes.mjs so this runner exercises EXACTLY the same handler
// as the real extension. Do not add routes here.

import { startRoomServer, closeRoomServer } from "./server.mjs";

const port = Number(process.argv[2] || 7900);
const roomArg = process.argv.length > 3 ? process.argv[3] : undefined;
// No machine-specific default: take the room from argv, else $PROJECT_ROOM,
// else boot with no room so the picker is exercised.
const roomPath = roomArg === "-" ? "" : roomArg || process.env.PROJECT_ROOM || "";

const entry = await startRoomServer(roomPath, port);
console.log("project-room canvas on " + entry.url);
const stop = () => {
    closeRoomServer(entry).catch((error) => {
        console.error("Canvas shutdown failed:", error);
        process.exitCode = 1;
    });
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
