import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { handleRequest } from "../../extensions/project-room-browser/routes.mjs";

export async function makeRoom(t, count = 1) {
    const root = await mkdtemp(path.join(tmpdir(), "canvas-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "00_originals"));
    await mkdir(path.join(root, "02_inventory"));
    await writeFile(path.join(root, "room.yaml"), "project: Canvas fixture\nreview_status: needs_review\n");
    const rows = ["Source ID,Path,Authority,Current or superseded,Key claims or content"];
    for (let i = 1; i <= count; i++) {
        const name = `source-${i}.txt`;
        await writeFile(path.join(root, "00_originals", name), `Source ${i} contents\n`);
        rows.push(`S${String(i).padStart(3, "0")},00_originals/${name},Primary,current,Fixture claim ${i}`);
    }
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), rows.join("\n") + "\n");
    return root;
}

export async function serveRoom(t, root) {
    const state = { roomPath: root, token: "fixture-api-token", previewToken: "fixture-preview-token" };
    const server = createServer((req, res) => handleRequest(state, req, res));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { state, origin, url: `${origin}/#token=${state.token}&preview=${state.previewToken}` };
}
