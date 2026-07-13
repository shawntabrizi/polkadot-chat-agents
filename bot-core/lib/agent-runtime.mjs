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
const trimSet = (set, cap) => { while (set.size > cap) set.delete(set.values().next().value); };

// Agent CLIs do not need the bot process's full environment. In particular,
// they must never receive the signing seed, transport configuration, state
// locations, or provider API credentials. Keep inherited variables to the
// small set a normal interactive CLI needs, and make any extra variables an
// explicit (and still non-secret) runtime capability.
const INHERITED_AGENT_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL",
  "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "TERM", "COLORTERM", "NO_COLOR",
  "TMPDIR", "TMP", "TEMP",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_ENV_NAME_RE = /(?:^|_)(?:API_?KEY|ACCESS_?KEY|AUTH(?:ORIZATION)?|TOKEN|SECRET|PASSWORD|CREDENTIALS?|SEED|PRIVATE_?KEY|SESSION|KEY)(?:$|_)/i;

const isForbiddenAgentEnvName = (name) =>
  !ENV_NAME_RE.test(name) || /^(?:BOT_|FAUCET_)/i.test(name) || SENSITIVE_ENV_NAME_RE.test(name);

// Exported for direct unit coverage and for embedding runtimes that want to
// inspect the capability boundary before constructing one.
export const buildAgentEnvironment = ({ parentEnv = process.env, agentEnv = {}, log = () => {} } = {}) => {
  const env = Object.create(null);
  for (const key of INHERITED_AGENT_ENV) {
    const value = parentEnv?.[key];
    if (typeof value === "string" && value) env[key] = value;
  }
  // PATH is required for tools launched by the CLI. Do not fall back to a
  // caller-provided environment wholesale when it is absent.
  if (!env.PATH) env.PATH = "/usr/local/bin:/usr/bin:/bin";
  for (const [rawKey, rawValue] of Object.entries(agentEnv ?? {})) {
    const key = String(rawKey);
    if (isForbiddenAgentEnvName(key)) {
      log("BOT_AI_ENV_REJECTED", { key });
      continue;
    }
    if (rawValue == null) continue;
    env[key] = String(rawValue);
  }
  return env;
};

const boundedInt = (value, fallback, minimum = 0) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= minimum ? n : fallback;
};

const isRootOwnedDirectory = (stat) =>
  typeof stat?.isDirectory === "function" && stat.isDirectory() && stat.uid === 0;

// A privileged staging parent may be shared, but it must have the sticky bit
// so an unprivileged agent cannot rename or remove root-owned child entries.
// It must also be searchable by the dropped agent identity.
export const isSafePrivilegedStagingParent = (stat) =>
  isRootOwnedDirectory(stat)
  && (stat.mode & 0o1000) !== 0
  && (stat.mode & 0o001) !== 0;

// The root-owned staging directory itself must never be writable by the agent.
export const isSafePrivateStagingRoot = (stat) =>
  isRootOwnedDirectory(stat)
  && (stat.mode & 0o700) === 0o700
  && (stat.mode & 0o022) === 0;

const isRootOwnedNonWritableDirectory = (stat) =>
  isRootOwnedDirectory(stat) && (stat.mode & 0o022) === 0;

// `/tmp` is normally a directory on Linux but a root-owned alias on some
// POSIX hosts. Resolve that alias only after checking both ends and every
// resolved ancestor: otherwise an agent-writable ancestor could replace the
// apparently safe sticky directory between validation and mkdtemp().
const verifiedPrivilegedStagingParent = () => {
  const tmpEntry = fs.lstatSync("/tmp");
  if (tmpEntry.uid !== 0) throw new Error("/tmp entry is not root-owned");

  const resolved = fs.realpathSync.native("/tmp");
  const resolvedParent = fs.statSync(resolved);
  if (!isSafePrivilegedStagingParent(resolvedParent)) {
    throw new Error("/tmp must resolve to a root-owned sticky, searchable directory");
  }

  const root = path.parse(resolved).root;
  if (!isRootOwnedNonWritableDirectory(fs.lstatSync(root))) {
    throw new Error("filesystem root for /tmp is not root-owned and protected");
  }
  let current = root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!isRootOwnedNonWritableDirectory(fs.lstatSync(current))) {
      throw new Error(`/tmp ancestor is not root-owned and protected: ${current}`);
    }
  }
  return resolved;
};

export const createAgentRuntime = ({
  engine,        // runner config from lib/runners.mjs (parseEvent, stripApiKeyEnv, effortLevels)
  engineName,    // "claude" | "codex" | "opencode" | "custom" — resume tokens are scoped to it
  engineCommand, // binary to spawn
  buildArgs,     // ({ prompt, model, resume, effort }) -> argv
  workspace,     // shared default cwd; resume tokens captured here are scoped to it
  workspaces = null, // project registry (lib/workspaces.mjs) or null
  model = "",
  allowedModels = null,
  reasoning = "",
  // Kept for callers using the old API. Provider keys never cross this
  // process boundary, including when API billing was previously requested.
  apiBilling: _apiBilling = false,
  idleMs = 600_000,
  maxMs = 0,
  peerCap = 500, // bound the per-peer maps (idle peers age out)
  maxConcurrentTurns = 4,
  maxQueuedTurns = 100,
  maxOutputBytes = 1_000_000,
  maxEventLineBytes = 64 * 1024,
  // Optional POSIX identity for spawned agent CLIs. Container deployments run
  // the transport as root solely to protect signing state, then drop agents to
  // an unprivileged workspace owner before executing any model-directed tool.
  agentUid = null,
  agentGid = null,
  agentEnv = {}, // explicit non-secret variables for a custom agent CLI
  parentEnv = process.env,
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
  const introducedPeers = new Set();     // peers whose first reply carried the /help hint
  const childEnv = buildAgentEnvironment({ parentEnv, agentEnv, log });
  const turnLimit = boundedInt(maxConcurrentTurns, 4, 1);
  const queuedTurnLimit = boundedInt(maxQueuedTurns, 100, 0);
  const outputLimit = boundedInt(maxOutputBytes, 1_000_000, 1024);
  const eventLineLimit = Math.min(boundedInt(maxEventLineBytes, 64 * 1024, 1024), outputLimit);
  const childUid = agentUid == null ? null : boundedInt(agentUid, -1, 0);
  const childGid = agentGid == null ? null : boundedInt(agentGid, -1, 0);
  if (childUid === -1 || childGid === -1) throw new Error("agentUid and agentGid must be non-negative integer IDs");
  const queuedTurns = [];
  const queuedTurnsByPeer = new Map();
  const activeTurnsByPeer = new Map();
  const activeTurnPromises = new Set();
  let activeTurnCount = 0;
  let shuttingDown = false;
  // The root transport must never create/chown files below an agent-writable
  // workspace. A root-owned, traversal-only parent lets the child reach the
  // per-turn directory after it is handed off without being able to rename it
  // during privileged copies. Local same-UID runs have no such boundary.
  const needsPrivilegedStaging = childUid != null
    && childUid !== 0
    && typeof process.getuid === "function"
    && process.getuid() === 0;
  let privateStagingRoot = null;
  if (needsPrivilegedStaging) {
    try {
      // Do not inherit TMPDIR here: a root-only custom temp parent would make
      // the handed-off child directory unreachable to the agent. Verify the
      // fixed system parent instead of trusting a deployment's /tmp mount.
      const stagingParent = verifiedPrivilegedStagingParent();
      const candidate = fs.mkdtempSync(path.join(stagingParent, "pca-agent-stage-"));
      try {
        fs.chmodSync(candidate, 0o711);
        if (!isSafePrivateStagingRoot(fs.lstatSync(candidate))) {
          throw new Error("private staging root is not root-owned and protected");
        }
        privateStagingRoot = candidate;
      } catch (error) {
        try { fs.rmSync(candidate, { recursive: true, force: true, maxRetries: 2 }); } catch { /* best effort */ }
        throw error;
      }
    } catch (error) {
      log("BOT_ATTACHMENT_STAGING_ROOT_FAILED", { error: String(error?.message ?? error) });
    }
  }

  const cleanupPrivateStagingRoot = () => {
    if (!privateStagingRoot) return;
    try { fs.rmSync(privateStagingRoot, { recursive: true, force: true, maxRetries: 2 }); }
    catch (error) { log("BOT_ATTACHMENT_STAGING_ROOT_CLEANUP_FAILED", { error: String(error?.message ?? error) }); }
    privateStagingRoot = null;
  };

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

  const addQueuedTurn = (job) => {
    queuedTurns.push(job);
    const jobs = queuedTurnsByPeer.get(job.peerKey) ?? new Set();
    jobs.add(job);
    queuedTurnsByPeer.set(job.peerKey, jobs);
  };
  const removeQueuedTurn = (job) => {
    const jobs = queuedTurnsByPeer.get(job.peerKey);
    jobs?.delete(job);
    if (jobs?.size === 0) queuedTurnsByPeer.delete(job.peerKey);
  };
  const addActiveTurn = (job) => {
    const jobs = activeTurnsByPeer.get(job.peerKey) ?? new Set();
    jobs.add(job);
    activeTurnsByPeer.set(job.peerKey, jobs);
  };
  const removeActiveTurn = (job) => {
    const jobs = activeTurnsByPeer.get(job.peerKey);
    jobs?.delete(job);
    if (jobs?.size === 0) activeTurnsByPeer.delete(job.peerKey);
  };

  // A bot has one runtime, so this is the global execution budget across all
  // peers. Per-peer ordering remains the transport's responsibility; this
  // queue only prevents a public bot from turning every peer into a process.
  const drainTurnQueue = () => {
    while (!shuttingDown && activeTurnCount < turnLimit && queuedTurns.length) {
      const job = queuedTurns.shift();
      removeQueuedTurn(job);
      if (job.cancelled) { job.resolve({ stopped: true }); continue; }
      activeTurnCount += 1;
      addActiveTurn(job);
      const execution = Promise.resolve()
        .then(() => job.cancelled ? { stopped: true } : job.run(job))
        .catch((error) => {
          log("BOT_AI_TURN_FAILED", { to: job.peerHex, error: String(error?.message ?? error) });
          return null;
        })
        .then((result) => job.resolve(result))
        .finally(() => {
          activeTurnCount -= 1;
          removeActiveTurn(job);
          activeTurnPromises.delete(execution);
          drainTurnQueue();
        });
      activeTurnPromises.add(execution);
    }
  };

  const queueEngineTurn = (peerHex, run) => {
    if (shuttingDown) return Promise.resolve({ stopped: true });
    const peerKey = norm(peerHex);
    if (activeTurnCount >= turnLimit && queuedTurns.length >= queuedTurnLimit) {
      log("BOT_AI_QUEUE_FULL", { to: peerHex, active: activeTurnCount, queued: queuedTurns.length, cap: queuedTurnLimit });
      return Promise.resolve({ busy: true });
    }
    return new Promise((resolve) => {
      addQueuedTurn({ peerHex, peerKey, run, resolve, cancelled: false, child: null });
      drainTurnQueue();
    });
  };

  const cancelQueuedTurns = (peerKey) => {
    const jobs = [...(queuedTurnsByPeer.get(peerKey) ?? [])];
    for (const job of jobs) {
      job.cancelled = true;
      const index = queuedTurns.indexOf(job);
      if (index >= 0) queuedTurns.splice(index, 1);
      removeQueuedTurn(job);
      job.resolve({ stopped: true });
    }
    return jobs.length;
  };

  // Run one agent turn. Streams the engine's JSONL: tool actions feed live-
  // reply progress frames, the session id is captured for --resume, the
  // answer is accumulated. No wall-clock limit — an idle-silence backstop
  // kills a wedged process (and unblocks the peer queue). Returns { answer },
  // { stopped: true } (user /stop), or null on failure.
  const runEngine = (peerHex, userText, onAction = null, cwd = workspace, job = null) => new Promise((resolve) => {
    const k = norm(peerHex);
    if (job?.cancelled) { resolve({ stopped: true }); return; }
    let child;
    try {
      const turnModel = peerModelOverrides.get(k) ?? model;
      const resume = peerResume.get(k) ?? null;
      const effort = peerEffortOverrides.get(k) ?? reasoning ?? "";
      const argv = buildArgs({ prompt: userText, model: turnModel, resume, effort: effort || null });
      // Detached: a new process group, so killProcessGroup reaps the CLI's children.
      // stdin ignored: some CLIs (codex) otherwise block on "Reading additional input".
      const options = { stdio: ["ignore", "pipe", "pipe"], cwd, env: childEnv, detached: true };
      if (childUid != null) options.uid = childUid;
      if (childGid != null) options.gid = childGid;
      child = spawn(engineCommand, argv, options);
    } catch (e) {
      log("BOT_AI_SPAWN_FAILED", { to: peerHex, error: String(e?.message ?? e) });
      resolve(job?.cancelled ? { stopped: true } : null);
      return;
    }
    // Detached: a new process group, so killProcessGroup reaps the CLI's children.
    runningChildren.set(k, child);
    if (job) job.child = child;
    let err = "", lineBuf = "", answer = "", resultText = null, errored = null, gotSession = false, settled = false, usage = null;
    let outputBytes = 0, outputExceeded = false, discardingLine = false;
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
      if (job?.child === child) job.child = null;
      resolve(value);
    };
    bumpIdle();
    const noteOutput = (bytes) => {
      outputBytes += bytes;
      if (outputBytes > outputLimit && !outputExceeded) {
        outputExceeded = true;
        log("BOT_AI_OUTPUT_LIMIT", { to: peerHex, bytes: outputBytes, cap: outputLimit });
        killProcessGroup(child);
      }
    };
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
    child.stdout.on("data", (d) => {
      bumpIdle();
      noteOutput(d.length);
      if (outputExceeded) return;
      let text = d.toString();
      if (discardingLine) {
        const nl = text.indexOf("\n");
        if (nl < 0) return;
        discardingLine = false;
        text = text.slice(nl + 1);
      }
      lineBuf += text;
      let nl;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        if (Buffer.byteLength(line) > eventLineLimit) {
          log("BOT_AI_EVENT_LINE_LIMIT", { to: peerHex, cap: eventLineLimit });
          continue;
        }
        onLine(line);
      }
      if (Buffer.byteLength(lineBuf) > eventLineLimit) {
        lineBuf = "";
        discardingLine = true;
        log("BOT_AI_EVENT_LINE_LIMIT", { to: peerHex, cap: eventLineLimit });
      }
    });
    child.stderr.on("data", (d) => {
      bumpIdle();
      noteOutput(d.length);
      if (err.length < 16_384) err += d.toString().slice(0, 16_384 - err.length);
    });
    child.on("error", (e) => { log("BOT_AI_SPAWN_FAILED", { to: peerHex, error: String(e?.message ?? e) }); finish(job?.cancelled ? { stopped: true } : null); });
    child.on("close", (code) => {
      if (lineBuf && !discardingLine && !outputExceeded) onLine(lineBuf);
      if (job?.cancelled) return finish({ stopped: true });
      if (outputExceeded) return finish(null);
      const finalAnswer = (resultText ?? answer).trim();
      if (errored) { log("BOT_AI_FAILED", { to: peerHex, error: String(errored).slice(-300) }); return finish(null); }
      if (code === 0 || finalAnswer) { recordUsage(peerHex, usage); return finish({ answer: finalAnswer }); }
      // Classify the failure so the operator knows the remedy (re-auth vs. retry).
      const authRevoked = /401|unauthorized|refresh token|could not be refreshed|log ?out and sign in/i.test(err);
      log(authRevoked ? "BOT_AI_AUTH_REVOKED" : "BOT_AI_FAILED", { to: peerHex, code, stderr: err.trim().slice(-500) });
      finish(null);
    });
  });

  // Stage media only when a worker actually starts a turn. Doing it before the
  // global queue would let queued requests duplicate the bounded media cache
  // into the workspace. The per-turn directory is private and always removed
  // after the CLI exits, including failures and /stop.
  const stageAttachmentsForTurn = (turnCwd, attachments) => {
    let stageDir = null;
    const originalPaths = [];
    const ensureDir = () => {
      if (stageDir) return stageDir;
      if (needsPrivilegedStaging && !privateStagingRoot) {
        throw new Error("private attachment staging is unavailable");
      }
      // Keep root ownership until every source copy and metadata chmod/chown
      // has completed. Handing ownership over early would let the agent race a
      // predictable destination name with a symlink.
      stageDir = fs.mkdtempSync(path.join(privateStagingRoot ?? turnCwd, ".pca-attachment-"));
      fs.chmodSync(stageDir, 0o700);
      return stageDir;
    };
    for (const [index, attachment] of (attachments ?? []).entries()) {
      if (!attachment.downloaded || !attachment.path) continue;
      try {
        const dir = ensureDir();
        const dest = path.join(dir, `${index}-${path.basename(attachment.path)}`);
        fs.copyFileSync(attachment.path, dest);
        fs.chmodSync(dest, 0o600);
        if (childUid != null) fs.chownSync(dest, childUid, childGid ?? childUid);
        originalPaths.push([attachment, attachment.path]);
        attachment.path = dest;
      } catch (error) {
        log("BOT_ATTACHMENT_STAGE_FAILED", { id: String(attachment.id ?? "").slice(0, 16), error: String(error?.message ?? error) });
      }
    }
    // With a privileged transport, only expose the complete directory after
    // all root-owned file operations have finished.
    if (stageDir && childUid != null) {
      try { fs.chownSync(stageDir, childUid, childGid ?? childUid); }
      catch (error) { log("BOT_ATTACHMENT_STAGE_FAILED", { error: String(error?.message ?? error) }); }
    }
    return () => {
      for (const [attachment, source] of originalPaths) attachment.path = source;
      if (!stageDir) return;
      try { fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 2 }); }
      catch (error) { log("BOT_ATTACHMENT_CLEANUP_FAILED", { error: String(error?.message ?? error) }); }
    };
  };

  // In-chat commands: state operations run where the state lives (here). The
  // bridge never sees these — a harness owns its own command system.
  const handleCommandFor = createCommandHandler({
    clearResume: (peerKey) => { if (peerResume.delete(peerKey)) persist(); },
    peerModelOverrides,
    defaultModel: model,
    allowedModels,
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
        return true;
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
        return true;
      }
      const onAction = chat.beginTurn(peerHex); // arms the "thinking" placeholder
      const result = await queueEngineTurn(peerHex, async (job) => {
        const cleanupAttachments = stageAttachmentsForTurn(turnCwd, msg.attachments);
        try {
          // Verbatim prompt — the engine keeps its own session; the transport's
          // renderer only adds attachment/reply/edit context, not a persona.
          return await runEngine(peerHex, renderMessage(msg), onAction, turnCwd, job);
        } finally {
          cleanupAttachments();
        }
      });
      // A user /stop is a completed action, but a process-wide shutdown must
      // leave the durable owed record for the next process to resume.
      if (result?.stopped) return !shuttingDown;
      if (result?.busy) {
        await chat.deliver(peerHex, "I'm busy with other requests right now. Please try again in a moment.").catch(() => {});
        return true;
      }
      if (!result) {
        if (shuttingDown) return false;
        // Don't leave the user hanging after the "thinking" placeholder.
        await chat.deliver(peerHex, "Sorry — I couldn't reach my agent just now. Please try again in a moment.").catch(() => {});
        return true;
      }
      // Discovery: the very first reply to a peer carries a one-time /help
      // hint (persisted, so a restart doesn't repeat it).
      let outgoing = result.answer || "(no output)";
      if (!introducedPeers.has(k)) {
        introducedPeers.add(k);
        trimSet(introducedPeers, peerCap);
        persist();
        outgoing += "\n\n(Tip: send /help to see my commands.)";
      }
      await chat.deliver(peerHex, outgoing).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
      return true;
    },

    // /stop lever: cancel a peer's queued or in-flight turn. The transport
    // intercepts /stop BEFORE its per-peer work queue, so it can also cancel
    // a turn waiting for the global execution budget.
    stop(peerHex) {
      const k = norm(peerHex);
      let stopped = cancelQueuedTurns(k) > 0;
      for (const job of activeTurnsByPeer.get(k) ?? []) {
        job.cancelled = true;
        if (job.child) killProcessGroup(job.child);
        stopped = true;
      }
      // A child can exist for the tiny interval before its scheduler job is
      // registered, or after a runner error has started cleanup.
      const child = runningChildren.get(k);
      if (child) { killProcessGroup(child); stopped = true; }
      return stopped;
    },

    // The owner calls this during process shutdown. It rejects queued work,
    // marks active jobs stopped, and tears down every detached process group.
    // Returning a promise lets graceful shutdown wait for close events without
    // forcing callers that are exiting immediately to await it.
    shutdown() {
      if (!shuttingDown) {
        shuttingDown = true;
        for (const peerKey of [...queuedTurnsByPeer.keys()]) cancelQueuedTurns(peerKey);
        for (const jobs of activeTurnsByPeer.values()) {
          for (const job of jobs) {
            job.cancelled = true;
            if (job.child) killProcessGroup(job.child);
          }
        }
        for (const child of runningChildren.values()) killProcessGroup(child);
        log("BOT_AI_SHUTDOWN", { active: activeTurnCount });
      }
      return Promise.allSettled([...activeTurnPromises]).finally(cleanupPrivateStagingRoot);
    },

    queueStats: () => ({ active: activeTurnCount, queued: queuedTurns.length, activeCap: turnLimit, queuedCap: queuedTurnLimit }),

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
      if (proj) { peerProjects.set(peerKey, proj); trimMap(peerProjects, peerCap); }
      else if (pj) log("BOT_PROJECT_DROPPED", { peer: peerKey, alias: pj, reason: "no longer registered" });
      if (rs && this._engineMatches && (pj ? proj != null : this._workspaceMatches)) {
        peerResume.set(peerKey, rs);
        trimMap(peerResume, peerCap);
      }
    },
    introducedList: () => [...introducedPeers],
    restoreIntroduced(list) {
      for (const id of list ?? []) if (typeof id === "string") introducedPeers.add(id);
      trimSet(introducedPeers, peerCap);
    },
  };
};
