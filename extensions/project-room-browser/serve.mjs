// Standalone runner for the project-room canvas, for review and testing.
// Usage: node serve.mjs <port> [roomPath]      ("-" as roomPath boots with no room)
//
// Routes live in routes.mjs so this runner exercises EXACTLY the same handler
// as the real extension. Do not add routes here.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { handleRequest } from "./routes.mjs";

const port = Number(process.argv[2] || 7900);
const roomArg = process.argv.length > 3 ? process.argv[3] : undefined;
// No machine-specific default: take the room from argv, else $PROJECT_ROOM,
// else boot with no room so the picker is exercised.
const roomPath = roomArg === "-" ? "" : roomArg || process.env.PROJECT_ROOM || "";

const state = { roomPath, token: randomBytes(24).toString("hex") };

createServer((req, res) => handleRequest(state, req, res)).listen(port, "127.0.0.1", () =>
    console.log("project-room canvas on http://127.0.0.1:" + port + "/")
);
