// `GET /personas/:name/rooms/:peer?format=html`: a room rendered as a page
// through the shared markdown pipeline. alice sends bob a message with a
// table and a fenced code block; the page bob gets shows a real table and a
// real code block, and each message body is byte-for-byte what
// `lib/markdown.mjs` renders — so an agent asserting on this route asserts on
// what the Room view shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

import { startDaemon } from "../daemon.mjs";
import { createMarkdown } from "../lib/markdown.mjs";
import { waitFor } from "./helpers.mjs";

const TEXT = "Here is a table:\n\n| name | ok |\n|---|---|\n| alice | yes |\n\n```js\nconst x = 1 < 2;\n```";

const call = async (url, method, route, body) => {
  const res = await fetch(`${url}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${json.error}`);
  return json;
};

test("the html room route renders a table and a code block through the shared pipeline", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-html-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (route) => call(daemon.url, "GET", route);
  const post = (route, body) => call(daemon.url, "POST", route, body);

  await post("/personas", { name: "alice", devices: 1 });
  await post("/personas", { name: "bob", devices: 1 });
  const { requestId } = await post("/personas/alice/requests", { to: "bob", welcome: "hi bob" });
  await waitFor(async () => (await get("/personas/bob/requests?status=pending")).find((r) => r.requestId === requestId));
  await post(`/personas/bob/requests/${requestId}/accept`, {});
  await waitFor(async () => (await get("/personas/alice/requests")).find((r) => r.requestId === requestId)?.status === "accepted");
  const sent = await post("/personas/alice/rooms/bob/messages", { text: TEXT });
  const row = await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((m) => m.messageId === sent.messageId));

  // One prefix: the page is under /api like every route; the bare path is not served.
  const res = await fetch(`${daemon.url}/api/personas/bob/rooms/alice?format=html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  const html = await res.text();
  assert.equal((await fetch(`${daemon.url}/personas/bob/rooms/alice?format=html`)).status, 404, "bare paths were dropped in S5");

  // A parsed page: the table and the code block are real elements, with
  // the message's text in them, and the markup is exactly the pipeline's.
  const { document } = new JSDOM(html).window;
  const article = document.querySelector(`article[data-id="${row.messageId}"]`);
  assert.ok(article, "the message has an article");
  assert.equal(article.dataset.direction, "incoming");
  assert.equal(article.querySelector("table td").textContent, "alice");
  assert.equal(article.querySelector("pre code.language-js").textContent, "const x = 1 < 2;\n");
  const expected = createMarkdown(new JSDOM("").window).render(TEXT);
  assert.equal(article.querySelector(".md").innerHTML, expected, "the body is the shared pipeline's output");
  assert.ok(expected.includes("<table>") && expected.includes("<pre><code class=\"language-js\">"));
  // The welcome is a message row too, and nothing on the page is raw markup from the message.
  assert.ok([...document.querySelectorAll("article")].some((a) => a.textContent.includes("hi bob")));
  assert.equal(document.querySelector("script"), null);
  assert.equal(document.title, "bob ⇄ alice");
});

test("the html room route escapes what is not markdown: names, labels and a script in the text", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-html-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (route) => call(daemon.url, "GET", route);
  const post = (route, body) => call(daemon.url, "POST", route, body);

  await post("/personas", { name: "alice", devices: 1 });
  await post("/personas", { name: "bob", devices: 1 });
  const { requestId } = await post("/personas/alice/requests", { to: "bob", welcome: null });
  await waitFor(async () => (await get("/personas/bob/requests?status=pending")).find((r) => r.requestId === requestId));
  await post(`/personas/bob/requests/${requestId}/accept`, {});
  await waitFor(async () => (await get("/personas/alice/requests")).find((r) => r.requestId === requestId)?.status === "accepted");
  const sent = await post("/personas/alice/rooms/bob/messages", { text: "<script>alert(1)</script> [x](javascript:alert(1))" });
  await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((m) => m.messageId === sent.messageId));

  const html = await (await fetch(`${daemon.url}/api/personas/bob/rooms/alice?format=html`)).text();
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelector("script"), null, "no script element anywhere on the page");
  assert.equal(document.querySelector("a[href^='javascript']"), null);
  const article = document.querySelector(`article[data-id="${sent.messageId}"]`);
  assert.equal(article.querySelector(".md").textContent.trim(), "<script>alert(1)</script> [x](javascript:alert(1))");
  // The accept is a system row with a label, not a markdown body.
  const system = document.querySelector("article[data-direction='system']");
  assert.equal(system.querySelector(".label").textContent, "Chat accepted");
});
