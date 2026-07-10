// The direct-engine brain: everything between a normalized inbound message
// and a delivered answer when bot-core itself hosts the coding agent
// (claude/codex/opencode as a child CLI per turn). Owns all per-peer agent
// state — resume tokens, model/effort overrides, active project, usage tally,
// the one-time /help intro — plus the spawn/stream/idle-backstop loop and the
// in-chat command handler.
//
// Deliberately transport-blind: answers leave through the injected `chat`
// surface, state reaches disk through `persist()`, and the engine table
// (lib/runners.mjs) supplies argv + event normalization. This is the
// in-process equivalent of the seam the HTTP bridge provides for
// out-of-process brains (hermes/openclaw).
//
// chat surface:
//   sendText(peerHex, text)  — plain message (command replies, errors)
//   deliver(peerHex, text)   — final answer (chunking + live-placeholder
//                              finalize live transport-side)
//   beginTurn(peerHex)       — a turn is starting: arm the "thinking"
//                              placeholder; returns an onAction(title)
//                              progress callback or null

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCommandHandler } from "./commands.mjs";

const norm = (hex) => String(hex).trim().replace(/^0x/i, "").toLowerCase();
const trimMap = (map, cap) => { while (map.size > cap) map.delete(map.keys().next().value); };

export const createAgentRuntime = ({
  engine,        // runner config from lib/runners.mjs (parseEvent, stripApiKeyEnv, effortLevels)
  engineName,    // "claude" | "codex" | "opencode" | "custom" — resume tokens are scoped to it
  engineCommand, // binary to spawn
  buildArgs,     // ({ prompt, model, resume, effort }) -> argv
  workspace,     // shared default cwd; resume tokens captured here are scoped to it
  workspaces = null, // project registry (lib/workspaces.mjs) or null
  model = "",
  reasoning = "",
  apiBilling = false,
  idleMs = 600_000,
  maxMs = 0,
  peerCap = 500, // bound the per-peer maps (idle peers age out)
  renderMessage, // (msg) -> verbatim prompt text (transport owns message shape)
  chat,
  username = "",
  chainConnected = () => true,
  log = () => {},
  persist = () => {},
}) => {
  const peerResume = new Map();          // peerKey -> engine session id (native --resume)
  const peerModelOverrides = new Map();  // peerKey -> model chosen via /model
  const peerEffortOverrides = new Map(); // peerKey -> reasoning effort chosen via /reasoning
  const peerProjects = new Map();        // peerKey -> { alias, branch|null } chosen via /project
  const peerUsage = new Map();           // peerKey -> cumulative { turns, inputTokens, outputTokens, costUsd }
  const runningChildren = new Map();     // peerKey -> live child process (for /stop + idle kill)
  const stopRequested = new Set();       // peers whose turn /stop is cancelling
  const introducedPeers = new Set();     // peers whose first reply carried the /help hint

  // Token/cost usage: the engines already report it per turn — log it and keep
  // an in-memory per-peer tally for /usage (observability, not billing; resets
  // on restart).
  const recordUsage = (peerHex, usage) => {
    if (!usage) return;
    const k = norm(peerHex);
    const t = peerUsage.get(k) ?? { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    t.turns += 1;
    t.inputTokens += usage.inputTokens ?? 0;
    t.outputTokens += usage.outputTokens ?? 0;
    t.costUsd += usage.costUsd ?? 0;
    peerUsage.set(k, t);
    trimMap(peerUsage, peerCap);
    log("BOT_AI_USAGE", { to: peerHex, ...usage });
  };

  // A resume token is scoped to the cwd it was captured in, so a project
  // switch always starts a fresh engine session.
  const setPeerProject = (peerKey, value) => {
    if (value) { peerProjects.set(peerKey, value); trimMap(peerProjects, peerCap); }
    else peerProjects.delete(peerKey);
    peerResume.delete(peerKey);
    persist();
  };
  // The turn's cwd: the peer's project (root or branch worktree) or the shared
  // workspace. Throws a user-presentable error (unknown project, worktree
  // failure) — handleMessage answers with it instead of running the engine.
  const resolveTurnCwd = async (peerKey) => {
    const proj = peerProjects.get(peerKey);
    return proj ? workspaces.resolveCwd(proj) : workspace;
  };

  // Kill a child's whole process group (SIGTERM, then SIGKILL after a grace
  // period) so agent-spawned subprocesses (bash, builds) are reaped too.
  const killProcessGroup = (child) => {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
    setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } }, 2000).unref?.();
  };

  // Run one agent turn. Streams the engine's JSONL: tool actions feed live-
  // reply progress frames, the session id is captured for --resume, the
  // answer is accumulated. No wall-clock limit — an idle-silence backstop
  // kills a wedged process (and unblocks the peer queue). Returns { answer },
  // { stopped: true } (user /stop), or null on failure.
  const runEngine = (peerHex, userText, onAction = null, cwd = workspace) => new Promise((resolve) => {
    const k = norm(peerHex);
    const turnModel = peerModelOverrides.get(k) ?? model;
    const resume = peerResume.get(k) ?? null;
    const effort = peerEffortOverrides.get(k) ?? reasoning ?? "";
    const argv = buildArgs({ prompt: userText, model: turnModel, resume, effort: effort || null });
    const childEnv = { ...process.env };
    if (engine.stripApiKeyEnv && !apiBilling) delete childEnv.ANTHROPIC_API_KEY;
    // Detached: a new process group, so killProcessGroup reaps the CLI's children.
    // stdin ignored: some CLIs (codex) otherwise block on "Reading additional input".
    const child = spawn(engineCommand, argv, { stdio: ["ignore", "pipe", "pipe"], cwd, env: childEnv, detached: true });
    runningChildren.set(k, child);
    let err = "", lineBuf = "", answer = "", resultText = null, errored = null, gotSession = false, settled = false, usage = null;
    let idle;
    const bumpIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { log("BOT_AI_IDLE_TIMEOUT", { to: peerHex, idleMs }); killProcessGroup(child); }, idleMs);
      idle.unref?.();
    };
    const hardCap = maxMs > 0 ? setTimeout(() => { log("BOT_AI_MAX_TIMEOUT", { to: peerHex, maxMs }); killProcessGroup(child); }, maxMs) : null;
    hardCap?.unref?.();
    const finish = (value) => {
      if (settled) return; settled = true;
      clearTimeout(idle); if (hardCap) clearTimeout(hardCap);
      if (runningChildren.get(k) === child) runningChildren.delete(k);
      resolve(value);
    };
    bumpIdle();
    const onLine = (line) => {
      if (!line.trim()) return;
      let obj; try { obj = JSON.parse(line); } catch { return; }
      for (const ev of engine.parseEvent(obj)) {
        if (ev.kind === "started") {
          if (ev.sessionId && !gotSession) { gotSession = true; peerResume.set(k, ev.sessionId); trimMap(peerResume, peerCap); persist(); }
        } else if (ev.kind === "action") onAction?.(ev.title);
        else if (ev.kind === "text") answer += ev.text;
        else if (ev.kind === "result") { resultText = ev.text || null; if (ev.usage) usage = ev.usage; }
        else if (ev.kind === "error") errored = ev.message;
      }
    };
    child.stdout.on("data", (d) => { bumpIdle(); lineBuf += d; let nl; while ((nl = lineBuf.indexOf("\n")) >= 0) { onLine(lineBuf.slice(0, nl)); lineBuf = lineBuf.slice(nl + 1); } });
    child.stderr.on("data", (d) => { err += d; bumpIdle(); });
    child.on("error", (e) => { log("BOT_AI_SPAWN_FAILED", { error: String(e?.message ?? e) }); finish(null); });
    child.on("close", (code) => {
      if (lineBuf) onLine(lineBuf);
      if (stopRequested.delete(k)) return finish({ stopped: true });
      const finalAnswer = (resultText ?? answer).trim();
      if (errored) { log("BOT_AI_FAILED", { to: peerHex, error: String(errored).slice(-300) }); return finish(null); }
      if (code === 0 || finalAnswer) { recordUsage(peerHex, usage); return finish({ answer: finalAnswer }); }
      // Classify the failure so the operator knows the remedy (re-auth vs. retry).
      const authRevoked = /401|unauthorized|refresh token|could not be refreshed|log ?out and sign in/i.test(err);
      log(authRevoked ? "BOT_AI_AUTH_REVOKED" : "BOT_AI_FAILED", { to: peerHex, code, stderr: err.trim().slice(-500) });
      finish(null);
    });
  });

  // In-chat commands: state operations run where the state lives (here). The
  // bridge never sees these — a harness owns its own command system.
  const handleCommandFor = createCommandHandler({
    clearResume: (peerKey) => { if (peerResume.delete(peerKey)) persist(); },
    peerModelOverrides,
    defaultModel: model,
    username,
    chainConnected,
    trimOverrides: () => { trimMap(peerModelOverrides, peerCap); trimMap(peerEffortOverrides, peerCap); },
    workspaces,
    getPeerProject: (peerKey) => peerProjects.get(peerKey) ?? null,
    setPeerProject,
    effortLevels: engine?.effortLevels ?? null,
    defaultEffort: reasoning,
    peerEffortOverrides,
    getUsage: (peerKey) => peerUsage.get(peerKey) ?? null,
  });

  return {
    // One inbound chat message -> command reply or full engine turn. The
    // caller has already fetched attachments; `msg` is the normalized shape
    // ({ text, messageId, kind, attachments?, replyTo?, editOf? }).
    async handleMessage(peerHex, msg) {
      const k = norm(peerHex);
      const commandReply = handleCommandFor(k, msg.text);
      if (commandReply) {
        log("BOT_COMMAND", { from: peerHex, command: msg.text.split(/\s/)[0] });
        await chat.sendText(peerHex, commandReply).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
        return;
      }
      // The turn's cwd: shared workspace or the peer's chosen project/
      // worktree. Worktree prep can fail (not a repo, bad branch) — answer
      // with the error instead of running the engine somewhere the user
      // didn't pick.
      let turnCwd;
      try { turnCwd = await resolveTurnCwd(k); }
      catch (e) {
        const proj = peerProjects.get(k);
        log("BOT_PROJECT_CWD_FAILED", { to: peerHex, project: proj?.alias, branch: proj?.branch ?? null, error: String(e?.message ?? e) });
        await chat.sendText(peerHex, `⚠️ I couldn't open ${proj ? `${proj.alias}${proj.branch ? `@${proj.branch}` : ""}` : "the workspace"}: ${String(e?.message ?? e)}. /project default switches back to the shared workspace.`).catch(() => {});
        return;
      }
      // Stage downloaded attachments into the workspace (.attachments/) so
      // the agent acts on a file inside its own cwd — media-store blobs live
      // outside it. Failure falls back to the media-store path in the prompt.
      for (const a of msg.attachments ?? []) {
        if (!a.downloaded) continue;
        try {
          const stageDir = path.join(turnCwd, ".attachments");
          fs.mkdirSync(stageDir, { recursive: true });
          const dest = path.join(stageDir, path.basename(a.path));
          fs.copyFileSync(a.path, dest);
          a.path = dest;
        } catch (e) { log("BOT_ATTACHMENT_STAGE_FAILED", { id: a.id.slice(0, 16), error: String(e?.message ?? e) }); }
      }
      // Verbatim prompt — the engine keeps its own session; the transport's
      // renderer only adds the attachment/reply/edit CONTEXT the message
      // carries (real content, not a persona wrapper).
      const userText = renderMessage(msg);
      const onAction = chat.beginTurn(peerHex); // arms the "thinking" placeholder
      const result = await runEngine(peerHex, userText, onAction, turnCwd); // logs its own classified failure reason
      if (result?.stopped) return; // /stop already finalized the placeholder
      if (!result) {
        // Don't leave the user hanging after the "thinking" placeholder.
        await chat.deliver(peerHex, "Sorry — I couldn't reach my agent just now. Please try again in a moment.").catch(() => {});
        return;
      }
      // Discovery: the very first reply to a peer carries a one-time /help
      // hint (persisted, so a restart doesn't repeat it).
      let outgoing = result.answer || "(no output)";
      if (!introducedPeers.has(k)) {
        introducedPeers.add(k);
        persist();
        outgoing += "\n\n(Tip: send /help to see my commands.)";
      }
      await chat.deliver(peerHex, outgoing).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    },

    // /stop lever: cancel a peer's in-flight turn. Returns true if one was
    // running. The transport intercepts /stop BEFORE the per-peer work queue
    // (a queued stop would sit behind the very turn it cancels).
    stop(peerHex) {
      const k = norm(peerHex);
      const child = runningChildren.get(k);
      if (!child) return false;
      stopRequested.add(k);
      killProcessGroup(child);
      return true;
    },

    // ---- persistence (the transport owns the snapshot file; the runtime
    // owns what its fields mean) ----
    // Which engine + workspace the resume tokens belong to: a change to
    // either invalidates them (resuming against the wrong cwd/CLI corrupts).
    snapshotAgent: () => ({ engine: engineName, workspace }),
    peerSnapshot(peerKey) {
      const proj = peerProjects.get(peerKey);
      return {
        ...(peerResume.has(peerKey) ? { rs: peerResume.get(peerKey) } : {}),
        // Active project/branch — the resume token above is only valid in
        // this cwd, so both restore together or not at all.
        ...(proj ? { pj: proj.alias, ...(proj.branch ? { br: proj.branch } : {}) } : {}),
      };
    },
    // Call once with the persisted agent meta before restorePeer calls.
    // An engine change invalidates every token; a workspace change
    // invalidates tokens of peers in the shared workspace — a project peer's
    // cwd is the project itself, validated per peer in restorePeer.
    noteRestoredAgent(agentMeta) {
      this._engineMatches = Boolean(agentMeta) && agentMeta.engine === engineName;
      this._workspaceMatches = this._engineMatches && agentMeta.workspace === workspace;
      if (agentMeta && !this._workspaceMatches) log("BOT_RESUME_INVALIDATED", { was: agentMeta, now: { engine: engineName, workspace } });
    },
    restorePeer(peerKey, { rs, pj, br } = {}) {
      const proj = pj && workspaces?.has(pj) ? { alias: pj, branch: br ?? null } : null;
      if (proj) peerProjects.set(peerKey, proj);
      else if (pj) log("BOT_PROJECT_DROPPED", { peer: peerKey, alias: pj, reason: "no longer registered" });
      if (rs && this._engineMatches && (pj ? proj != null : this._workspaceMatches)) peerResume.set(peerKey, rs);
    },
    introducedList: () => [...introducedPeers],
    restoreIntroduced(list) { for (const id of list ?? []) introducedPeers.add(id); },
  };
};
