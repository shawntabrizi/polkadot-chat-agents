import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeSandboxPreflightError,
  assertClaudeWorkspaceSandbox,
  claudeWorkspaceSandboxProbeArgs,
  requiresClaudeWorkspaceSandbox,
} from "../lib/claude-sandbox.mjs";

const workspacePolicy = { capabilities: ["read", "write", "bash"], scope: "workspace", network: "none" };
const sandboxAssetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "linux-sandbox");

test("Claude sandbox readiness is required only for workspace Bash", () => {
  assert.equal(requiresClaudeWorkspaceSandbox("claude", workspacePolicy), true);
  assert.equal(requiresClaudeWorkspaceSandbox("codex", workspacePolicy), false);
  assert.equal(requiresClaudeWorkspaceSandbox("claude", { capabilities: ["read"], scope: "workspace", network: "none" }), false);
  assert.equal(requiresClaudeWorkspaceSandbox("claude", { capabilities: ["bash"], scope: "container", network: "internet" }), false);
});

test("Claude sandbox probe uses a fresh procfs, protected-path masks, and payload capability denial", () => {
  const args = claudeWorkspaceSandboxProbeArgs({
    workingDirectory: "/workspace/demo",
    protectedDirectories: ["/state", "/home/node", "/app"],
    requirePayloadProfile: true,
  });
  assert.deepEqual(args.slice(0, -1), [
    "--new-session", "--die-with-parent",
    "--unshare-net",
    "--ro-bind", "/", "/",
    "--bind", "/workspace/demo", "/workspace/demo",
    "--tmpfs", "/state",
    "--tmpfs", "/home/node",
    "--tmpfs", "/app",
    "--dev", "/dev",
    "--unshare-pid",
    "--proc", "/proc",
    "--chdir", "/workspace/demo",
    "--", "/bin/sh", "-ec",
  ]);
  const script = args.at(-1);
  assert.match(script, /CapEff/);
  assert.match(script, /0000000000000000/);
  assert.match(script, /pca-agent-unpriv-bwrap-v1/);
  assert.match(script, /mount -t tmpfs/);
  assert.doesNotMatch(args.join("\n"), /enableWeakerNestedSandbox/);
});

test("preflight executes Bubblewrap as the agent identity with a scrubbed environment", () => {
  let invocation;
  const result = assertClaudeWorkspaceSandbox({
    engineName: "claude",
    policy: workspacePolicy,
    workingDirectory: "/workspace/demo",
    protectedDirectories: ["/state", "/home/node", "/app"],
    containerRuntime: true,
    platform: "linux",
    agentUid: 1000,
    agentGid: 1000,
    env: { PATH: "/tool/bin", HOME: "/secret-home", BOT_SEED_HEX: "never-pass-this" },
    spawnSyncFn: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { required: true, checked: true });
  assert.equal(invocation.command, "bwrap");
  assert.equal(invocation.options.uid, 1000);
  assert.equal(invocation.options.gid, 1000);
  assert.deepEqual(invocation.options.env, { PATH: "/tool/bin", HOME: "/tmp", LANG: "C.UTF-8" });
  assert.ok(invocation.args.includes("--proc"));
  assert.ok(invocation.args.includes("--tmpfs"));
  assert.match(invocation.args.at(-1), /pca-agent-unpriv-bwrap-v1/);
});

test("preflight fails closed with the Bubblewrap diagnostic", () => {
  assert.throws(() => assertClaudeWorkspaceSandbox({
    engineName: "claude",
    policy: workspacePolicy,
    workingDirectory: "/workspace",
    platform: "linux",
    spawnSyncFn: () => ({ status: 1, stderr: "bwrap: No permissions to create new namespace" }),
  }), (error) => error instanceof ClaudeSandboxPreflightError && /No permissions/.test(error.message));
});

test("non-Linux and non-Claude cases never run a Bubblewrap probe", () => {
  const never = () => { throw new Error("should not run"); };
  assert.deepEqual(assertClaudeWorkspaceSandbox({ engineName: "claude", policy: workspacePolicy, platform: "darwin", spawnSyncFn: never }), { required: true, checked: false });
  assert.deepEqual(assertClaudeWorkspaceSandbox({ engineName: "codex", policy: workspacePolicy, spawnSyncFn: never }), { required: false, checked: false });
});

test("the Docker Bubblewrap seccomp asset is pinned and permits only its narrow setup path", () => {
  const meta = JSON.parse(fs.readFileSync(path.join(sandboxAssetsDir, "pca-agent-sandbox-v1.seccomp.meta.json"), "utf8"));
  const raw = fs.readFileSync(path.join(sandboxAssetsDir, "pca-agent-sandbox-v1.seccomp.json"));
  const profile = JSON.parse(raw);
  assert.deepEqual(meta.base, {
    repository: "https://github.com/moby/profiles",
    ref: "seccomp/v0.2.3",
    commit: "836ae4d37ef2ec995c77c99fc55f5b5f3af3a897",
    path: "seccomp/default.json",
    sha256: "536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74",
  });
  assert.equal(meta.format, 2);
  assert.equal(meta.generatedSha256, "7f55e3ea6420d170cf0a1f78c35ea237106571bb0500fdcf0b5f9d602ffb5b6b");
  assert.equal(createHash("sha256").update(raw).digest("hex"), "7f55e3ea6420d170cf0a1f78c35ea237106571bb0500fdcf0b5f9d602ffb5b6b");
  assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
  assert.deepEqual(meta.pcaSetupSyscalls, ["mount", "umount2", "pivot_root"]);
  assert.equal(meta.pcaCloneNamespaceMask, 2114060288);
  assert.deepEqual(meta.pcaCloneNamespaceValues, [805437440, 1879179264]);

  const pcaRules = profile.syscalls.filter((rule) => String(rule.comment ?? "").startsWith("PCA Bubblewrap "));
  const cloneRules = [0, 1].flatMap((index) => [
    [805437440, "NEWUSER|NEWNS|NEWPID"],
    [1879179264, "NEWUSER|NEWNS|NEWPID|NEWNET"],
  ].map(([value, flags]) => ({
    names: ["clone"],
    action: "SCMP_ACT_ALLOW",
    args: [{ index, value: 2114060288, valueTwo: value, op: "SCMP_CMP_MASKED_EQ" }],
    comment: `PCA Bubblewrap user namespace setup (${flags}); constrained by pca-agent-sandbox-v1 AppArmor stack.`,
    ...(index === 0
      ? { excludes: { caps: ["CAP_SYS_ADMIN"], arches: ["s390", "s390x"] } }
      : { includes: { arches: ["s390", "s390x"] }, excludes: { caps: ["CAP_SYS_ADMIN"] } }),
  })));
  assert.deepEqual(pcaRules, [{
    names: ["mount", "umount2", "pivot_root"],
    action: "SCMP_ACT_ALLOW",
    comment: "PCA Bubblewrap mount setup; constrained by pca-agent-sandbox-v1 AppArmor stack.",
  }, ...cloneRules]);

  const privilegedSetup = profile.syscalls.filter((rule) => rule.includes?.caps?.includes("CAP_SYS_ADMIN")
    && rule.names?.some((name) => ["clone", "mount", "umount2"].includes(name)));
  assert.deepEqual(privilegedSetup, []);
  assert.equal(profile.syscalls.filter((rule) => rule.names?.includes("clone") && rule.action === "SCMP_ACT_ALLOW").length, 6);
  assert.deepEqual(pcaRules.flatMap((rule) => rule.names).filter((name) => ["clone3", "unshare", "setns", "umount", "chroot"].includes(name)), []);
});

test("the host AppArmor asset stacks Bubblewrap setup and a capability-free payload", () => {
  const profile = fs.readFileSync(path.join(sandboxAssetsDir, "pca-agent-sandbox-v1.apparmor"), "utf8");
  assert.equal(createHash("sha256").update(profile).digest("hex"), "6361ccee4e91c19dd2895f277e88940c9fae35c464315d0a92185e984f1f96dc");
  assert.match(profile, /profile pca-agent-sandbox-v1/);
  assert.match(profile, /\/usr\/bin\/bwrap pix -> &pca-agent-bwrap-v1/);
  assert.match(profile, /profile pca-agent-unpriv-bwrap-v1/);
  assert.match(profile, /audit deny capability/);
});

test("the Linux sandbox assets are included in the published bot-core package", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(sandboxAssetsDir, "..", "..", "package.json"), "utf8"));
  assert.ok(manifest.files.includes("deploy/"));
});
