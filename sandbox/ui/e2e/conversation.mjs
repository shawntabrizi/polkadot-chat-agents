#!/usr/bin/env node
// The Conversation screen, end to end, in Chromium and in WebKit: a daemon
// serving the built UI, alice (one device) and bob (two devices) minted,
// the screen opened on alice | bob. alice opens the chat from the left
// pane, bob accepts in the right one, alice sends, bob replies from his
// second device quoting her, alice reacts. Only the pane last touched marks
// read, so the other pane's rows stay "unread" until it is touched. Then an
// echo bot on the right: its pane is alice's room with it, read-only.
// Saves sandbox/docs/images/conversation.png from the Chromium run.
// Everything it starts is stopped at the end.
//
//   cd sandbox/ui && npm run build && npm run acceptance:conversation

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, webkit } from "playwright";

import { startDaemon } from "../../daemon.mjs";
import { createBotHelper, createPcs } from "../../lib/scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(here, "../../docs/images");
const dist = path.resolve(here, "../dist/index.html");
if (!fs.existsSync(dist)) { console.error("build the UI first: cd sandbox/ui && npm run build"); process.exit(1); }

const log = (line) => console.log(`  ${line}`);
const SLOW = { timeout: 30_000 };

/** One fresh sandbox and one browser: the same story from a clean state each time. */
async function runIn(browserType, name, { screenshot }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-conv-"));
  const daemon = await startDaemon({ dir: path.join(work, "state"), port: 0 });
  const pcs = createPcs(daemon.url);
  const bot = createBotHelper({ sandboxUrl: daemon.url, botsDir: path.join(work, "bots"), log });
  let browser = null;
  const cleanup = async () => {
    await browser?.close().catch(() => {});
    await bot.stopAll();
    await daemon.stop();
    fs.rmSync(work, { recursive: true, force: true });
  };
  try {
    log(`${name}: daemon ${daemon.url}`);
    await pcs("user", "add", "alice");
    await pcs("user", "add", "bob", "--devices", 2);
    await bot.create("echobot", ["--brain", "echo", "--public"]);
    const handle = await bot.start("echobot");
    await handle.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });

    browser = await browserType.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(daemon.url);
    await page.getByTestId("connection").filter({ hasText: "Live" }).waitFor();
    await page.getByRole("button", { name: "Conversation" }).click();

    const left = page.getByTestId("pane-left");
    const right = page.getByTestId("pane-right");
    const leftPicker = page.getByLabel("Left participant");
    const rightPicker = page.getByLabel("Right participant");
    // Defaults: the active persona on the left; alice has no contact yet, so the first other participant.
    await expectValue(leftPicker, "alice");
    await expectValue(rightPicker, "bob");
    if (await page.getByLabel("Left device").count() !== 0) throw new Error("alice has one device; no device selector expected");
    await page.getByLabel("Right device").waitFor();

    // Not contacts yet: each pane shows what its side sees.
    await left.getByTestId("side-state").filter({ hasText: "No chat with bob yet." }).waitFor();
    await right.getByTestId("side-state").filter({ hasText: "No chat with alice yet." }).waitFor();
    await left.getByLabel("Welcome message").fill("hi from alice");
    await left.getByRole("button", { name: "Open a chat" }).click();
    await left.getByTestId("side-state").filter({ hasText: "You sent bob a request." }).waitFor(SLOW);
    const incoming = right.getByTestId("side-state").filter({ hasText: "alice wants to chat with you." });
    await incoming.getByText("“hi from alice”").waitFor(SLOW);
    await incoming.getByRole("button", { name: "Accept" }).click();
    await left.getByTestId("room").waitFor(SLOW);
    await right.getByTestId("room").waitFor(SLOW);
    log(`${name}: request opened from the left, accepted on the right, both panes show the room`);

    // alice sends. The left pane is the one touched, so bob's copy stays unread.
    const leftComposer = left.getByLabel("Message", { exact: true });
    const rightComposer = right.getByLabel("Message", { exact: true });
    await leftComposer.click();
    await leftComposer.type("hello bob");
    await leftComposer.press("Enter");
    const sent = left.locator('li[data-direction="outgoing"]').filter({ hasText: "hello bob" });
    await sent.getByTestId("status").filter({ hasText: "delivered from #1" }).waitFor(SLOW);
    const got = right.locator('li[data-direction="incoming"]').filter({ hasText: "hello bob" });
    await got.getByTestId("status").filter({ hasText: "on #1,#2 · acked #1,#2 · unread" }).waitFor(SLOW);
    log(`${name}: sent from the left, arrived on both of bob's devices, still unread on the right`);

    // bob replies from device 2, quoting. Touching the right pane marks it read.
    await page.getByLabel("Right device").selectOption("2");
    await got.hover();
    await got.getByRole("button", { name: "Reply" }).click();
    await got.getByTestId("status").filter({ hasText: "on #1,#2 · acked #1,#2" }).filter({ hasNotText: "unread" }).waitFor(SLOW);
    await rightComposer.type("hi alice");
    await rightComposer.press("Enter");
    const reply = right.locator('li[data-direction="outgoing"]').filter({ hasText: "hi alice" });
    await reply.locator(".quote").filter({ hasText: "hello bob" }).waitFor();
    await reply.getByTestId("status").filter({ hasText: "delivered from #2" }).waitFor(SLOW);
    const replyOnLeft = left.locator('li[data-direction="incoming"]').filter({ hasText: "hi alice" });
    await replyOnLeft.locator(".quote").filter({ hasText: "hello bob" }).waitFor(SLOW);
    await replyOnLeft.getByTestId("status").filter({ hasText: "on #1 · acked #1 · unread" }).waitFor(SLOW);
    log(`${name}: replied from bob's device 2 with a quote; unread on the left until touched`);

    // alice reacts; the reaction shows on both panes, and touching the left marks it read.
    await replyOnLeft.hover();
    await replyOnLeft.getByRole("button", { name: "👍" }).click();
    await replyOnLeft.locator(".reactions .pill").filter({ hasText: "👍" }).waitFor(SLOW);
    await reply.locator(".reactions .pill").filter({ hasText: "👍" }).waitFor(SLOW);
    await replyOnLeft.getByTestId("status").filter({ hasText: "on #1 · acked #1" }).filter({ hasNotText: "unread" }).waitFor(SLOW);
    if (screenshot) {
      await page.screenshot({ path: screenshot });
      log(`${name}: screenshot ${screenshot}`);
    }

    // A bot on the right: read-only, alice's room with it, no composer.
    await rightPicker.selectOption("echobot");
    await right.getByText("as seen by alice").waitFor();
    await left.getByTestId("side-state").filter({ hasText: "No chat with echobot yet." }).waitFor();
    await right.getByTestId("side-state").filter({ hasText: "alice has not opened a chat with echobot." }).waitFor();
    await left.getByRole("button", { name: "Open a chat" }).click();
    await left.getByTestId("room").waitFor(SLOW);
    await right.getByTestId("room").waitFor(SLOW);
    await leftComposer.click();
    await leftComposer.type("ping");
    await leftComposer.press("Enter");
    await right.locator('li[data-direction="incoming"]').filter({ hasText: "Echo: ping" }).waitFor(SLOW);
    if (await rightComposer.count() !== 0) throw new Error("a bot's pane must not have a composer");
    if (await right.getByRole("button", { name: "Reply" }).count() !== 0) throw new Error("a bot's pane must not offer actions");
    // The pair survives a reload.
    await page.reload();
    await page.getByTestId("connection").filter({ hasText: "Live" }).waitFor();
    await expectValue(page.getByLabel("Right participant"), "echobot");
    log(`${name}: the bot's pane is alice's room with it, read-only; the pair is remembered`);
    await cleanup();
  } catch (error) {
    console.error(`${name}: failed: ${error.message}`);
    console.error(bot.recentEvents().join("\n"));
    await cleanup();
    throw error;
  }
}

async function expectValue(locator, value) {
  await locator.waitFor();
  await locator.page().waitForFunction(([el, v]) => el.value === v, [await locator.elementHandle(), value], SLOW);
}

try {
  await runIn(chromium, "chromium", { screenshot: path.join(images, "conversation.png") });
  await runIn(webkit, "webkit", { screenshot: null });
  console.log("conversation acceptance passed (chromium, webkit)");
} catch {
  process.exit(1);
}
