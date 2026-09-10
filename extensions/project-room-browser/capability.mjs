import { randomBytes } from "node:crypto";

export function createRoomState(roomPath = "") {
    return {
        roomPath,
        token: randomBytes(24).toString("hex"),
        previewToken: randomBytes(24).toString("hex"),
    };
}

export function canvasUrl(port, state) {
    const fragment = new URLSearchParams({ token: state.token, preview: state.previewToken });
    return `http://127.0.0.1:${port}/#${fragment}`;
}
