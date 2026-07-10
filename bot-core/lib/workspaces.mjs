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

const run = (cmd, args, cwd) => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", (e) => resolve({ code: -1, out, err: String(e?.message ?? e) }));
  child.on("close", (code) => resolve({ code, out, err }));
});

// projects: { alias: absolutePath } (validated at construction, not per call)
export const createWorkspaces = ({ projects = {}, worktreesDir, log = () => {} }) => {
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

  // One worktree per (alias, branch), created lazily and reused. The dir name
  // encodes the branch with "/" flattened; the branch itself was validated.
  const worktreePath = (alias, branch) =>
    path.join(worktreesDir, alias, branch.replace(/\//g, "__"));

  const ensureWorktree = async (alias, branch) => {
    const repo = registry.get(alias);
    const dir = worktreePath(alias, branch);
    // Escape guard: the computed path must stay under worktreesDir even if a
    // validation gap slipped something through.
    if (!dir.startsWith(path.resolve(worktreesDir) + path.sep)) throw new Error("worktree path escapes the worktrees dir");
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const probe = await run("git", ["rev-parse", "--is-inside-work-tree"], repo);
    if (probe.code !== 0) throw new Error(`${alias} is not a git repository`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    // Existing branch first; fall back to creating it from the repo's HEAD.
    let res = await run("git", ["worktree", "add", dir, branch], repo);
    if (res.code !== 0) res = await run("git", ["worktree", "add", "-b", branch, dir], repo);
    if (res.code !== 0) throw new Error(`git worktree add failed: ${(res.err || res.out).trim().slice(0, 200)}`);
    log("BOT_WORKTREE_CREATED", { alias, branch, dir });
    return dir;
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
