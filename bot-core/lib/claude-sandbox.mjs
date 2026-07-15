import path from "node:path";
import { spawnSync } from "node:child_process";
import { createToolPolicy, hasToolCapability } from "./tool-policy.mjs";

// Claude's own dependency check proves that Bubblewrap is installed, but it
// deliberately does not create a namespace. A deployed bot needs a real probe:
// Docker/AppArmor/seccomp can leave the CLI healthy while every Bash turn fails.
export const requiresClaudeWorkspaceSandbox = (engineName, policyInput) => {
  const policy = createToolPolicy(policyInput);
  return engineName === "claude"
    && policy.scope === "workspace"
    && hasToolCapability(policy, "bash");
};

const absoluteWorkspace = (workingDirectory) => {
  const resolved = path.resolve(String(workingDirectory ?? "/workspace"));
  if (/\x00|\r|\n/.test(resolved)) throw new Error("Claude sandbox workspace contains an invalid path.");
  return resolved;
};

const absoluteDirectories = (directories, label) => [...new Set((directories ?? [])
  .filter((directory) => directory != null && String(directory).trim() !== "")
  .map((directory) => {
  const resolved = path.resolve(String(directory ?? ""));
  if (resolved === "/" || /\x00|\r|\n/.test(resolved)) throw new Error(`${label} contains an invalid path.`);
  return resolved;
}))];

const probeScript = ({ requirePayloadProfile }) => [
  "set -eu",
  'probe_file=".pca-sandbox-readiness-$$"',
  'mount_dir=".pca-sandbox-mount-$$"',
  'trap \'rmdir "$mount_dir" 2>/dev/null || true; rm -f "$probe_file"\' EXIT',
  ': > "$probe_file"',
  'test -f "$probe_file"',
  "cap_eff=''",
  "while read -r key value; do",
  '  case "$key" in CapEff:) cap_eff="$value"; break;; esac',
  "done < /proc/self/status",
  'test "$cap_eff" = "0000000000000000"',
  ...(requirePayloadProfile ? [
    "profile=''",
    "IFS= read -r profile < /proc/self/attr/current || true",
    'case "$profile" in *pca-agent-unpriv-bwrap-v1*) ;; *) exit 72;; esac',
    'mkdir "$mount_dir"',
    // Claude Code 2.1.207 relies on Bubblewrap automatically entering a user
    // namespace and dropping capabilities for the non-setuid, non-root agent.
    // The check above proves that contract; the stacked payload AppArmor
    // profile additionally denies the capability-backed mount operation below.
    'if mount -t tmpfs -o size=4k tmpfs "$mount_dir" 2>/dev/null; then umount "$mount_dir"; exit 73; fi',
    'rmdir "$mount_dir"',
  ] : []),
].join("\n");

// Mirrors Claude's strong Linux Bubblewrap command: read-only root, explicit
// writable workspace, fresh PID/network namespaces, and fresh procfs. Claude
// Code 2.1.207 relies on Bubblewrap's non-root automatic user namespace and
// capability drop; Docker's stacked payload AppArmor profile is a second
// capability boundary. Docker sets `allowAllUnixSockets: true`, which opts out
// of Claude's optional Unix-socket seccomp filter only. It does not set
// `enableWeakerNestedSandbox`, so the normal fresh-proc Bubblewrap sandbox
// remains in effect for sandboxed Bash. The probe runs no model and receives a
// scrubbed environment.
export const claudeWorkspaceSandboxProbeArgs = ({
  workingDirectory = "/workspace",
  protectedDirectories = [],
  requirePayloadProfile = false,
} = {}) => {
  const workspace = absoluteWorkspace(workingDirectory);
  const protectedPaths = absoluteDirectories(protectedDirectories, "Claude sandbox protected path")
    .filter((directory) => directory !== workspace && !workspace.startsWith(`${directory}/`));
  return [
    "--new-session", "--die-with-parent",
    "--unshare-net",
    "--ro-bind", "/", "/",
    "--bind", workspace, workspace,
    ...protectedPaths.flatMap((directory) => ["--tmpfs", directory]),
    "--dev", "/dev",
    "--unshare-pid",
    "--proc", "/proc",
    "--chdir", workspace,
    "--", "/bin/sh", "-ec", probeScript({ requirePayloadProfile: requirePayloadProfile === true }),
  ];
};

const probeEnvironment = (env = process.env) => ({
  PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
  // The probe executes only a fixed shell assertion. Give it no
  // caller-controlled home path: this is a capability check, not a model
  // subprocess.
  HOME: "/tmp",
  LANG: env.LANG || "C.UTF-8",
  ...(env.LC_ALL ? { LC_ALL: env.LC_ALL } : {}),
});

const compactDetail = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 600);

export class ClaudeSandboxPreflightError extends Error {
  constructor(detail) {
    super(`Claude workspace Bash sandbox is unavailable: ${detail}. Install Bubblewrap and, for a Docker deployment, prepare the host with \`pca prepare-host\` before enabling workspace Bash.`);
    this.name = "ClaudeSandboxPreflightError";
  }
}

export const assertClaudeWorkspaceSandbox = ({
  engineName,
  policy,
  workingDirectory,
  protectedDirectories = [],
  containerRuntime = false,
  agentUid = null,
  agentGid = null,
  platform = process.platform,
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) => {
  if (!requiresClaudeWorkspaceSandbox(engineName, policy)) {
    return { required: false, checked: false };
  }
  // Claude uses the native Seatbelt sandbox outside Linux; Bubblewrap is a
  // Linux-only readiness test.
  if (platform !== "linux") return { required: true, checked: false };

  const workspace = absoluteWorkspace(workingDirectory);
  const options = {
    cwd: workspace,
    env: probeEnvironment(env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    ...(agentUid == null ? {} : { uid: agentUid }),
    ...(agentGid == null ? {} : { gid: agentGid }),
  };
  const result = spawnSyncFn("bwrap", claudeWorkspaceSandboxProbeArgs({
    workingDirectory: workspace,
    protectedDirectories,
    requirePayloadProfile: containerRuntime === true,
  }), options);
  if (result?.status === 0 && !result?.error) {
    return { required: true, checked: true };
  }
  const detail = compactDetail(
    result?.error?.message
      ?? result?.stderr
      ?? result?.stdout
      ?? (result?.signal ? `probe terminated by ${result.signal}` : `probe exited ${result?.status ?? "without a status"}`),
  );
  throw new ClaudeSandboxPreflightError(detail || "Bubblewrap probe failed");
};
