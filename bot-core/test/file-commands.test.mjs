import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileStore } from "../lib/file-store.mjs";
import { createFileCommandHandler } from "../lib/file-commands.mjs";

const PEER_A = "aa".repeat(32);
const PEER_B = "bb".repeat(32);

const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-command-test-"));
  const source = path.join(dir, "source.txt");
  fs.writeFileSync(source, "file body", { mode: 0o600 });
  const delivered = [];
  const handler = createFileCommandHandler({
    fileStore: createFileStore({ dir: path.join(dir, "vault"), maxFileBytes: 1024, maxTotalMb: 1, maxEntries: 10 }),
    sendAttachment: async (peer, file) => { delivered.push({ peer, ...file }); },
  });
  return { dir, source, delivered, handler };
};

test("/file put persists the attachment and /file get sends only the owner file", async () => {
  const ctx = fixture();
  try {
    const put = await ctx.handler(PEER_A, {
      text: "/file put docs/report.txt",
      attachments: [{ downloaded: true, path: ctx.source, mime: "text/plain" }],
    });
    assert.equal(put.reply, "Saved docs/report.txt (9 B).");
    const other = await ctx.handler(PEER_B, { text: "/file get docs/report.txt" });
    assert.match(other.reply, /No saved file/);
    const get = await ctx.handler(PEER_A, { text: "/file get docs/report.txt" });
    assert.equal(get.reply, null);
    assert.equal(ctx.delivered.length, 1);
    assert.equal(ctx.delivered[0].text, "docs/report.txt");
    assert.equal(fs.readFileSync(ctx.delivered[0].filePath, "utf8"), "file body");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("/file command validates attachment count, overwrite, list, and remove", async () => {
  const ctx = fixture();
  try {
    const noAttachment = await ctx.handler(PEER_A, { text: "/file put report.txt", attachments: [] });
    assert.match(noAttachment.reply, /exactly one/);
    await ctx.handler(PEER_A, { text: "/file put report.txt", attachments: [{ downloaded: true, path: ctx.source, mime: "text/plain" }] });
    const exists = await ctx.handler(PEER_A, { text: "/file put report.txt", attachments: [{ downloaded: true, path: ctx.source, mime: "text/plain" }] });
    assert.match(exists.reply, /already exists/);
    const forced = await ctx.handler(PEER_A, { text: "/file put report.txt --force", attachments: [{ downloaded: true, path: ctx.source, mime: "text/plain" }] });
    assert.match(forced.reply, /Saved report.txt/);
    const listed = await ctx.handler(PEER_A, { text: "/file ls" });
    assert.match(listed.reply, /report.txt/);
    const removed = await ctx.handler(PEER_A, { text: "/file rm report.txt" });
    assert.equal(removed.reply, "Saved file removed.");
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("non-file messages remain available to the normal brain path", async () => {
  const ctx = fixture();
  try {
    assert.equal(await ctx.handler(PEER_A, { text: "please inspect this" }), null);
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
});
