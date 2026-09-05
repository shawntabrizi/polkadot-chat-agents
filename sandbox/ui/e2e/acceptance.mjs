#!/usr/bin/env node
// The S4 acceptance, end to end: a daemon serving the built UI, an echo bot
// created and run through `pca` (--network sandbox), alice sends a message
// with a markdown table and a fenced code block from the Room view in a
// headless browser, the echo comes back and renders as a table and a code
// block. Saves screenshots under sandbox/docs/images and prints the html
// route's output for the room. Everything it starts is stopped at the end.
//
//   cd sandbox/ui && npm run build && npm run acceptance

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { startDaemon } from "../../daemon.mjs";
import { createBotHelper, createPcs, createSandboxClient } from "../../lib/scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(here, "../../docs/images");
const dist = path.resolve(here, "../dist/index.html");
if (!fs.existsSync(dist)) { console.error("build the UI first: cd sandbox/ui && npm run build"); process.exit(1); }

const TEXT = [
  "Here is a table and some code:",
  "",
  "| feature | status |",
  "|---|---|",
  "| tables | rendered |",
  "| code | rendered |",
  "",
  "```js",
  "const echo = (s) => `Echo: ${s}`;",
  "```",
].join("\n");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-accept-"));
const log = (line) => console.log(`  ${line}`);
const daemon = await startDaemon({ dir: path.join(work, "state"), port: 0 });
const sandbox = createSandboxClient(daemon);
const pcs = createPcs(daemon.url);
const bot = createBotHelper({ sandboxUrl: daemon.url, botsDir: path.join(work, "bots"), log });
let browser = null;
const cleanup = async () => {
  await browser?.close().catch(() => {});
  await bot.stopAll();
  await daemon.stop();
  fs.rmSync(work, { recursive: true, force: true });
};
process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

try {
  log(`daemon ${daemon.url} (serving sandbox/ui/dist)`);
  await pcs("user", "add", "alice", "--devices", 2);
  await bot.create("echobot", ["--brain", "echo", "--public"]);
  const handle = await bot.start("echobot");
  await handle.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(daemon.url);
  await page.getByTestId("connection").filter({ hasText: "Live" }).waitFor();
  await page.getByTestId("persona-detail").filter({ hasText: "alice" }).waitFor();
  await page.screenshot({ path: path.join(images, "s4-personas.png") });

  // Requests: find the bot in the directory and open a chat with a welcome.
  await page.getByRole("button", { name: "Requests" }).click();
  await page.getByLabel("Username").fill("echo");
  await page.getByLabel("Welcome message").fill("hello bot");
  await page.getByRole("button", { name: "Search" }).click();
  const result = page.getByTestId("search-result").filter({ hasText: "echobot" });
  await result.getByText("bot", { exact: true }).waitFor();
  await result.getByRole("button", { name: "Send request" }).click();
  await page.getByTestId("outgoing-request").filter({ hasText: "echobot" }).filter({ hasText: "accepted" }).waitFor({ timeout: 30_000 });
  await sandbox.waitFor(() => { try { return bot.state("echobot").peers[0]?.devices.length === 2; } catch { return false; } }, { label: "the bot's roster holds both devices" });
  await page.screenshot({ path: path.join(images, "s4-requests.png") });

  // Chats: the markdown message from the Room view, Enter sends.
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByTestId("chat-row").filter({ hasText: "echobot" }).click();
  const composer = page.getByLabel("Message");
  for (const [i, line] of TEXT.split("\n").entries()) {
    if (i > 0) await composer.press("Shift+Enter");
    await composer.type(line);
  }
  await composer.press("Enter");
  const echo = page.locator('li[data-direction="incoming"]').filter({ hasText: "Echo: Here is a table" });
  await echo.locator(".md table td", { hasText: "rendered" }).first().waitFor({ timeout: 30_000 });
  await echo.locator(".md pre code.language-js").waitFor();
  await echo.getByTestId("status").filter({ hasText: "on #1,#2 · acked #1,#2" }).waitFor({ timeout: 30_000 });
  await page.locator('li[data-direction="outgoing"]').filter({ hasText: "Here is a table" }).locator(".md table").waitFor();
  // The row by id from here on: a reply will quote its text, and an edit will change it.
  const own = page.locator(`li[data-id="${await page.locator('li[data-direction="outgoing"]').filter({ hasText: "Here is a table" }).getAttribute("data-id")}"]`);
  await own.getByTestId("status").filter({ hasText: "delivered from #1" }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(images, "s4-room-markdown.png") });
  log("the echo renders as a table and a code block in the Room view");

  // Reply, react and edit from the Room view.
  await echo.hover();
  await echo.getByRole("button", { name: "Reply" }).click();
  await composer.type("thanks");
  await composer.press("Enter");
  const reply = page.locator('li[data-direction="outgoing"]').filter({ hasText: "thanks" });
  await reply.locator(".quote").filter({ hasText: "Echo: Here is a table" }).waitFor();
  await reply.getByTestId("status").filter({ hasText: "delivered from #1" }).waitFor({ timeout: 30_000 });
  await echo.hover();
  await echo.getByRole("button", { name: "👍" }).click();
  await echo.locator(".reactions .pill").filter({ hasText: "👍" }).waitFor();
  await own.hover();
  await own.getByRole("button", { name: "Edit" }).click();
  await composer.fill("Edited:\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  await composer.press("Enter");
  await own.filter({ hasText: "edited" }).locator(".md table td").filter({ hasText: "2" }).waitFor({ timeout: 30_000 });
  log("reply quoted, reaction shown, own message edited");

  // Wire: the inspector on the same conversation, then the fault and clock controls.
  await page.getByRole("button", { name: "Wire" }).click();
  await page.getByLabel("Peer").selectOption("alice");
  await page.locator("table[data-testid=wire-table] tbody tr").first().waitFor();
  await page.locator("table[data-testid=wire-table] tbody tr").filter({ hasText: "session echobot#1→alice /request" }).first().click();
  await page.getByTestId("statement-detail").waitFor();
  await page.screenshot({ path: path.join(images, "s4-wire.png") });
  await page.getByLabel("From").fill("echobot");
  await page.getByLabel("Count (or forever)").fill("2");
  await page.getByRole("button", { name: "Add fault" }).click();
  await page.getByTestId("fault-row").filter({ hasText: "drop" }).filter({ hasText: "hits 0/2" }).waitFor();
  await page.getByTestId("event-log").getByText("fault", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "+10 s" }).click();
  await page.getByText("clock +10000 ms").waitFor();
  await page.getByRole("button", { name: "Reset clock" }).click();
  await page.getByText("clock +0 ms").waitFor();
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByText("No faults.").waitFor();
  const faults = await sandbox.get("/faults");
  if (faults.length !== 0) throw new Error("faults not cleared");
  log("fault set and cleared, clock moved and reset, events logged");

  // The same room under a dark OS theme (Berlin Night).
  const dark = await browser.newPage({ viewport: { width: 1280, height: 820 }, colorScheme: "dark" });
  await dark.goto(daemon.url);
  await dark.getByRole("button", { name: "Chats" }).click();
  await dark.getByTestId("chat-row").filter({ hasText: "echobot" }).click();
  await dark.locator('li[data-direction="incoming"] .md table').first().waitFor();
  await dark.screenshot({ path: path.join(images, "s4-room-dark.png") });
  await dark.close();

  // The html route, as an agent would read it.
  const res = await fetch(`${daemon.url}/personas/alice/rooms/echobot?format=html`);
  const html = await res.text();
  if (!/<article[^>]*data-direction="incoming"[\s\S]*?<table>[\s\S]*?<td>rendered<\/td>[\s\S]*?<pre><code class="language-js">/.test(html)) throw new Error("html route: the echo did not render a table and a code block");
  fs.writeFileSync(path.join(work, "room.html"), html);
  console.log("\n--- GET /personas/alice/rooms/echobot?format=html ---");
  console.log(html);
  console.log("--- end ---\n");
  log(`screenshots: ${path.join(images, "s4-room-markdown.png")}, s4-requests.png, s4-wire.png`);
  await cleanup();
  console.log("acceptance passed");
} catch (error) {
  console.error("acceptance failed:", error.message);
  console.error(bot.recentEvents().join("\n"));
  await cleanup();
  process.exit(1);
}
