// Multi-project workspaces: a registry of named project directories the agent
// can work in, plus per-branch isolation via `git worktree`. A peer picks the
// project (and optionally a branch) with /project; the turn's cwd is then the
// project root or an isolated worktree instead of the shared workspace.
//
// Everything here is defensive because aliases and branch names arrive from
// chat: aliases are validated against the registry, branch names against a
// conservative charset, and every resolved cwd must stay inside the project
// root or the worktrees dir (no path escapes).

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Conservative git branch charset: no "..", no leading "-" or "/", no
// control/space/colon/backslash — rejects every path- and flag-escape trick.
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
export const isValidBranch = (branch) =>
  BRANCH_RE.test(branch) && !branch.includes("..") && !branch.endsWith("/") && !branch.endsWith(".lock");

// "alias" | "alias@branch" -> { alias, branch|null } | null
export const parseProjectSpec = (spec) => {
  const m = /^([^@\s]+)(?:@(\S+))?$/.exec(String(spec ?? "").trim());
  if (!m) return null;
  const alias = m[1].toLowerCase();
  if (!ALIAS_RE.test(alias)) return null;
  if (m[2] != null && !isValidBranch(m[2])) return null;
  return { alias, branch: m[2] ?? null };
};

const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_GIT_OUTPUT_BYTES = 64 * 1024;
const boundedInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
};

// `git worktree add` can run repository hooks. Treat it like an untrusted
// subprocess: a hook must not be able to retain unbounded output or wedge a
// chat turn forever. Detached process groups let the timeout reap hook children
// on POSIX as well as the git parent.
const run = (cmd, args, cwd, {
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  outputBytes = DEFAULT_GIT_OUTPUT_BYTES,
  uid = null,
  gid = null,
} = {}) => new Promise((resolve) => {
  const timeout = boundedInt(timeoutMs, DEFAULT_GIT_TIMEOUT_MS, { min: 10, max: 300_000 });
  const outputLimit = boundedInt(outputBytes, DEFAULT_GIT_OUTPUT_BYTES, { min: 1024, max: 4 * 1024 * 1024 });
  const output = [];
  const errors = [];
  let captured = 0;
  let child = null;
  let timer = null;
  let settled = false;
  let timedOut = false;
  let outputExceeded = false;

  const kill = () => {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  };
  const append = (target, data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const remaining = outputLimit - captured;
    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      target.push(part);
      captured += part.length;
    }
    if (chunk.length > remaining && !outputExceeded) {
      outputExceeded = true;
      kill();
    }
  };
  const finish = (code, error = null) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    let err = Buffer.concat(errors).toString("utf8");
    if (error) err = `${err}${err ? "\n" : ""}${String(error?.message ?? error)}`;
    if (timedOut) err = `${err}${err ? "\n" : ""}git command timed out after ${timeout}ms`;
    if (outputExceeded) err = `${err}${err ? "\n" : ""}git command output exceeded ${outputLimit} bytes`;
    resolve({ code: timedOut || outputExceeded || error ? -1 : code, out: Buffer.concat(output).toString("utf8"), err });
  };

  try {
    const options = {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    };
    // Git consults repository config and can execute hooks. When the transport
    // is root but the coding agent is not, never run that attacker-controlled
    // repository code with the transport's state-reading privileges.
    if (uid != null) options.uid = uid;
    if (gid != null) options.gid = gid;
    child = spawn(cmd, args, options);
  } catch (error) {
    finish(-1, error);
    return;
  }
  timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeout);
  child.stdout.on("data", (data) => append(output, data));
  child.stderr.on("data", (data) => append(errors, data));
  child.on("error", (error) => finish(-1, error));
  child.on("close", (code) => finish(code));
});

// projects: { alias: absolutePath } (validated at construction, not per call)
export const createWorkspaces = ({
  projects = {},
  worktreesDir,
  log = () => {},
  // Dependency/config seam for embedders and tests. This value is never chat
  // input; production uses the fixed system `git` binary.
  gitCommand = "git",
  gitTimeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  gitOutputBytes = DEFAULT_GIT_OUTPUT_BYTES,
  agentUid = null,
  agentGid = null,
} = {}) => {
  const registry = new Map();
  for (const [rawAlias, rawPath] of Object.entries(projects)) {
    const alias = String(rawAlias).toLowerCase();
    if (!ALIAS_RE.test(alias)) { log("BOT_PROJECT_SKIPPED", { alias: rawAlias, reason: "invalid alias" }); continue; }
    const dir = path.resolve(String(rawPath));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      log("BOT_PROJECT_SKIPPED", { alias, reason: "path is not a directory" });
      continue;
    }
    registry.set(alias, dir);
  }

  const resolvedWorktreesDir = path.resolve(worktreesDir);
  const pendingWorktrees = new Map();
  const command = typeof gitCommand === "string" && gitCommand ? gitCommand : "git";
  const gitOptions = {
    timeoutMs: gitTimeoutMs,
    outputBytes: gitOutputBytes,
    uid: agentUid,
    // Agent-runtime defaults a missing gid to the agent uid for its staged
    // files; use the identical identity for git/worktree subprocesses.
    gid: agentUid != null && agentGid == null ? agentUid : agentGid,
  };
  const runGit = (args, cwd) => run(command, args, cwd, gitOptions);
  const runMkdir = (dir, cwd) => run("mkdir", ["-p", dir], cwd, gitOptions);
  // One worktree per (alias, branch), created lazily and reused. Percent
  // encoding is injective for the validated branch alphabet: unlike replacing
  // "/" with "__", it cannot make `feat/x` and `feat__x` share a tree.
  const worktreePath = (alias, branch) =>
    path.join(resolvedWorktreesDir, alias, encodeURIComponent(branch));
  const resourceLimited = (result) => result.code === -1
    && /timed out|output exceeded/.test(result.err);

  const existingWorktree = async (dir, branch) => {
    if (!fs.existsSync(path.join(dir, ".git"))) return false;
    const inside = await runGit(["rev-parse", "--is-inside-work-tree"], dir);
    if (inside.code !== 0 || inside.out.trim() !== "true") return false;
    const head = await runGit(["branch", "--show-current"], dir);
    if (head.code !== 0) return false;
    if (head.out.trim() !== branch) throw new Error("worktree path is already used by a different branch");
    return true;
  };
  const waitForExistingWorktree = async (dir, branch) => {
    // `git worktree add` creates the directory before its metadata is fully
    // usable. A separate bot process can therefore lose the add race yet see
    // only a partial directory on its first retry.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await existingWorktree(dir, branch)) return true;
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };

  const createWorktree = async (alias, branch) => {
    const repo = registry.get(alias);
    const dir = worktreePath(alias, branch);
    // Escape guard: the computed path must stay under worktreesDir even if a
    // validation gap slipped something through.
    if (!dir.startsWith(resolvedWorktreesDir + path.sep)) throw new Error("worktree path escapes the worktrees dir");
    if (await existingWorktree(dir, branch)) return dir;
    const probe = await runGit(["rev-parse", "--is-inside-work-tree"], repo);
    if (probe.code !== 0) throw new Error(`${alias} is not a git repository`);
    const parent = await runMkdir(path.dirname(dir), repo);
    if (parent.code !== 0) throw new Error(`could not create worktree directory: ${(parent.err || parent.out).trim().slice(0, 200)}`);
    // Existing branch first; fall back to creating it from the repo's HEAD.
    let res = await runGit(["worktree", "add", dir, branch], repo);
    if (res.code !== 0 && !resourceLimited(res)) res = await runGit(["worktree", "add", "-b", branch, dir], repo);
    // Another bot process may have won the race after our initial check. Do
    // not treat that as a failed project selection when it created this exact
    // branch successfully.
    if (res.code !== 0 && !resourceLimited(res) && await waitForExistingWorktree(dir, branch)) return dir;
    if (res.code !== 0) throw new Error(`git worktree add failed: ${(res.err || res.out).trim().slice(0, 200)}`);
    log("BOT_WORKTREE_CREATED", { alias, branch, dir });
    return dir;
  };

  const ensureWorktree = (alias, branch) => {
    const key = `${alias}\u0000${branch}`;
    const pending = pendingWorktrees.get(key);
    if (pending) return pending;
    const creation = createWorktree(alias, branch).finally(() => pendingWorktrees.delete(key));
    pendingWorktrees.set(key, creation);
    return creation;
  };

  return {
    size: registry.size,
    aliases: () => [...registry.keys()],
    has: (alias) => registry.has(alias),
    pathOf: (alias) => registry.get(alias) ?? null,
    // {alias, branch|null} -> absolute cwd for the turn (creates the worktree
    // on first use). Throws with a user-presentable message on failure.
    async resolveCwd({ alias, branch }) {
      const repo = registry.get(alias);
      if (!repo) throw new Error(`unknown project "${alias}"`);
      return branch ? ensureWorktree(alias, branch) : repo;
    },
  };
};
