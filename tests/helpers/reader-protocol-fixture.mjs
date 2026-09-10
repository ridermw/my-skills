import { createInterface } from "node:readline";

const scenario = process.argv[2];
const header = (value) => process.stdout.write(JSON.stringify({ payloadLength: 0, ...value }) + "\n");
const hello = { id: 0, ok: true, protocol: 1 };
if (scenario === "bad-json") {
    process.stdout.write("not-json\n");
} else if (scenario === "oversized-header") {
    process.stdout.write(" ".repeat(256 * 1024 + 1));
} else {
    header({ ...hello, protocol: scenario === "wrong-version" ? 2 : 1 });
}
if (scenario === "hang") setInterval(() => {}, 1000);
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
    const request = JSON.parse(line);
    if (scenario === "queue" || scenario === "hang") return;
    if (scenario === "crash") process.exit(7);
    if (scenario === "unexpected-id") {
        header({ id: request.id + 100, ok: true });
        return;
    }
    if (request.op === "open_file") {
        header({
            id: request.id, ok: true, handle: 1, resolvedRel: "file.txt",
            stat: { type: "file", size: scenario === "bad-stat" ? -1 : 16, modifiedMs: 0, identity: "1:2" },
        });
    } else if (request.op === "read_prefix") {
        if (scenario === "oversized-payload") {
            header({ id: request.id, ok: true, payloadLength: 25 * 1024 * 1024 + 2 });
        } else {
            header({ id: request.id, ok: true, payloadLength: 10 });
            process.stdout.write("ab");
            process.exit(0);
        }
    } else {
        header({ id: request.id, ok: true });
    }
});
