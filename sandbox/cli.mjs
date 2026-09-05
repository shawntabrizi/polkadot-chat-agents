#!/usr/bin/env node
// pcs — the sandbox CLI. A thin client of the daemon's HTTP API; `pcs up`
// runs the daemon in the foreground. JSON output when stdout is not a TTY
// or with --json; otherwise short human lines (ok/step/note/warn/fail like
// bot-core's pca).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_PORT, defaultDir, startDaemon } from "./daemon.mjs";
import { DEFAULT_NETWORK, NETWORK_IDS } from "./lib/network.mjs";
import { runScenario } from "./lib/scenario.mjs";

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) { positional.push(a); continue; }
  const key = a.slice(2);
  const next = args[i + 1];
  // --raw is a switch for `wire` and takes hex bytes for `send`.
  const isSwitch = ["json", "unread", "remove", "decode"].includes(key) || (key === "raw" && !/^0x/i.test(next ?? ""));
  if (isSwitch || next == null || next.startsWith("--")) flags[key] = true;
  else { flags[key] = next; i += 1; }
}
const json = Boolean(flags.json) || !process.stdout.isTTY;
const baseUrl = flags.url ?? process.env.PCS_URL ?? `http://127.0.0.1:${flags.port ?? DEFAULT_PORT}`;

const c = (s, code) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${c("✓", "32")} ${s}`);
const step = (s) => console.log(`${c("→", "36")} ${s}`);
const note = (s) => console.log(`  ${c(s, "90")}`);
const warn = (s) => console.log(`${c("⚠", "33")} ${s}`);
const fail = (s) => { console.error(`${c("✗", "31")} ${s}`); process.exit(1); };
const out = (value) => console.log(JSON.stringify(value, null, 2));

const api = async (method, route, body) => {
  let res;
  try {
    res = await fetch(`${baseUrl}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
// One line per attachment: what it is, and where its bytes are from the
// viewing device's side — claimed here, claimed by a sibling (the
// desktop's placeholder), still claiming, or failed with the reason.
const attachmentLine = (a, viewDevice) => {
  const what = `📎 ${a.kind} ${a.mimeType} ${size(a.fileSize)}${a.width ? ` ${a.width}×${a.height}` : ""}`;
  if (a.status === "sent") return `${what} [sent, media ${a.mediaId}]`;
  if (a.status === "claimed") return viewDevice && a.claimedBy !== viewDevice ? `${what} [claimed by device ${a.claimedBy}]` : `${what} [claimed on #${a.claimedBy}, media ${a.mediaId}]`;
  if (a.status === "claiming") return `${what} [claiming on #${a.claimedBy}]`;
  if (a.status === "failed") return `${what} [failed on #${a.claimedBy}: ${a.error}]`;
  return `${what} [not claimed]`;
};

const usage = `pcs — Polkadot chat sandbox

  pcs up [--dir ~/.pca/sandbox/default] [--port ${DEFAULT_PORT}] [--network ${NETWORK_IDS.join("|")}]
                                           # mock (default): every part on this machine; paseo: the real Paseo Next network
  pcs user add <name> [--devices N]        # on paseo: single-device, registered through the identity backend;
                                           #   [--username <6+ letters>] [--wait <secs>]; run again to keep waiting
  pcs user list
  pcs user find <prefix>                   # usernames: the directory's, or the identity backend's checked against the chain
  pcs request <from> <to> [--welcome "text"] [--device N]
  pcs requests <name>
  pcs accept <name> [<requestId>] [--device N]
  pcs decline <name> [<requestId>]
  pcs send <from> <to> "text" [--reply <messageId>] [--device N]
  pcs send <from> <to> --attach <file> [--caption "text"] [--device N]   # a photo or file through HOP
  pcs send <from> <to> --raw 0x<bytes>       # raw message bytes into the batch (an undecodable message)
  pcs call <from> <to> [--device N]          # a WebRTC offer; the peer's decline shows in the inbox
  pcs device add <name> | pcs device remove <name> <n>
  pcs react <from> <to> <messageId> <emoji> [--remove] [--device N]
  pcs edit <from> <to> <messageId> "text" [--device N]
  pcs inbox <name> [--peer <name>] [--unread] [--device N]
  pcs wire [--peer <name>] [--signer <account>] [--channel <hex|label>] [--decode] [--raw]
  pcs wire --history <channel hex|label>   # what the slot held before, oldest first
  pcs fault drop|delay|delay-reply [--from <name|account>] [--channel <hex|label>] [--topic <hex|label>] [--count N|forever] [--ms N]
  pcs fault hold-dump [--topic <hex|label>] [--for <name>]
  pcs fault list | pcs fault clear [<id>]
  pcs clock +2h|-30m|+10s|reset            # move the store node's clock
  pcs node restart|reset                   # drop every socket (keep / wipe the store)
  pcs hop                                  # the HOP pool: every entry, who signed and claimed it
  pcs hop fault refuse|cut|delay|drop|corrupt [--hash <entry>] [--method claim|ack|submit] [--count N|forever] [--ms N]
  pcs hop clear [<id>]
  pcs bot attach <pca-bot-name>            # mock: register a pca bot's account (and its Bulletin signer) in the directory;
                                           # paseo: check the chain holds the bot, so the sandbox can name it
  pcs bot list
  pcs scenario run <file> [--network paseo]   # run a scripted scenario on a fresh daemon
  pcs events

  --url <api url>   daemon to talk to (default ${baseUrl}); --json forces JSON output.`;

const pendingFor = async (name, requestId) => {
  if (requestId) return requestId;
  const pending = await api("GET", `/personas/${name}/requests?direction=incoming&status=pending`);
  if (pending.length === 0) fail(`${name} has no pending request`);
  if (pending.length > 1) fail(`${name} has ${pending.length} pending requests, name one: ${pending.map((r) => r.requestId).join(", ")}`);
  return pending[0].requestId;
};

const printDecoded = (s) => {
  const d = s.decoded;
  if (!d) return;
  const acks = s.acks?.length ? `  acked by ${s.acks.map((a) => `${a.by} (${a.code})`).join(", ")}` : s.acks ? "  no ack" : "";
  if (d.kind === "chatRequest") {
    note(d.sealed ? "chat request (addressed to a bot: no key here)" : d.undecodable ? "chat request (undecodable)" : `chat request ${short(d.requestId)} from ${d.sender.label ?? short(d.sender.account)}${d.welcome != null ? `  "${d.welcome}"` : ""}`);
    return;
  }
  if (d.kind === "response") {
    note(d.sealed ? "response (sealed envelope)" : `response to ${short(d.requestId)}  ${d.responseCode}${d.recipients ? `  for ${d.recipients.map((r) => r.label ?? short(r.statementAccountId)).join(",")}` : ""}`);
    return;
  }
  if (d.kind === "request") {
    note(d.sealed ? "request (sealed envelope)" : `request ${short(d.requestId)}  ${d.messages.length} message(s)${d.recipients ? `  for ${d.recipients.map((r) => r.label ?? short(r.statementAccountId)).join(",")}` : ""}${acks}`);
    for (const m of d.messages ?? []) {
      if (m.undecodable) { note(`  undecodable (${m.bytes} bytes)`); continue; }
      const c = m.content;
      const body = c.type === "text" || c.type === "reply" || c.type === "edit" ? `"${c.text}"` : c.type === "reaction" ? `${c.emoji} on ${short(c.messageId)}` : c.type === "richText" ? `"${c.text ?? ""}" +${c.attachments.length} attachment(s)` : "";
      note(`  ${c.type} ${body}  id ${short(m.messageId)}`);
    }
    return;
  }
  note(d.kind);
};
const printStatement = (s) => {
  step(`${s.signerLabel ?? short(s.signer ?? "?")}  ${s.channelLabel ?? (s.channel ? short(s.channel) : "no channel")}  seq ${s.sequence}  ${s.bytes}B${s.replacedCount ? `  replaced ×${s.replacedCount}` : ""}${s.replacedAt ? `  ${s.reason} at ${when(Date.parse(s.replacedAt))}` : ""}`);
  for (const t of s.topics) note(`topic ${t.label ?? t.hex}`);
  if (flags.decode || flags.history) printDecoded(s);
  if (flags.raw) note(s.hex);
};
// +2h, -30m, +10s, 500ms → milliseconds.
const parseOffset = (value) => {
  const m = /^([+-]?\d+)(ms|s|m|h|d)$/.exec(String(value));
  if (!m) fail(`not a duration: ${value} (use +2h, -30m, +10s, 500ms)`);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
};

const printMessages = (view) => {
  for (const m of view.messages) {
    const who = m.direction === "incoming" ? view.peerName ?? short(view.peer) : m.direction === "system" ? "·" : view.persona;
    const text = m.content.text ?? (m.content.type === "contactAdded" ? "chat accepted" : m.content.type === "richText" ? "" : m.content.type);
    const status = m.direction === "outgoing" ? ` [${m.status}${m.device ? ` from #${m.device}` : ""}]`
      : m.direction === "incoming" ? ` [on #${m.receivedBy.join(",#")}${m.ackedBy.length ? ` acked #${m.ackedBy.join(",#")}` : ""}${m.read ? "" : " unread"}]` : "";
    const extras = [m.content.type === "reply" ? `↩ ${short(m.content.messageId)}` : "", m.editedAt ? "(edited)" : "", ...m.reactions.map((r) => `${r.emoji}${r.by === "me" ? "" : "·peer"}`)].filter(Boolean).join(" ");
    console.log(`${when(m.timestamp)} ${who}: ${text}${status}${extras ? ` ${extras}` : ""}`);
    for (const a of m.content.attachments ?? []) note(attachmentLine(a, flags.device ? Number(flags.device) : null));
    note(`id ${m.messageId}`);
  }
};

const [cmd, ...rest] = positional;
switch (cmd) {
  case "up": {
    const dir = flags.dir ?? defaultDir();
    const network = String(flags.network ?? DEFAULT_NETWORK);
    if (!NETWORK_IDS.includes(network)) fail(`--network must be one of ${NETWORK_IDS.join(", ")}`);
    let daemon;
    try { daemon = await startDaemon({ dir, port: Number(flags.port ?? DEFAULT_PORT), network }); }
    catch (e) { fail(e.message); }
    if (json) out({ url: daemon.url, network: daemon.network, genesis: daemon.genesis, storeUrl: daemon.storeUrl, hopUrl: daemon.hopUrl, dir, chainReset: daemon.chainReset, personas: [...daemon.personas.keys()], bots: [...daemon.bots.keys()] });
    else {
      ok(`sandbox up at ${daemon.url} on ${daemon.network}`);
      note(`statement store ${daemon.storeUrl}`);
      note(`HOP node (attachments) ${daemon.hopUrl}`);
      if (daemon.genesis) note(`chain genesis ${daemon.genesis}`);
      note(`state dir ${dir}`);
      if (daemon.chainReset) {
        warn(`the chain was reset: genesis ${short(daemon.chainReset.previous)} → ${short(daemon.chainReset.current)}${daemon.chainReset.since ? ` (last seen ${daemon.chainReset.since})` : ""}`);
        if (daemon.chainReset.personas.length) note(`personas needing re-registration: ${daemon.chainReset.personas.join(", ")}  (pcs user add <name> claims a new username)`);
        if (daemon.chainReset.bots.length) note(`bots needing re-registration: ${daemon.chainReset.bots.join(", ")}  (pca register <bot> --again)`);
      }
      for (const p of daemon.personas.values()) {
        const r = p.registration;
        if (r) note(`persona ${p.name}: ${r.username ?? "(no username yet)"} ${r.status}`);
      }
      note("ctrl-c to stop");
    }
    const stop = () => daemon.stop().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  case "user": {
    const [sub, name] = rest;
    const registrationLine = (r) => `${r.username ?? "(no username yet)"} ${r.status === "attested" ? "attested" : r.status === "claimed" ? "pending attestation" : r.status === "needs-reregistration" ? "needs re-registration (the chain was reset)" : r.status}${r.bulletin && r.bulletin !== "none" ? `, Bulletin allowance ${r.bulletin}` : ""}`;
    if (sub === "add") {
      if (!name) fail("usage: pcs user add <name> [--devices N] [--username <letters>] [--wait <secs>]");
      if (!json) step(`Adding ${name}…`);
      const persona = await api("POST", "/personas", { name, devices: Number(flags.devices ?? 1), username: flags.username ?? null, wait: flags.wait ?? null });
      if (json) out(persona);
      else if (persona.registration) {
        const r = persona.registration;
        if (r.status === "attested") ok(`${persona.name} registered as ${r.username} (${short(persona.account)}), attested on chain`);
        else if (r.status === "claimed") warn(`${persona.name} claimed ${r.username} (${short(persona.account)}); attestation pending — run  pcs user add ${name}  again to keep waiting`);
        else warn(`${persona.name}: ${registrationLine(r)}`);
        if (r.bulletin === "failed") warn("no Bulletin allowance: the persona can chat but not send attachments (see the daemon log)");
        for (const d of persona.devices) note(`device ${d.index}: ${short(d.account)}`);
      } else {
        ok(`${persona.name} registered as ${short(persona.account)} with ${persona.devices.length} device(s)`);
        for (const d of persona.devices) note(`device ${d.index}: ${short(d.account)}`);
      }
    } else if (sub === "list") {
      const personas = await api("GET", "/personas");
      if (json) out(personas);
      else for (const p of personas) step(`${p.name}  ${p.account}  devices: ${p.devices.length}${p.registration ? `  ${registrationLine(p.registration)}` : ""}`);
    } else if (sub === "find") {
      if (!name) fail("usage: pcs user find <prefix>");
      const hits = await api("GET", `/usernames?prefix=${encodeURIComponent(name)}`);
      if (json) out(hits);
      else if (hits.length === 0) note(`no username starts with ${name}`);
      else for (const h of hits) step(`${h.username}  ${short(h.account)}  ${h.status ?? ""}${h.onChain ? "" : "  (not on this chain: registered before a reset, or not attested yet)"}`);
    } else fail("usage: pcs user add <name> | pcs user list | pcs user find <prefix>");
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
    if (!from || !to || (text == null && !flags.raw && !flags.attach)) fail('usage: pcs send <from> <to> "text" [--reply id] [--device N] | pcs send <from> <to> --attach <file> [--caption "text"] | pcs send <from> <to> --raw 0x..');
    if (flags.raw && flags.raw !== true) {
      const result = await api("POST", `/personas/${from}/rooms/${to}/messages`, { raw: flags.raw, ...device });
      if (json) out(result);
      else ok(`${from} → ${to}: ${result.bytes} raw bytes queued`);
      break;
    }
    if (flags.attach) {
      if (flags.attach === true) fail("usage: pcs send <from> <to> --attach <file> [--caption \"text\"]");
      const file = path.resolve(String(flags.attach));
      if (!fs.existsSync(file)) fail(`no such file: ${file}`);
      const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { file, text: flags.caption ?? text ?? null, ...device });
      if (json) out(message);
      else {
        const [a] = message.content.attachments;
        ok(`${from} → ${to}: ${message.status}  id ${message.messageId}`);
        note(`${a.kind} ${a.mimeType} ${size(a.fileSize)}${a.width ? ` ${a.width}×${a.height}` : ""}  ${a.chunks.length} chunk(s) on ${a.wssUrl}  id ${short(a.identifier)}`);
      }
      break;
    }
    const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { text, replyTo: flags.reply ?? null, ...device });
    if (json) out(message);
    else ok(`${from} → ${to}: ${message.status}  id ${message.messageId}`);
    break;
  }
  case "call": {
    const [from, to] = rest;
    if (!from || !to) fail("usage: pcs call <from> <to> [--device N]");
    const message = await api("POST", `/personas/${from}/rooms/${to}/messages`, { call: true, ...device });
    if (json) out(message);
    else ok(`${from} → ${to}: call offer ${message.messageId}`);
    break;
  }
  case "device": {
    const [sub, name, index] = rest;
    if (sub === "add" && name) {
      const added = await api("POST", `/personas/${name}/devices`);
      if (json) out(added);
      else ok(`${name} device ${added.index}: ${short(added.account)}`);
    } else if (sub === "remove" && name && index) {
      const removed = await api("DELETE", `/personas/${name}/devices/${index}`);
      if (json) out(removed);
      else ok(`${name} device ${removed.index} removed; contacts told`);
    } else fail("usage: pcs device add <name> | pcs device remove <name> <n>");
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
    if (flags.raw) query.set("raw", "1");
    if (flags.history) {
      query.set("channel", flags.history);
      if (flags.signer) query.set("signer", flags.signer);
      const { history } = await api("GET", `/wire/history?${query}`);
      if (json) out(history);
      else if (history.length === 0) note("nothing on that channel");
      else for (const s of history) printStatement(s);
      break;
    }
    for (const k of ["peer", "signer", "topic", "channel"]) if (flags[k]) query.set(k, flags[k]);
    const { statements } = await api("GET", `/wire?${query}`);
    if (json) out(statements);
    else if (statements.length === 0) note("no statements");
    else for (const s of statements) printStatement(s);
    break;
  }
  case "fault": {
    const [sub, id] = rest;
    if (sub === "list") {
      const faults = await api("GET", "/faults");
      if (json) out(faults);
      else if (faults.length === 0) note("no faults");
      else for (const f of faults) step(`#${f.id} ${f.kind}${f.signer ? ` from ${f.signer.map(short).join(",")}` : ""}${f.channel ? ` channel ${short(f.channel)}` : ""}${f.topic ? ` topic ${short(f.topic)}` : ""}${f.ms != null ? ` ${f.ms}ms` : ""}  hits ${f.hits}${f.count != null ? `/${f.count}` : ""}${f.held ? `  holding ${f.held}` : ""}`);
    } else if (sub === "clear") {
      const result = await api("DELETE", `/faults/${id ?? "all"}`);
      if (json) out(result);
      else ok(`cleared ${result.cleared} fault(s)`);
    } else if (sub === "drop" || sub === "delay" || sub === "delay-reply" || sub === "hold-dump") {
      const kinds = { drop: "drop", delay: "delay", "delay-reply": "delaySubmitReply", "hold-dump": "holdDump" };
      const body = { kind: kinds[sub], from: flags.from ?? null, channel: flags.channel ?? null, topic: flags.topic ?? (flags.for ? `request→${flags.for}` : null) };
      if (flags.count != null) body.count = flags.count === "forever" ? null : Number(flags.count);
      if (sub === "delay" || sub === "delay-reply") { if (flags.ms == null) fail(`usage: pcs fault ${sub} --ms N [...]`); body.ms = Number(flags.ms); }
      const fault = await api("POST", "/faults", body);
      if (json) out(fault);
      else ok(`fault #${fault.id} ${fault.kind} set${fault.count != null ? ` for ${fault.count} hit(s)` : " until cleared"}`);
    } else fail("usage: pcs fault drop|delay|delay-reply|hold-dump [...] | pcs fault list | pcs fault clear [id]");
    break;
  }
  case "clock": {
    const [value] = rest;
    if (!value) fail("usage: pcs clock +2h|-30m|reset");
    const clock = await api("POST", "/clock", value === "reset" ? { reset: true } : { offsetMs: parseOffset(value) });
    if (json) out(clock);
    else ok(`store node clock offset is now ${clock.offsetMs}ms`);
    break;
  }
  case "node": {
    const [sub] = rest;
    if (sub !== "restart" && sub !== "reset") fail("usage: pcs node restart|reset");
    const result = await api("POST", `/node/${sub}`);
    if (json) out(result);
    else ok(`node ${sub === "restart" ? "restarted" : "reset"}: every socket dropped, ${result.statements} statement(s) in the store`);
    break;
  }
  case "hop": {
    const [sub, kind] = rest;
    if (sub === "fault") {
      if (!["refuse", "cut", "delay", "drop", "corrupt"].includes(kind)) fail("usage: pcs hop fault refuse|cut|delay|drop|corrupt [--hash <entry>] [--method claim|ack|submit] [--count N|forever] [--ms N]");
      const body = { kind, hash: flags.hash ?? null, method: flags.method ?? null };
      if (flags.count != null) body.count = flags.count === "forever" ? null : Number(flags.count);
      if (kind === "delay") { if (flags.ms == null) fail("usage: pcs hop fault delay --ms N [...]"); body.ms = Number(flags.ms); }
      const fault = await api("POST", "/hop/faults", body);
      if (json) out(fault);
      else ok(`HOP fault #${fault.id} ${fault.kind} on ${fault.method}${fault.hash ? ` of ${short(fault.hash)}` : ""} set${fault.count != null ? ` for ${fault.count} hit(s)` : " until cleared"}`);
      break;
    }
    if (sub === "clear") {
      const result = await api("DELETE", `/hop/faults/${kind ?? "all"}`);
      if (json) out(result);
      else ok(`cleared ${result.cleared} HOP fault(s)`);
      break;
    }
    if (sub != null) fail("usage: pcs hop | pcs hop fault … | pcs hop clear [id]");
    const pool = await api("GET", "/hop");
    if (json) out(pool);
    else {
      step(`HOP node ${pool.url}: ${pool.status.entryCount} entr${pool.status.entryCount === 1 ? "y" : "ies"} holding ${pool.status.totalBytes}B of ${pool.status.maxBytes}B`);
      if (pool.entries.length === 0) note("no entries");
      for (const e of pool.entries) {
        const role = e.role ? `${e.role}${e.owner ? ` of ${e.owner}` : ""}` : "entry";
        note(`${short(e.hash)}  ${role}  ${e.bytes}B  by ${e.signerLabel ?? (e.signer ? short(e.signer) : "fixture")}  claimed ×${e.claims}${e.acked ? "  acked" : ""}${e.available ? "" : `  gone (${e.reason ?? "removed"})`}`);
      }
      for (const f of pool.faults) note(`fault #${f.id} ${f.kind} on ${f.method}${f.hash ? ` of ${short(f.hash)}` : ""}  hits ${f.hits}${f.count != null ? `/${f.count}` : ""}`);
    }
    break;
  }
  case "bot": {
    const [sub, name] = rest;
    if (sub === "list") {
      const list = await api("GET", "/bots");
      if (json) out(list);
      else if (list.length === 0) note("no bots attached");
      else for (const b of list) step(`${b.name}  ${b.username ?? "?"}  ${short(b.account)}${b.onChain === false ? "  not on this chain — pca register " + b.name + " --again" : ""}`);
      break;
    }
    if (sub !== "attach" || !name) fail("usage: pcs bot attach <pca-bot-name> | pcs bot list");
    // Only the public half of the bot is read (account, identifier key,
    // username). secret.json holds its seed and is never opened here.
    const botsDir = process.env.PCA_BOTS_DIR ?? path.join(os.homedir(), ".pca", "bots");
    const file = path.join(botsDir, name, "config.json");
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(`no pca bot "${name}" (${file})`); }
    if (!cfg.account || !cfg.identifierKey) fail(`${file} has no account/identifierKey`);
    // bulletinAccount is the public half of the bot's upload signer; without
    // it the bot can receive attachments but not return files.
    const info = await api("GET", "/node");
    const entry = await api("POST", "/bots/attach", { name, account: cfg.account, username: cfg.username ?? name, identifierKey: cfg.identifierKey, bulletinAccount: cfg.bulletinAccount ?? null, networkProfile: cfg.networkProfile ?? null });
    if (json) out(entry);
    else {
      const expected = info.mock ? "sandbox" : info.network;
      if (entry.onChain === false) warn(`${name} (${entry.username ?? name}, ${short(entry.account)}) is not on this chain: the chain has no identifier key for it. Re-register it:  pca register ${name} --again`);
      else ok(`${name} attached as ${entry.username} (${short(entry.account)})${entry.bulletinAccount ? ", file delivery allowed" : ""}`);
      if (cfg.networkProfile !== expected) warn(`${name} targets ${cfg.networkProfile ?? cfg.endpoint}, not this sandbox's network (${expected}). To run it here:  pca create ${name} --network ${expected}`);
      else note(`run it:  pca run ${name}`);
    }
    break;
  }
  case "scenario": {
    const [sub, file] = rest;
    if (sub !== "run" || !file) fail("usage: pcs scenario run <file> [--network paseo]");
    if (!fs.existsSync(file)) fail(`no scenario file ${file}`);
    const network = String(flags.network ?? DEFAULT_NETWORK);
    if (!NETWORK_IDS.includes(network)) fail(`--network must be one of ${NETWORK_IDS.join(", ")}`);
    // Its own daemon, its own bots dir; nothing touches the daemon at --url.
    if (!json) step(`Running ${file} on a fresh sandbox (${network})…`);
    try {
      const { ms } = await runScenario(file, { log: json ? () => {} : note, network });
      if (json) out({ file, ok: true, ms });
      else ok(`${file} passed in ${(ms / 1000).toFixed(1)}s`);
    } catch (e) {
      if (json) { out({ file, ok: false, error: e.message }); process.exit(1); }
      fail(`${file} failed: ${e.message}`);
    }
    break;
  }
  case "events": {
    let res;
    try { res = await fetch(`${baseUrl}/api/events`); } catch { fail(`no sandbox at ${baseUrl} — start one with: pcs up`); }
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
