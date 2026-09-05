#!/usr/bin/env node
// pcs — the sandbox CLI. A thin client of the daemon's HTTP API; `pcs up`
// runs the daemon in the foreground. JSON output when stdout is not a TTY
// or with --json; otherwise short human lines (ok/step/note/warn/fail like
// bot-core's pca).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_PORT, defaultDir, startDaemon } from "./daemon.mjs";

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) { positional.push(a); continue; }
  const key = a.slice(2);
  const next = args[i + 1];
  if (["json", "unread", "raw", "remove"].includes(key) || next == null || next.startsWith("--")) flags[key] = true;
  else { flags[key] = next; i += 1; }
}
const json = Boolean(flags.json) || !process.stdout.isTTY;
const baseUrl = flags.url ?? process.env.PCS_URL ?? `http://127.0.0.1:${flags.port ?? DEFAULT_PORT}`;

const c = (s, code) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${c("✓", "32")} ${s}`);
const step = (s) => console.log(`${c("→", "36")} ${s}`);
const note = (s) => console.log(`  ${c(s, "90")}`);
const warn = (s) => console.log(`${c("⚠", "33")} ${s}`);
const fail = (s) => { console.error(`${c("✗", "31")} ${s}`); process.exit(1); };
const out = (value) => console.log(JSON.stringify(value, null, 2));

const api = async (method, route, body) => {
  let res;
  try {
    res = await fetch(baseUrl + route, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    fail(`no sandbox at ${baseUrl} — start one with: pcs up`);
  }
  const data = await res.json();
  if (!res.ok) fail(data.error ?? `${method} ${route} failed (${res.status})`);
  return data;
};
const device = flags.device ? { device: Number(flags.device) } : {};
const short = (hex) => `${hex.slice(0, 10)}…`;
const when = (ms) => new Date(ms).toISOString().slice(11, 19);

const usage = `pcs — Polkadot chat sandbox

  pcs up [--dir ~/.pca/sandbox/default] [--port ${DEFAULT_PORT}]
  pcs user add <name> [--devices N]
  pcs user list
  pcs request <from> <to> [--welcome "text"] [--device N]
  pcs requests <name>
  pcs accept <name> [<requestId>] [--device N]
  pcs decline <name> [<requestId>]
  pcs send <from> <to> "text" [--reply <messageId>] [--device N]
  pcs react <from> <to> <messageId> <emoji> [--remove] [--device N]
  pcs edit <from> <to> <messageId> "text" [--device N]
  pcs inbox <name> [--peer <name>] [--unread] [--device N]
  pcs wire [--peer <name>] [--signer <account>] [--raw]
  pcs bot attach <pca-bot-name>            # register a pca bot's account in the directory
  pcs events

  --url <api url>   daemon to talk to (default ${baseUrl}); --json forces JSON output.`;

const pendingFor = async (name, requestId) => {
  if (requestId) return requestId;
  const pending = await api("GET", `/personas/${name}/requests?direction=incoming&status=pending`);
  if (pending.length === 0) fail(`${name} has no pending request`);
  if (pending.length > 1) fail(`${name} has ${pending.length} pending requests, name one: ${pending.map((r) => r.requestId).join(", ")}`);
  return pending[0].requestId;
};

const printMessages = (view) => {
  for (const m of view.messages) {
    const who = m.direction === "incoming" ? view.peerName ?? short(view.peer) : m.direction === "system" ? "·" : view.persona;
    const text = m.content.text ?? (m.content.type === "contactAdded" ? "chat accepted" : m.content.type);
    const status = m.direction === "outgoing" ? ` [${m.status}${m.device ? ` from #${m.device}` : ""}]`
      : m.direction === "incoming" ? ` [on #${m.receivedBy.join(",#")}${m.ackedBy.length ? ` acked #${m.ackedBy.join(",#")}` : ""}${m.read ? "" : " unread"}]` : "";
    const extras = [m.content.type === "reply" ? `↩ ${short(m.content.messageId)}` : "", m.editedAt ? "(edited)" : "", ...m.reactions.map((r) => `${r.emoji}${r.by === "me" ? "" : "·peer"}`)].filter(Boolean).join(" ");
    console.log(`${when(m.timestamp)} ${who}: ${text}${status}${extras ? ` ${extras}` : ""}`);
    note(`id ${m.messageId}`);
  }
};

const [cmd, ...rest] = positional;
switch (cmd) {
  case "up": {
    const dir = flags.dir ?? defaultDir();
    const daemon = await startDaemon({ dir, port: Number(flags.port ?? DEFAULT_PORT) });
    if (json) out({ url: daemon.url, storeUrl: daemon.storeUrl, dir });
    else {
      ok(`sandbox up at ${daemon.url}`);
      note(`statement store node ${daemon.storeUrl}`);
      note(`state dir ${dir}`);
      note("ctrl-c to stop");
    }
    const stop = () => daemon.stop().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  case "user": {
    const [sub, name] = rest;
    if (sub === "add") {
      if (!name) fail("usage: pcs user add <name> [--devices N]");
      const persona = await api("POST", "/personas", { name, devices: Number(flags.devices ?? 1) });
      if (json) out(persona);
      else {
        ok(`${persona.name} registered as ${short(persona.account)} with ${persona.devices.length} device(s)`);
        for (const d of persona.devices) note(`device ${d.index}: ${short(d.account)}`);
      }
    } else if (sub === "list") {
      const personas = await api("GET", "/personas");
      if (json) out(personas);
      else for (const p of personas) step(`${p.name}  ${p.account}  devices: ${p.devices.length}`);
    } else fail("usage: pcs user add <name> | pcs user list");
    break;
  }
  case "request": {
    const [from, to] = rest;
    if (!from || !to) fail("usage: pcs request <from> <to> [--welcome text]");
    const result = await api("POST", `/personas/${from}/requests`, { to, welcome: flags.welcome ?? null, ...device });
    if (json) out(result);
    else ok(`${from} → ${result.toName}: request ${result.requestId}`);
    break;
  }
  case "requests": {
    const [name] = rest;
    if (!name) fail("usage: pcs requests <name>");
    const list = await api("GET", `/personas/${name}/requests`);
    if (json) out(list);
    else if (list.length === 0) note(`${name} has no requests`);
    else for (const r of list) step(`${r.direction === "incoming" ? "from" : "to"} ${r.peerUsername} ${r.status}  ${r.requestId}${r.welcomeMessage ? `  "${r.welcomeMessage}"` : ""}`);
    break;
  }
  case "accept":
  case "decline": {
    const [name, requestId] = rest;
    if (!name) fail(`usage: pcs ${cmd} <name> [<requestId>]`);
    const id = await pendingFor(name, requestId);
    const result = await api("POST", `/personas/${name}/requests/${id}/${cmd}`, device);
    if (json) out(result);
    else ok(`${name} ${result.status} the request from ${result.peerUsername}${result.device ? ` on device ${result.device}` : ""}`);
    break;
  }
  case "send": {
    const [from, to, text] = rest;
    if (!from || !to || text == null) fail('usage: pcs send <from> <to> "text" [--reply id] [--device N]');
    const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { text, replyTo: flags.reply ?? null, ...device });
    if (json) out(message);
    else ok(`${from} → ${to}: ${message.status}  id ${message.messageId}`);
    break;
  }
  case "react": {
    const [from, to, messageId, emoji] = rest;
    if (!from || !to || !messageId || !emoji) fail("usage: pcs react <from> <to> <messageId> <emoji> [--remove]");
    const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { react: { messageId, emoji, add: !flags.remove }, ...device });
    if (json) out(message);
    else ok(`${from} ${flags.remove ? "removed" : "reacted"} ${emoji} on ${short(messageId)}`);
    break;
  }
  case "edit": {
    const [from, to, messageId, text] = rest;
    if (!from || !to || !messageId || text == null) fail('usage: pcs edit <from> <to> <messageId> "text"');
    const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { edit: { messageId, text }, ...device });
    if (json) out(message);
    else ok(`${from} edited ${short(messageId)}`);
    break;
  }
  case "inbox": {
    const [name] = rest;
    if (!name) fail("usage: pcs inbox <name> [--peer X] [--unread] [--device N]");
    const query = new URLSearchParams();
    if (flags.device) query.set("device", flags.device);
    if (flags.unread) query.set("unread", "1");
    const rooms = flags.peer ? [{ peer: flags.peer }] : await api("GET", `/personas/${name}/rooms`);
    const views = [];
    for (const room of rooms) views.push(await api("GET", `/personas/${name}/rooms/${room.peer}?${query}`));
    if (json) out(views);
    else if (views.length === 0) note(`${name} has no chats`);
    else for (const view of views) {
      step(`${name} ⇄ ${view.peerName ?? short(view.peer)}${flags.device ? ` (device ${flags.device})` : ""}${view.room?.unreadCount ? `  ${view.room.unreadCount} unread` : ""}`);
      printMessages(view);
    }
    break;
  }
  case "wire": {
    const query = new URLSearchParams();
    for (const k of ["peer", "signer", "topic"]) if (flags[k]) query.set(k, flags[k]);
    if (flags.raw) query.set("raw", "1");
    const { statements } = await api("GET", `/wire?${query}`);
    if (json) out(statements);
    else if (statements.length === 0) note("no statements");
    else for (const s of statements) {
      step(`${s.signerLabel ?? short(s.signer ?? "?")}  ${s.channelLabel ?? (s.channel ? short(s.channel) : "no channel")}  seq ${s.sequence}  ${s.bytes}B${s.replacedCount ? `  replaced ×${s.replacedCount}` : ""}`);
      for (const t of s.topics) note(`topic ${t.label ?? t.hex}`);
      if (flags.raw) note(s.hex);
    }
    break;
  }
  case "bot": {
    const [sub, name] = rest;
    if (sub !== "attach" || !name) fail("usage: pcs bot attach <pca-bot-name>");
    // Only the public half of the bot is read (account, identifier key,
    // username). secret.json holds its seed and is never opened here.
    const botsDir = process.env.PCA_BOTS_DIR ?? path.join(os.homedir(), ".pca", "bots");
    const file = path.join(botsDir, name, "config.json");
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(`no pca bot "${name}" (${file})`); }
    if (!cfg.account || !cfg.identifierKey) fail(`${file} has no account/identifierKey`);
    const entry = await api("POST", "/accounts/register", { account: cfg.account, username: cfg.username ?? name, identifierKey: cfg.identifierKey });
    if (json) out(entry);
    else {
      ok(`${name} attached as ${entry.username} (${short(entry.account)})`);
      if (cfg.networkProfile !== "sandbox") warn(`${name} targets ${cfg.endpoint}, not this sandbox. To run it here:  pca create ${name} --network sandbox`);
      else note(`run it:  pca run ${name}`);
    }
    break;
  }
  case "events": {
    let res;
    try { res = await fetch(`${baseUrl}/events`); } catch { fail(`no sandbox at ${baseUrl} — start one with: pcs up`); }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (data) console.log(data);
      }
    }
    break;
  }
  case "help":
  case undefined:
    console.log(usage);
    break;
  default:
    warn(`unknown command: ${cmd}`);
    console.log(usage);
    process.exit(1);
}
