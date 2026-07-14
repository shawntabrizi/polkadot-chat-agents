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
//   sendText(peerHex, text, context?)  — plain message (command replies, errors)
//   deliver(peerHex, text, context?)   — final answer (chunking + live-placeholder
//                              finalize live transport-side)
//   deliverArtifacts(peerHex, artifacts, context?) — optional final-turn files. Each
//                              artifact is { filePath, filename, size }; the
//                              callback consumes a transport-owned immutable
//                              snapshot before this runtime removes it.
//   deliverTurn(peerHex, { text, artifacts }, context?) — optional atomic final-turn
//                              handoff for a transport with a durable outbox.
//                              When supplied it replaces the separate
//                              deliverArtifacts + deliver calls below.
//   beginTurn(peerHex, context?) — a turn is starting: arm the "thinking"
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
const RESERVED_AGENT_ENV_NAMES = new Set(["PCA_OUTPUT_DIR"]);

const isForbiddenAgentEnvName = (name) =>
  !ENV_NAME_RE.test(name)
  || RESERVED_AGENT_ENV_NAMES.has(name)
  || /^(?:BOT_|FAUCET_)/i.test(name)
  || SENSITIVE_ENV_NAME_RE.test(name);

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
  engine,        // runner config from lib/runners.mjs (parseEvent, effortLevels)
  engineName,    // "claude" | "codex" | "opencode" | "custom" — resume tokens are scoped to it
  engineCommand, // binary to spawn
  buildArgs,     // ({ prompt, model, resume, effort }) -> argv
  workspace,     // shared default cwd; resume tokens captured here are scoped to it
  workspaces = null, // project registry (lib/workspaces.mjs) or null
  model = "",
  allowedModels = null,
  reasoning = "",
  idleMs = 600_000,
  maxMs = 0,
  peerCap = 500, // bound the per-peer maps (idle peers age out)
  maxConcurrentTurns = 4,
  maxQueuedTurns = 100,
  maxOutputBytes = 1_000_000,
  maxEventLineBytes = 64 * 1024,
  // A direct agent can return a bounded set of files by writing top-level
  // regular files into PCA_OUTPUT_DIR. This remains disabled unless the
  // transport supplies chat.deliverArtifacts() or chat.deliverTurn().
  maxOutputArtifacts = 8,
  // Per-file cap for agent-created artifacts. The caller should set this to
  // the transport's attachment cap; keeping it here avoids retrying an agent
  // turn forever because an output cannot possibly be delivered.
  maxOutputArtifactBytes = 25 * 1024 * 1024,
  // Cumulative cap for one turn's generated files. The default keeps staging
  // use bounded independently of the per-file cap and artifact-count cap.
  maxOutputArtifactTotalBytes = 64 * 1024 * 1024,
  // Optional POSIX identity for spawned agent CLIs. Container deployments run
  // the transport as root solely to protect signing state, then drop agents to
  // an unprivileged workspace owner before executing any model-directed tool.
  agentUid = null,
  agentGid = null,
  agentEnv = {}, // explicit non-secret variables for a custom agent CLI
  parentEnv = process.env,
  renderMessage, // (msg) -> verbatim prompt text (transport owns message shape)
  chat,
  // Most transports acknowledge an inbound message before their outgoing
  // statement is durably submitted, so preserving historical best-effort
  // reply behavior is the default. A transport with its own durable ingress
  // journal (T3ams) can opt in and retry the turn when reply delivery fails.
  throwOnReplyFailure = false,
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
  const outputArtifactLimit = Math.min(boundedInt(maxOutputArtifacts, 8, 0), 32);
  const outputArtifactScanLimit = Math.max(32, Math.min(outputArtifactLimit * 8, 256));
  const outputArtifactByteLimit = Math.min(
    boundedInt(maxOutputArtifactBytes, 25 * 1024 * 1024, 1),
    512 * 1024 * 1024,
  );
  const outputArtifactTotalByteLimit = Math.min(
    boundedInt(maxOutputArtifactTotalBytes, 64 * 1024 * 1024, 1),
    512 * 1024 * 1024,
  );
  const supportsArtifactDelivery = (typeof chat?.deliverArtifacts === "function" || typeof chat?.deliverTurn === "function")
    && outputArtifactLimit > 0;
  const childUid = agentUid == null ? null : boundedInt(agentUid, -1, 0);
  const childGid = agentGid == null ? null : boundedInt(agentGid, -1, 0);
  if (childUid === -1 || childGid === -1) throw new Error("agentUid and agentGid must be non-negative integer IDs");
  const queuedTurns = [];
  const queuedTurnsByPeer = new Map();
  const activeTurnsByPeer = new Map();
  const activeTurnPromises = new Set();
  // The engine process may be finished while a transport is still consuming a
  // protected artifact snapshot or publishing the final reply. Keep those
  // handoffs visible to shutdown so it cannot remove private staging midway.
  const activeReplyHandoffs = new Set();
  let activeTurnCount = 0;
  let shuttingDown = false;
  const sendReply = async (method, peerHex, text, deliveryContext = null) => {
    try {
      await chat[method](peerHex, text, deliveryContext);
    } catch (error) {
      log("BOT_REPLY_FAILED", { error: String(error?.message ?? error) });
      if (throwOnReplyFailure) throw error;
    }
  };
  const sendArtifacts = async (peerHex, artifacts, deliveryContext = null) => {
    if (!artifacts.length || !supportsArtifactDelivery) return;
    try {
      await chat.deliverArtifacts(peerHex, artifacts, deliveryContext);
    } catch (error) {
      log("BOT_ARTIFACT_DELIVERY_FAILED", { to: peerHex, count: artifacts.length, error: String(error?.message ?? error) });
      if (throwOnReplyFailure) throw error;
    }
  };
  const sendTurn = async (peerHex, text, artifacts, deliveryContext = null) => {
    if (typeof chat?.deliverTurn === "function") {
      try {
        await chat.deliverTurn(peerHex, { text, artifacts }, deliveryContext);
      } catch (error) {
        log("BOT_TURN_DELIVERY_FAILED", { to: peerHex, artifacts: artifacts.length, error: String(error?.message ?? error) });
        if (throwOnReplyFailure) throw error;
      }
      return;
    }
    await sendArtifacts(peerHex, artifacts, deliveryContext);
    await sendReply("deliver", peerHex, text, deliveryContext);
  };
  const runReplyHandoff = async (operation) => {
    const handoff = Promise.resolve().then(operation);
    activeReplyHandoffs.add(handoff);
    try { return await handoff; }
    finally { activeReplyHandoffs.delete(handoff); }
  };
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

  // An agent output directory follows the same ownership model as inbound
  // attachment staging. In a privilege-dropped deployment, root creates the
  // directory under its protected traversal-only parent, then hands the leaf
  // to the agent. Never fall back to an agent-writable workspace in that case.
  const createTurnOutputDirectory = (turnCwd) => {
    if (!supportsArtifactDelivery) return null;
    if (needsPrivilegedStaging && !privateStagingRoot) {
      throw new Error("private artifact output staging is unavailable");
    }
    let outputDir = null;
    try {
      outputDir = fs.mkdtempSync(path.join(privateStagingRoot ?? turnCwd, ".pca-output-"));
      fs.chmodSync(outputDir, 0o700);
      if (childUid != null) fs.chownSync(outputDir, childUid, childGid ?? childUid);
      return outputDir;
    } catch (error) {
      if (outputDir) {
        try { fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 2 }); } catch { /* best effort */ }
      }
      throw error;
    }
  };

  const cleanupTurnOutputDirectory = (outputDir) => {
    if (!outputDir) return;
    try { fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 2 }); }
    catch (error) { log("BOT_ARTIFACT_OUTPUT_CLEANUP_FAILED", { error: String(error?.message ?? error) }); }
  };

  // The agent-owned output directory is hostile after its CLI exits: a model
  // can leave a background process behind to swap a path or mutate a file.
  // Open sources with O_NOFOLLOW, copy bytes from the stable descriptor into
  // a transport-owned snapshot, and give only that immutable path to a media
  // uploader. In a privilege-dropped deployment `privateStagingRoot` is root
  // owned, so the agent cannot replace or read the snapshot after handoff.
  const outputFilenameIsSafe = (filename) => typeof filename === "string"
    && filename.length > 0
    && filename === filename.trim()
    && filename !== "."
    && filename !== ".."
    && path.basename(filename) === filename
    && Buffer.byteLength(filename, "utf8") <= 255
    && !/[\u0000-\u001f\u007f\\/]/.test(filename);
  const createTurnOutputSnapshotDirectory = (turnCwd) => {
    const parent = privateStagingRoot ?? turnCwd;
    let snapshotDir = null;
    try {
      snapshotDir = fs.mkdtempSync(path.join(parent, ".pca-output-snapshot-"));
      fs.chmodSync(snapshotDir, 0o700);
      return snapshotDir;
    } catch (error) {
      if (snapshotDir) {
        try { fs.rmSync(snapshotDir, { recursive: true, force: true, maxRetries: 2 }); } catch { /* best effort */ }
      }
      throw error;
    }
  };
  const copyOutputArtifactToSnapshot = (sourcePath, snapshotPath, remainingBytes = outputArtifactTotalByteLimit) => {
    const noFollow = fs.constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollow)) throw new Error("O_NOFOLLOW is unavailable");
    let sourceFd = null;
    let snapshotFd = null;
    let copied = false;
    try {
      sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | noFollow);
      const before = fs.fstatSync(sourceFd);
      // Reject hardlinks as well as symlinks. A dropped agent must never turn
      // a link to an arbitrary host file into a transport-upload capability.
      if (!before.isFile() || before.nlink !== 1 || !Number.isSafeInteger(before.size) || before.size < 0
          || (needsPrivilegedStaging && before.uid !== childUid)) return null;
      if (before.size > outputArtifactByteLimit) return { skipped: "too-large", size: before.size };
      if (before.size > remainingBytes) return { skipped: "total-limit", size: before.size };
      snapshotFd = fs.openSync(
        snapshotPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600,
      );
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, before.size)));
      let offset = 0;
      while (offset < before.size) {
        const wanted = Math.min(buffer.length, before.size - offset);
        const read = fs.readSync(sourceFd, buffer, 0, wanted, null);
        if (read <= 0) throw new Error("artifact source ended before its recorded size");
        let written = 0;
        while (written < read) {
          const count = fs.writeSync(snapshotFd, buffer, written, read - written);
          if (count <= 0) throw new Error("artifact snapshot write failed");
          written += count;
        }
        offset += read;
      }
      const after = fs.fstatSync(sourceFd);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
          || after.nlink !== 1 || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error("artifact source changed while it was being snapshotted");
      }
      fs.fsyncSync(snapshotFd);
      copied = true;
      return { size: before.size };
    } finally {
      try { if (sourceFd != null) fs.closeSync(sourceFd); } catch { /* best effort */ }
      try { if (snapshotFd != null) fs.closeSync(snapshotFd); } catch { /* best effort */ }
      if (!copied) {
        try { fs.rmSync(snapshotPath, { force: true, maxRetries: 2 }); } catch { /* best effort */ }
      }
    }
  };
  const snapshotTurnOutputArtifacts = (outputDir, turnCwd) => {
    if (!outputDir || !supportsArtifactDelivery) return null;
    let snapshotDir = null;
    let directory;
    const candidates = [];
    let artifactBytes = 0;
    try {
      snapshotDir = createTurnOutputSnapshotDirectory(turnCwd);
      directory = fs.opendirSync(outputDir);
      const names = [];
      for (let scanned = 0; scanned < outputArtifactScanLimit; scanned += 1) {
        const entry = directory.readSync();
        if (!entry) break;
        const filename = entry.name;
        if (!outputFilenameIsSafe(filename)) continue;
        names.push(filename);
      }
      // Do not copy every regular file merely to discover that it falls past
      // the count cap. A hostile turn can create many files, but it cannot
      // make the transport duplicate more than the bounded output budget.
      for (const filename of names.sort((a, b) => a.localeCompare(b))) {
        if (candidates.length >= outputArtifactLimit) break;
        let copied;
        try {
          copied = copyOutputArtifactToSnapshot(
            path.join(outputDir, filename),
            path.join(snapshotDir, filename),
            outputArtifactTotalByteLimit - artifactBytes,
          );
        } catch (error) {
          log("BOT_ARTIFACT_OUTPUT_SKIPPED", { reason: "unsafe-or-changed", error: String(error?.message ?? error) });
          continue;
        }
        if (copied?.skipped === "too-large") {
          log("BOT_ARTIFACT_OUTPUT_SKIPPED", { reason: "too-large", bytes: copied.size, maxBytes: outputArtifactByteLimit });
          continue;
        }
        if (copied?.skipped === "total-limit") {
          log("BOT_ARTIFACT_OUTPUT_SKIPPED", {
            reason: "total-limit",
            bytes: copied.size,
            usedBytes: artifactBytes,
            maxBytes: outputArtifactTotalByteLimit,
          });
          // Preserve deterministic filename order: once the next file cannot
          // fit, later artifacts are not considered for this bounded turn.
          break;
        }
        if (copied == null) continue;
        candidates.push({ filePath: path.join(snapshotDir, filename), filename, size: copied.size });
        artifactBytes += copied.size;
      }
      const artifacts = candidates;
      if (artifacts.length === 0) {
        cleanupTurnOutputDirectory(snapshotDir);
        return null;
      }
      return { snapshotDir, artifacts };
    } catch (error) {
      log("BOT_ARTIFACT_OUTPUT_SCAN_FAILED", { error: String(error?.message ?? error) });
      if (snapshotDir) cleanupTurnOutputDirectory(snapshotDir);
      return null;
    } finally {
      try { directory?.closeSync(); } catch { /* already closed or unavailable */ }
    }
  };

  // Token/cost usage: the engines already report it per turn — log it and keep
  // an in-memory per-peer tally for /usage (observability, not billing; resets
  // on restart).
  const recordUsage = (peerHex, usage, sessionKey = peerHex) => {
    if (!usage) return;
    const k = norm(sessionKey);
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

  const queueEngineTurn = (peerHex, run, sessionKey = peerHex) => {
    if (shuttingDown) return Promise.resolve({ stopped: true });
    const peerKey = norm(sessionKey);
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
// reply progress frames and (when supported by the CLI) final-text deltas
// feed a live draft. The session id is captured for --resume and only full
// terminal text is accumulated as the durable answer. No wall-clock limit —
// an idle-silence backstop kills a wedged process (and unblocks the peer
// queue). Returns { answer }, { stopped: true } (user /stop), or null on
// failure.
  const runEngine = (peerHex, userText, onAction = null, onPartial = null, cwd = workspace, job = null, outputDir = null, sessionKey = peerHex, attachmentDir = null) => new Promise((resolve) => {
    const k = norm(sessionKey);
    if (job?.cancelled) { resolve({ stopped: true }); return; }
    let child;
    try {
      const turnModel = peerModelOverrides.get(k) ?? model;
      const resume = peerResume.get(k) ?? null;
      const effort = peerEffortOverrides.get(k) ?? reasoning ?? "";
      const argv = buildArgs({
        prompt: userText,
        model: turnModel,
        resume,
        effort: effort || null,
        // This is a transport-owned, per-turn directory. It is deliberately
        // not the original media-cache path, and disappears after the CLI
        // exits. A runner can use it to construct a least-privilege Read rule.
        attachmentDir,
        // The primary cwd normally receives Claude Code's convenience Read
        // access, so a public attachment-only policy must explicitly deny it.
        workingDirectory: cwd,
      });
      // Detached: a new process group, so killProcessGroup reaps the CLI's children.
      // stdin ignored: some CLIs (codex) otherwise block on "Reading additional input".
      const env = outputDir ? { ...childEnv, PCA_OUTPUT_DIR: outputDir } : childEnv;
      const options = { stdio: ["ignore", "pipe", "pipe"], cwd, env, detached: true };
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
        // Partial text is deliberately presentation-only. The complete
        // assistant/result frames still own `answer`, which prevents stream
        // retries or a CLI's repeated transcript frame from duplicating the
        // final reply.
        else if (ev.kind === "partial") onPartial?.(ev.text);
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
      if (code === 0 || finalAnswer) { recordUsage(peerHex, usage, k); return finish({ answer: finalAnswer }); }
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
    return {
      attachmentDir: stageDir,
      cleanup: () => {
        for (const [attachment, source] of originalPaths) attachment.path = source;
        if (!stageDir) return;
        try { fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 2 }); }
        catch (error) { log("BOT_ATTACHMENT_CLEANUP_FAILED", { error: String(error?.message ?? error) }); }
      },
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
    trimOverrides: () => {
      trimMap(peerModelOverrides, peerCap);
      trimMap(peerEffortOverrides, peerCap);
      // Overrides affect future native CLI argv and must survive a restart in
      // the same state snapshot as their resume token.
      persist();
    },
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
    // ({ text, messageId, kind, attachments?, replyTo?, editOf?, sessionKey? }).
    // `peerHex` is always the transport delivery target. A transport can give
    // a threaded message a distinct `sessionKey` so native model memory and
    // commands stay isolated without changing where replies are published.
    async handleMessage(peerHex, msg) {
      const k = norm(msg?.sessionKey ?? peerHex);
      const deliveryKey = norm(peerHex);
      // A transport may attach an opaque immutable delivery context (for
      // example a T3ams thread lane). It is never rendered into the model
      // prompt, but follows every reply/progress callback so concurrent model
      // sessions sharing one delivery conversation cannot cross-route output.
      const deliveryContext = msg?.deliveryContext ?? null;
      const { deliveryContext: _ignoredDeliveryContext, ...messageForPrompt } = msg ?? {};
      // T3ams channel messages preserve their raw `@bot …` prompt for the
      // model, but may supply the slash-command suffix separately. Other
      // transports and DMs continue to use their raw text as before.
      const commandInput = typeof msg.commandText === "string" ? msg.commandText : msg.text;
      const commandReply = handleCommandFor(k, commandInput);
      if (commandReply) {
        log("BOT_COMMAND", { from: peerHex, command: commandInput.split(/\s/)[0] });
        await sendReply("sendText", peerHex, commandReply, deliveryContext);
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
        await sendReply("sendText", peerHex, `⚠️ I couldn't open ${proj ? `${proj.alias}${proj.branch ? `@${proj.branch}` : ""}` : "the workspace"}: ${String(e?.message ?? e)}. /project default switches back to the shared workspace.`, deliveryContext);
        return true;
      }
      const turnProgress = chat.beginTurn(peerHex, deliveryContext); // arms the "thinking" placeholder
      // Preserve the historical function-shaped beginTurn API while allowing
      // transports to hang a second, presentation-only partial-text callback
      // from that same turn. A non-function object form is also accepted for
      // custom transports.
      const onAction = typeof turnProgress === "function" ? turnProgress : turnProgress?.onAction;
      const onPartial = typeof turnProgress === "function" ? turnProgress.onPartial : turnProgress?.onPartial;
      let artifactHandoff = null;
      try {
        const result = await queueEngineTurn(peerHex, async (job) => {
          const stagedAttachments = stageAttachmentsForTurn(turnCwd, msg.attachments);
          let outputDir = null;
          try {
            if (supportsArtifactDelivery) {
              try { outputDir = createTurnOutputDirectory(turnCwd); }
              catch (error) { log("BOT_ARTIFACT_OUTPUT_DIR_FAILED", { to: peerHex, error: String(error?.message ?? error) }); }
            }
            // Verbatim prompt — the engine keeps its own session; the transport's
            // renderer only adds attachment/reply/edit context, not a persona.
            // `outputDir` is transport-owned capability context, so surface it
            // to a renderer only for the turn in which it actually exists.
            const promptMessage = outputDir == null ? messageForPrompt : { ...messageForPrompt, outputDir };
            const engineResult = await runEngine(
              peerHex,
              renderMessage(promptMessage),
              onAction,
              onPartial,
              turnCwd,
              job,
              outputDir,
              k,
              stagedAttachments.attachmentDir,
            );
            if (engineResult && !engineResult.stopped && outputDir) {
              // The callback must never receive a path still writable by the
              // agent. Snapshot it now, while the root transport controls the
              // destination, then remove the original handoff directory.
              artifactHandoff = snapshotTurnOutputArtifacts(outputDir, turnCwd);
            }
            return engineResult;
          } finally {
            stagedAttachments.cleanup();
            cleanupTurnOutputDirectory(outputDir);
          }
        }, k);
        // A user /stop is a completed action, but a process-wide shutdown must
        // leave the durable owed record for the next process to resume.
        if (result?.stopped) return !shuttingDown;
        if (result?.busy) {
          await sendReply("deliver", peerHex, "I'm busy with other requests right now. Please try again in a moment.", deliveryContext);
          return true;
        }
        if (!result) {
          if (shuttingDown) return false;
          // Don't leave the user hanging after the "thinking" placeholder.
          await sendReply("deliver", peerHex, "Sorry — I couldn't reach my agent just now. Please try again in a moment.", deliveryContext);
          return true;
        }
        // A shutdown that happens after the child exits but before a reply
        // handoff starts must leave the durable ingress record for the next
        // process. Once a handoff starts, shutdown waits for it below.
        if (shuttingDown) return false;
        await runReplyHandoff(async () => {
          // Discovery: the very first reply to a peer carries a one-time /help
          // hint (persisted, so a restart doesn't repeat it).
          let outgoing = result.answer || "(no output)";
          if (!introducedPeers.has(deliveryKey)) {
            introducedPeers.add(deliveryKey);
            trimSet(introducedPeers, peerCap);
            persist();
            outgoing += "\n\n(Tip: send /help to see my commands.)";
          }
          await sendTurn(peerHex, outgoing, artifactHandoff?.artifacts ?? [], deliveryContext);
        });
        return true;
      } finally {
        cleanupTurnOutputDirectory(artifactHandoff?.snapshotDir);
      }
    },

    // /stop lever: cancel a peer's queued or in-flight turn. The transport
    // intercepts /stop BEFORE its per-peer work queue, so it can also cancel
    // a turn waiting for the global execution budget.
    stop(peerHex, sessionKey = peerHex) {
      const k = norm(sessionKey);
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
      return Promise.allSettled([...activeTurnPromises, ...activeReplyHandoffs]).finally(cleanupPrivateStagingRoot);
    },

    queueStats: () => ({ active: activeTurnCount, queued: queuedTurns.length, activeCap: turnLimit, queuedCap: queuedTurnLimit }),

    // State keys with durable agent state. A transport that deliberately uses
    // a session key distinct from its delivery target (for example a T3ams
    // thread) uses this to persist and restore every native conversation.
    stateKeys: () => {
      const keys = new Set([
        ...peerResume.keys(),
        ...peerModelOverrides.keys(),
        ...peerEffortOverrides.keys(),
        ...peerProjects.keys(),
      ]);
      return [...keys].slice(-peerCap);
    },

    // ---- persistence (the transport owns the snapshot file; the runtime
    // owns what its fields mean) ----
    // Resume tokens are scoped to the engine, base model, and cwd. A change to
    // any of those starts fresh rather than asking a native CLI to resume a
    // conversation under incompatible settings.
    snapshotAgent: () => ({ engine: engineName, workspace, model }),
    peerSnapshot(peerKey) {
      const proj = peerProjects.get(peerKey);
      return {
        ...(peerResume.has(peerKey) ? { rs: peerResume.get(peerKey) } : {}),
        // Model overrides are part of a native session's identity. Persist
        // them so a valid token never resumes later under the default model.
        ...(peerModelOverrides.has(peerKey) ? { mo: peerModelOverrides.get(peerKey) } : {}),
        // Reasoning effort changes future native CLI argv just like a model
        // override. Preserve it per native session (including a T3ams thread)
        // so a restart does not silently reset the user's choice.
        ...(peerEffortOverrides.has(peerKey) ? { ro: peerEffortOverrides.get(peerKey) } : {}),
        // Active project/branch — the resume token above is only valid in
        // this cwd, so both restore together or not at all.
        ...(proj ? { pj: proj.alias, ...(proj.branch ? { br: proj.branch } : {}) } : {}),
      };
    },
    // Call once with the persisted agent meta before restorePeer calls.
    // An engine or base-model change invalidates every token; a workspace change
    // invalidates tokens of peers in the shared workspace — a project peer's
    // cwd is the project itself, validated per peer in restorePeer.
    noteRestoredAgent(agentMeta) {
      this._engineMatches = Boolean(agentMeta) && agentMeta.engine === engineName;
      this._workspaceMatches = this._engineMatches && agentMeta.workspace === workspace;
      this._modelMatches = this._engineMatches && agentMeta.model === model;
      if (agentMeta && (!this._workspaceMatches || !this._modelMatches)) {
        log("BOT_RESUME_INVALIDATED", { was: agentMeta, now: { engine: engineName, workspace, model } });
      }
    },
    restorePeer(peerKey, { rs, mo, ro, pj, br } = {}) {
      const proj = pj && workspaces?.has(pj) ? { alias: pj, branch: br ?? null } : null;
      if (proj) { peerProjects.set(peerKey, proj); trimMap(peerProjects, peerCap); }
      else if (pj) log("BOT_PROJECT_DROPPED", { peer: peerKey, alias: pj, reason: "no longer registered" });
      const hasStoredOverride = mo != null;
      const validStoredOverride = typeof mo === "string" && mo.length > 0 && !mo.startsWith("-") && !mo.includes("\0");
      const modelAllowed = !hasStoredOverride || (validStoredOverride
        && (allowedModels == null || (Array.isArray(allowedModels) && allowedModels.includes(mo))));
      if (validStoredOverride && modelAllowed) {
        peerModelOverrides.set(peerKey, mo);
        trimMap(peerModelOverrides, peerCap);
      } else if (hasStoredOverride) {
        log("BOT_MODEL_OVERRIDE_DROPPED", { peer: peerKey, model: mo, reason: "no longer allowed" });
      }
      const hasStoredEffort = ro != null;
      const validStoredEffort = typeof ro === "string"
        && Array.isArray(engine?.effortLevels)
        && engine.effortLevels.includes(ro);
      if (validStoredEffort) {
        peerEffortOverrides.set(peerKey, ro);
        trimMap(peerEffortOverrides, peerCap);
      } else if (hasStoredEffort) {
        log("BOT_REASONING_OVERRIDE_DROPPED", { peer: peerKey, effort: ro, reason: "no longer allowed" });
      }
      // If a persisted override is no longer allowed, its token is necessarily
      // for a different effective model and must not be reused.
      if (rs && modelAllowed && this._engineMatches && this._modelMatches && (pj ? proj != null : this._workspaceMatches)) {
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
