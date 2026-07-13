import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createWorkspaces, parseProjectSpec, isValidBranch } from "../lib/workspaces.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-ws-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

const makeRepo = () => {
  const dir = tmp();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-q", "-m", "init");
  return dir;
};

const makeFakeGit = (script) => {
  const command = path.join(tmp(), "git");
  fs.writeFileSync(command, `#!/bin/sh\n${script}\n`, { mode: 0o700 });
  return command;
};

test("parseProjectSpec accepts alias and alias@branch, rejects escapes", () => {
  assert.deepEqual(parseProjectSpec("myproj"), { alias: "myproj", branch: null });
  assert.deepEqual(parseProjectSpec("MyProj@feat/x"), { alias: "myproj", branch: "feat/x" });
  assert.equal(parseProjectSpec("../etc"), null);
  assert.equal(parseProjectSpec("a b"), null);
  assert.equal(parseProjectSpec("p@../../x"), null);
  assert.equal(parseProjectSpec("p@-rf"), null);
  assert.equal(parseProjectSpec("p@a..b"), null);
});

test("branch validation blocks git/path tricks", () => {
  assert.equal(isValidBranch("feature/nice-1.2"), true);
  assert.equal(isValidBranch("-delete"), false);
  assert.equal(isValidBranch("a..b"), false);
  assert.equal(isValidBranch("x.lock"), false);
  assert.equal(isValidBranch("end/"), false);
});

test("registry validates aliases and paths", () => {
  const repo = makeRepo();
  const ws = createWorkspaces({
    projects: { good: repo, "BAD ALIAS": repo, missing: path.join(repo, "nope") },
    worktreesDir: tmp(),
  });
  assert.deepEqual(ws.aliases(), ["good"]);
  assert.equal(ws.pathOf("good"), repo);
});

test("resolveCwd returns the repo root without a branch", async () => {
  const repo = makeRepo();
  const ws = createWorkspaces({ projects: { p: repo }, worktreesDir: tmp() });
  assert.equal(await ws.resolveCwd({ alias: "p", branch: null }), repo);
  await assert.rejects(ws.resolveCwd({ alias: "ghost", branch: null }), /unknown project/);
});

test("resolveCwd creates (and reuses) a worktree per branch", async () => {
  const repo = makeRepo();
  const wtDir = tmp();
  const ws = createWorkspaces({ projects: { p: repo }, worktreesDir: wtDir });
  const cwd = await ws.resolveCwd({ alias: "p", branch: "feat/x" });
  assert.ok(cwd.startsWith(wtDir), `worktree outside worktreesDir: ${cwd}`);
  assert.equal(git(cwd, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feat/x");
  // Reuse: same path, no error on second resolve.
  assert.equal(await ws.resolveCwd({ alias: "p", branch: "feat/x" }), cwd);
  // A different branch gets its own tree.
  const other = await ws.resolveCwd({ alias: "p", branch: "main2" });
  assert.notEqual(other, cwd);
});

test("worktree commands honor the configured agent identity", {
  skip: typeof process.getuid !== "function" || typeof process.getgid !== "function",
}, async () => {
  const repo = makeRepo();
  const ws = createWorkspaces({
    projects: { p: repo },
    worktreesDir: tmp(),
    agentUid: process.getuid(),
    agentGid: process.getgid(),
  });
  const cwd = await ws.resolveCwd({ alias: "p", branch: "agent-identity" });
  assert.equal(git(cwd, "rev-parse", "--abbrev-ref", "HEAD").trim(), "agent-identity");
});

test("worktree paths are collision-free for distinct valid branch names", async () => {
  const repo = makeRepo();
  const ws = createWorkspaces({ projects: { p: repo }, worktreesDir: tmp() });
  const slash = await ws.resolveCwd({ alias: "p", branch: "feat/x" });
  const underscores = await ws.resolveCwd({ alias: "p", branch: "feat__x" });
  assert.notEqual(slash, underscores, "branch path encoding must be injective");
  assert.equal(git(slash, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feat/x");
  assert.equal(git(underscores, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feat__x");
});

test("concurrent resolves for one branch share a single worktree creation", async () => {
  const repo = makeRepo();
  const events = [];
  const ws = createWorkspaces({
    projects: { p: repo },
    worktreesDir: tmp(),
    log: (event, extra) => events.push({ event, ...extra }),
  });
  const paths = await Promise.all(Array.from({ length: 8 }, () => ws.resolveCwd({ alias: "p", branch: "feature/race" })));
  assert.equal(new Set(paths).size, 1);
  assert.equal(events.filter((e) => e.event === "BOT_WORKTREE_CREATED").length, 1);
  assert.equal(git(paths[0], "rev-parse", "--abbrev-ref", "HEAD").trim(), "feature/race");
});

test("resolveCwd on a non-git project fails with a clear message", async () => {
  const plain = tmp();
  const ws = createWorkspaces({ projects: { docs: plain }, worktreesDir: tmp() });
  assert.equal(await ws.resolveCwd({ alias: "docs", branch: null }), plain); // root is fine
  await assert.rejects(ws.resolveCwd({ alias: "docs", branch: "b" }), /not a git repository/);
});

test("worktree subprocess output is capped before a noisy hook can retain memory", async () => {
  const repo = makeRepo();
  const gitCommand = makeFakeGit(`
if [ "$1" = "rev-parse" ]; then
  printf '%s\\n' true
  exit 0
fi
while :; do printf x; done
`);
  const ws = createWorkspaces({
    projects: { p: repo },
    worktreesDir: tmp(),
    gitCommand,
    gitOutputBytes: 1024,
    gitTimeoutMs: 5_000,
  });
  await assert.rejects(ws.resolveCwd({ alias: "p", branch: "noisy" }), /output exceeded 1024 bytes/);
});

test("worktree subprocess timeout reaps a stalled command", async () => {
  const repo = makeRepo();
  const gitCommand = makeFakeGit(`
if [ "$1" = "rev-parse" ]; then
  printf '%s\\n' true
  exit 0
fi
sleep 30
`);
  const ws = createWorkspaces({
    projects: { p: repo },
    worktreesDir: tmp(),
    gitCommand,
    gitTimeoutMs: 500,
  });
  await assert.rejects(ws.resolveCwd({ alias: "p", branch: "stalled" }), /timed out after 500ms/);
});
