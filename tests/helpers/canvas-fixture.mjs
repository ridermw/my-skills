import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startRoomServer, closeRoomServer } from "../../extensions/project-room-browser/server.mjs";

const scopes = new WeakMap();

function scopeFor(t) {
    let scope = scopes.get(t);
    if (!scope) {
        scope = { resources: [], roots: [] };
        scopes.set(t, scope);
        t.after(async () => {
            const errors = [];
            for (const close of scope.resources.reverse()) {
                try { await close(); } catch (error) { errors.push(error); }
            }
            for (const root of scope.roots.reverse()) {
                try { await rm(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(errors, "Canvas fixture cleanup failed");
        });
    }
    return scope;
}

export function afterRoomResources(t, close) {
    scopeFor(t).resources.push(close);
}

export async function makeRoom(t, count = 1) {
    const root = await mkdtemp(path.join(tmpdir(), "canvas-contract-"));
    scopeFor(t).roots.push(root);
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
    const entry = await startRoomServer(root);
    afterRoomResources(t, () => closeRoomServer(entry));
    return { state: entry.state, origin: new URL(entry.url).origin, url: entry.url };
}
