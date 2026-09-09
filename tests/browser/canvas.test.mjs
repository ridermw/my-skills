import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { makeRoom, serveRoom } from "../helpers/canvas-fixture.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function openPage(t, root, width = 1100, beforeLoad) {
    const server = await serveRoom(t, root);
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (beforeLoad) await beforeLoad(page);
    await page.goto(server.url);
    await page.locator(".rail").waitFor();
    return { ...server, page, errors };
}

test("Windows relative paths retain folder groups and binary basenames", async (t) => {
    const root = await makeRoom(t);
    await writeFile(path.join(root, "00_originals/opaque.bin"), Buffer.from([0, 1, 2]));
    const { page } = await openPage(t, root, 1100, async (page) => {
        await page.route("**/api/room", async (route) => {
            const response = await route.fetch();
            const data = await response.json();
            data.room.files = data.room.files.map((file) => ({ ...file, rel: file.rel.replaceAll("/", "\\") }));
            await route.fulfill({ json: data });
        });
        await page.route("**/api/file?rel=*", async (route) => {
            // Translate the simulated Windows request to this test host's fixture.
            const url = new URL(route.request().url());
            url.searchParams.set("rel", url.searchParams.get("rel").replaceAll("\\", "/"));
            await route.fulfill({ response: await route.fetch({ url: url.href }) });
        });
    });
    await page.locator('[data-v="files"]').click();
    assert.ok((await page.locator(".tree .grp span:first-child").allTextContents()).includes("00_originals"));
    await page.getByRole("option", { name: /opaque\.bin/ }).click();
    await page.locator(".binmsg").waitFor();
    assert.equal(await page.locator(".binmsg strong").textContent(), "opaque.bin");
});

for (const breadcrumbs of [
    [
        { name: "C:\\", path: "C:\\" },
        { name: "Users", path: "C:\\Users" },
        { name: "example", path: "C:\\Users\\example" },
    ],
    [
        { name: "\\\\server\\share\\", path: "\\\\server\\share\\" },
        { name: "rooms", path: "\\\\server\\share\\rooms" },
        { name: "example", path: "\\\\server\\share\\rooms\\example" },
    ],
]) {
    test(`picker preserves native breadcrumb targets rooted at ${breadcrumbs[0].path}`, async (t) => {
        const root = await makeRoom(t);
        const { page } = await openPage(t, root);
        await page.route("**/api/browse*", (route) => route.fulfill({
            json: {
                ok: true,
                browse: { path: breadcrumbs.at(-1).path, parent: breadcrumbs.at(-2).path, isRoom: false, entries: [], breadcrumbs },
            },
        }));
        await page.locator(".switch").click();
        await page.locator(".crumbs").waitFor();
        assert.deepEqual(await page.locator(".crumbs button").evaluateAll((nodes) => nodes.map((node) => node.dataset.go)),
            breadcrumbs.map((entry) => entry.path));
        const request = page.waitForRequest((request) => new URL(request.url()).searchParams.has("dir"));
        await page.locator(".crumbs button").nth(1).click();
        assert.equal(new URL((await request).url()).searchParams.get("dir"), breadcrumbs[1].path);
    });
}

test("picker renders and follows breadcrumbs from the real HTTP browse handler", async (t) => {
    const root = await makeRoom(t);
    const { page, origin } = await openPage(t, root);
    await page.route("**/api/browse", async (route) => {
        await route.fulfill({
            response: await route.fetch({ url: `${origin}/api/browse?dir=${encodeURIComponent(root)}` }),
        });
    });
    await page.locator(".switch").click();
    await page.locator(".crumbs").waitFor();
    assert.equal(await page.locator(".crumbs button").last().getAttribute("data-go"), root);
    const request = page.waitForRequest((request) => new URL(request.url()).searchParams.has("dir"));
    await page.locator(".crumbs button").last().click();
    assert.equal(new URL((await request).url()).searchParams.get("dir"), root);
    await page.getByRole("button", { name: /Open this folder as a room/ }).waitFor();
});

test("authenticated canvas loads all five views without browser errors", async (t) => {
    const root = await makeRoom(t);
    const { page, errors } = await openPage(t, root);
    for (const view of ["overview", "inventory", "review", "teams", "files"]) {
        await page.locator(`[data-v="${view}"]`).click();
        await page.locator(`#p-${view}`).waitFor({ state: "visible" });
    }
    assert.deepEqual(errors, []);
});

test("a public origin is not a private canvas launch link", async (t) => {
    const root = await makeRoom(t);
    const { page, origin } = await openPage(t, root);
    const apiRequests = [];
    page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    await page.goto(origin);
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").textContent(), /private launch link/);
    assert.deepEqual(apiRequests, []);
    assert.equal(await page.locator(".rail").count(), 0);
    assert.equal((await page.content()).includes(root), false);
});

test("private picker bootstrap and room switching preserve authenticated file access", async (t) => {
    const first = await makeRoom(t);
    const second = await makeRoom(t);
    await writeFile(path.join(second, "00_originals/source-1.txt"), "Second room contents\n");
    const server = await serveRoom(t, "");
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    // Keep home-directory discovery out of synthetic-room browser tests.
    await page.route("**/api/browse", (route) => route.fulfill({
        json: { ok: true, roots: [], rooms: [], browse: null },
    }));
    await page.goto(server.url);
    await page.locator(".picker").waitFor();
    assert.equal(await page.locator(".pickerr").textContent(), "");
    for (const [root, contents] of [[first, "Source 1 contents"], [second, "Second room contents"]]) {
        await page.locator("#pathin").fill(root);
        await page.locator('#pasteform button[type="submit"]').click();
        await page.locator(".rail").waitFor();
        await page.locator('[data-v="files"]').click();
        await page.locator('[data-rel="00_originals/source-1.txt"]').click();
        await page.waitForFunction((text) => document.querySelector("#viewer")?.textContent.includes(text), contents);
        assert.match(await page.locator("#viewer").textContent(), new RegExp(contents));
        await page.locator(".switch").click();
        await page.locator(".picker").waitFor();
    }
});

test("browser image previews use only the separate image capability", async (t) => {
    const root = await makeRoom(t);
    await writeFile(path.join(root, "00_originals/image.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>');
    const { page, state } = await openPage(t, root);
    await page.locator('[data-v="files"]').click();
    await page.locator('[data-rel="00_originals/image.svg"]').click();
    const image = page.locator("#viewer img");
    await image.waitFor();
    await page.waitForFunction(() => {
        const image = document.querySelector("#viewer img");
        return image?.complete && image.naturalWidth > 0;
    });
    const source = new URL(await image.getAttribute("src"), page.url());
    assert.equal(source.searchParams.get("t"), state.previewToken);
    assert.equal(source.href.includes(state.token), false);
});

for (const lateError of [false, true]) {
    test(`later file selection survives an earlier ${lateError ? "error" : "success"} response`, async (t) => {
        const root = await makeRoom(t, 2);
        const { page } = await openPage(t, root);
        let release;
        let seen;
        const pending = new Promise((resolve) => { release = resolve; });
        const requested = new Promise((resolve) => { seen = resolve; });
        await page.route("**/api/file?rel=00_originals%2Fsource-1.txt", async (route) => {
            seen();
            await pending;
            await route.fulfill({
                json: lateError
                    ? { ok: false, error: "Earlier file failed" }
                    : { ok: true, file: { kind: "text", size: 6, text: "Earlier contents", truncated: false } },
            });
        });
        await page.locator('[data-v="files"]').click();
        await page.locator('[data-rel="00_originals/source-1.txt"]').click();
        await requested;
        await page.locator('[data-rel="00_originals/source-2.txt"]').click();
        await page.waitForFunction(() => document.querySelector("#viewer")?.textContent.includes("Source 2 contents"));
        const response = page.waitForResponse((r) => r.url().includes("source-1.txt"));
        release();
        await response;
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.match(await page.locator("#viewer").textContent(), /Source 2 contents/);
        assert.equal(await page.locator("#viewer .vhead .p").textContent(), "00_originals/source-2.txt");
        assert.equal(await page.locator('.tree [aria-current="true"]').getAttribute("data-rel"), "00_originals/source-2.txt");
    });
}

test("reselecting the same file rejects a response from its earlier generation", async (t) => {
    const root = await makeRoom(t, 2);
    const { page } = await openPage(t, root);
    let release;
    let seen;
    let requests = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { seen = resolve; });
    t.after(() => release());
    await page.route("**/api/file?rel=00_originals%2Fsource-1.txt", async (route) => {
        const earlier = ++requests === 1;
        if (earlier) {
            seen();
            await pending;
        }
        await route.fulfill({
            json: { ok: true, file: { kind: "text", size: 10, text: earlier ? "Stale A" : "Current A", truncated: false } },
        });
    });
    await page.locator('[data-v="files"]').click();
    await page.locator('[data-rel="00_originals/source-1.txt"]').click();
    await requested;
    await page.locator('[data-rel="00_originals/source-2.txt"]').click();
    await page.waitForFunction(() => document.querySelector("#viewer")?.textContent.includes("Source 2 contents"));
    await page.locator('[data-rel="00_originals/source-1.txt"]').click();
    await page.waitForFunction(() => document.querySelector("#viewer")?.textContent.includes("Current A"));
    const response = page.waitForResponse((r) => r.url().includes("source-1.txt"));
    release();
    await response;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator("#viewer").textContent(), /Current A/);
    assert.doesNotMatch(await page.locator("#viewer").textContent(), /Stale A/);
});

test("unrecognised room layouts do not receive a clean structural verdict", async (t) => {
    const root = await makeRoom(t);
    await rm(path.join(root, "00_originals"), { recursive: true });
    await writeFile(path.join(root, "source.txt"), "Known source\n");
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"),
        "Source ID,Path,Authority,Current or superseded\nS001,source.txt,Primary,current\n");
    const { page } = await openPage(t, root);
    const text = await page.locator("#p-overview").textContent();
    assert.match(text, /unrecognised|unrecognized/i);
    assert.doesNotMatch(text, /No structural drift detected/);
});

test("a narrow rail remains one horizontal tab strip", async (t) => {
    const root = await makeRoom(t);
    const { page } = await openPage(t, root, 500);
    const style = await page.locator(".rail").evaluate((node) => {
        const value = getComputedStyle(node);
        return { direction: value.flexDirection, wrap: value.flexWrap };
    });
    assert.deepEqual(style, { direction: "row", wrap: "nowrap" });
});

test("reconciliation-only coverage does not offer recapture or count toward a sweep", async (t) => {
    const root = await makeRoom(t, 2);
    await writeFile(path.join(root, "00_originals/alpha-transcript.txt"), "Newer synthetic capture\n");
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), [
        "Source ID,Path,Source type,Date,Authority,Current or superseded",
        "S001,00_originals/source-1.txt,Transcript,1999-01-01,Primary,current",
        "S002,00_originals/alpha-transcript.txt,Transcript,2000-01-01,Primary,current",
        "",
    ].join("\n"));
    await writeFile(path.join(root, "02_inventory/chat-index.md"), [
        "# Chat index",
        "## 1. Alpha monthly meeting",
        "**chat_id:** `19:alpha@thread.v2`",
        "| Source | Captured | Complete |",
        "| --- | --- | --- |",
        "| S001 | 1999-01-01 | yes |",
        "",
    ].join("\n"));
    const { page } = await openPage(t, root);
    await page.locator('[data-v="teams"]').click();
    await page.locator('.conv [data-act="reconcile"]').waitFor();
    assert.equal(await page.locator('.conv [data-act="recapture"]').count(), 0);
    assert.doesNotMatch(await page.locator('[data-v="teams"]').textContent(), /to sweep/);
    assert.match(await page.locator(".conv").textContent(), /37.day/i);
    await page.locator('.conv [data-act="task"]').click();
    assert.match(await page.locator("#promptout").textContent(), /Create a task to reconcile/);
    await page.locator("#sweepbtn").click();
    await page.locator("#promptout").waitFor({ state: "visible" });
    assert.doesNotMatch(await page.locator("#promptout").textContent(), /Re-capture these conversations/);
});

test("identity disagreements are visible and lead to the skill's reconciliation workflow", async (t) => {
    const root = await makeRoom(t, 2);
    await writeFile(path.join(root, "02_inventory/chat-index.md"), [
        "# Chat index",
        "## Quick map",
        "| # | Conversation | chat_id | Sources | Fully captured? |",
        "| --- | --- | --- | --- | --- |",
        "| 2 | Alpha | `19:alpha@thread.v2` | S001 | yes |",
        "## 1. Alpha",
        "**chat_id:** `19:alpha@thread.v2`",
        "| Source | Captured | Complete |",
        "| --- | --- | --- |",
        "| S001 | 1999-01-01 | no |",
        "## 2. Beta",
        "**chat_id:** `19:beta@thread.v2`",
        "| Source | Captured | Complete |",
        "| --- | --- | --- |",
        "| S002 | 1999-01-01 | yes |",
        "",
    ].join("\n"));
    const { page } = await openPage(t, root);
    await page.locator('[data-v="teams"]').click();
    assert.match(await page.locator("#p-teams").textContent(), /identity conflict/i);
    await page.locator('[data-act="reconcile"]').first().click();
    assert.match(await page.locator("#promptout").textContent(), /index\.md/);
});

test("quick-map-only sources are a reconciliation gap rather than an invented missing capture", async (t) => {
    const root = await makeRoom(t);
    await writeFile(path.join(root, "02_inventory/chat-index.md"), [
        "# Chat index",
        "## Quick map",
        "| # | Conversation | chat_id | Sources | Fully captured? |",
        "| --- | --- | --- | --- | --- |",
        "| 1 | Alpha | `19:alpha@thread.v2` | S001 | yes |",
        "",
    ].join("\n"));
    const { page } = await openPage(t, root);
    await page.locator('[data-v="teams"]').click();
    const text = await page.locator(".conv").textContent();
    assert.doesNotMatch(text, /No capture is recorded|never recorded|index reports fully captured/);
    assert.match(text, /reconcil/i);
    assert.equal(await page.locator('[data-act="recapture"]').count(), 0);
});

test("prefixed conversation source chips select only the exact inventory identifier", async (t) => {
    const root = await makeRoom(t, 2);
    await writeFile(path.join(root, "02_inventory/source_inventory.csv"), [
        "Source ID,Path,Authority,Current or superseded",
        "MEMO-S001,00_originals/source-1.txt,authoritative,current",
        "OTHER-S001,00_originals/source-2.txt,authoritative,current",
        "",
    ].join("\n"));
    await writeFile(path.join(root, "02_inventory/chat-index.md"), [
        "# Chat index",
        "## 1. Alpha",
        "**chat_id:** `19:alpha@thread.v2`",
        "| Source | Captured | Complete |",
        "| --- | --- | --- |",
        "| `MEMO-S001` | 1999-01-01 | yes |",
        "",
    ].join("\n"));
    const { page } = await openPage(t, root);
    await page.locator('[data-v="teams"]').click();
    const chip = page.locator(".conv .chip.src");
    assert.equal(await chip.textContent(), "MEMO-S001");
    await chip.click();
    await page.locator("#p-inventory").waitFor({ state: "visible" });
    assert.equal(await page.locator("#q").inputValue(), "MEMO-S001");
    assert.deepEqual(await page.locator("#list .row").evaluateAll((nodes) => nodes.map((node) => node.dataset.id)), ["MEMO-S001"]);
});

test("an invalid capture date is visibly unverified rather than a confident age", async (t) => {
    const root = await makeRoom(t);
    await writeFile(path.join(root, "02_inventory/chat-index.md"), [
        "# Chat index",
        "## 1. Alpha",
        "**chat_id:** `19:alpha@thread.v2`",
        "| Source | Captured | Complete |",
        "| --- | --- | --- |",
        "| S001 | 2026-02-30 | yes |",
        "",
    ].join("\n"));
    const { page } = await openPage(t, root);
    await page.locator('[data-v="teams"]').click();
    assert.match(await page.locator(".convwhen").textContent(), /date unverified/i);
    assert.doesNotMatch(await page.locator(".convwhen").textContent(), /days? ago/);
    assert.equal(await page.locator('.conv [data-act="reconcile"]').count(), 1);
    assert.equal(await page.locator('.conv [data-act="recapture"]').count(), 0);
});
