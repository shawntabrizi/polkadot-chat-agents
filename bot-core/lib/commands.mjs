// In-chat slash commands for the brains bot-core itself hosts (direct CLI
// brains). Pure logic over injected state so it can be unit-tested: the caller
// provides the per-peer history/model maps and environment facts.
//
// Contract: returns a reply string for command-shaped input (known commands
// act, unknown ones redirect to /help), and null for anything that is not
// command-shaped — that text belongs to the model.

import { parseProjectSpec } from "./workspaces.mjs";

const COMMAND_RE = /^\/([a-z][a-z0-9_-]*)(?:\s+(\S+))?\s*$/i;

export function createCommandHandler({
  clearResume,
  peerModelOverrides,
  defaultModel,
  username,
  chainConnected,
  trimOverrides = () => {},
  // Multi-project workspaces (null/empty when none are configured).
  workspaces = null,
  getPeerProject = () => null,
  setPeerProject = () => {},
  // Reasoning effort: the engine's accepted levels (null = unsupported).
  effortLevels = null,
  defaultEffort = "",
  peerEffortOverrides = new Map(),
  // Cumulative per-peer usage tally, or null when nothing recorded yet.
  getUsage = () => null,
}) {
  const hasProjects = () => (workspaces?.size ?? 0) > 0;
  const projectLabel = (p) => (p ? `${p.alias}${p.branch ? `@${p.branch}` : ""}` : null);
  // Shared by "/project <spec>" and the bare "/<alias> [@branch]" shortcut.
  // Switching changes the turn cwd, and a resume token is scoped to its cwd —
  // so every switch starts a fresh engine session (setPeerProject clears it).
  const switchProject = (peerKey, spec) => {
    const parsed = parseProjectSpec(spec);
    if (!parsed || !workspaces?.has(parsed.alias)) return `I don't know the project "${spec}" — /project lists what I have.`;
    const current = getPeerProject(peerKey);
    if (current && current.alias === parsed.alias && (current.branch ?? null) === parsed.branch) {
      return `Already working in ${projectLabel(parsed)}.`;
    }
    setPeerProject(peerKey, parsed);
    return `📁 Working in ${projectLabel(parsed)} from now on — fresh session${parsed.branch ? "; the branch worktree is prepared on your next message" : ""}. /project default to go back.`;
  };

  return (peerKey, text) => {
    const m = COMMAND_RE.exec(text);
    if (!m) return null;
    const [, rawCmd, argument] = m;
    const cmd = rawCmd.toLowerCase();
    switch (cmd) {
      case "help":
        return [
          "Commands:",
          "/reset — start a fresh session (forget our conversation so far)",
          "/stop — stop what I'm currently working on",
          "/model — show the model answering you (/model <name> to switch, /model default to go back)",
          ...(effortLevels ? ["/reasoning — dial my thinking depth (/reasoning <level>, /reasoning default)"] : []),
          ...(hasProjects() ? ["/project — pick the project I work in (/project <name>[@branch], /project default)"] : []),
          "/usage — tokens and cost spent on this chat since my last restart",
          "/ping — check the bot is alive",
        ].join("\n");
      case "reset":
        // Drop the native session token so the next turn starts a fresh
        // conversation (the engine's own memory, not a rebuilt text history).
        clearResume(peerKey);
        return "🧹 Fresh start — new session.";
      case "ping":
        return `🏓 pong — ${username || "bot"} is alive (chain: ${chainConnected() ? "connected" : "reconnecting"}).`;
      case "model": {
        if (!argument) {
          const current = peerModelOverrides.get(peerKey) ?? (defaultModel || "(CLI default)");
          return `Model: ${current}. Switch with /model <name>, or /model default.`;
        }
        if (argument === "default") {
          peerModelOverrides.delete(peerKey);
          return `Back to ${defaultModel || "the CLI's default model"}.`;
        }
        peerModelOverrides.set(peerKey, argument);
        trimOverrides();
        return `OK — answering you with ${argument} from now on (this chat only; /model default to undo).`;
      }
      case "reasoning": {
        if (!effortLevels) return "This engine has no reasoning control — /model is the lever it offers.";
        if (!argument) {
          const current = peerEffortOverrides.get(peerKey) ?? (defaultEffort || "(engine default)");
          return `Reasoning effort: ${current}. Levels: ${effortLevels.join(", ")} — /reasoning <level>, or /reasoning default.`;
        }
        if (argument === "default") {
          peerEffortOverrides.delete(peerKey);
          return `Back to ${defaultEffort || "the engine's default reasoning effort"}.`;
        }
        const level = argument.toLowerCase();
        if (!effortLevels.includes(level)) return `"${argument}" isn't a level I know — try one of: ${effortLevels.join(", ")}.`;
        peerEffortOverrides.set(peerKey, level);
        trimOverrides();
        return `🧠 Reasoning effort ${level} from now on (this chat only; /reasoning default to undo).`;
      }
      case "usage": {
        const u = getUsage(peerKey);
        if (!u || !u.turns) return "No usage recorded for this chat since my last restart.";
        const cost = u.costUsd > 0 ? `, ~$${u.costUsd.toFixed(4)}` : "";
        return `This chat since my last restart: ${u.turns} turn${u.turns === 1 ? "" : "s"}, ${u.inputTokens.toLocaleString("en-US")} tokens in / ${u.outputTokens.toLocaleString("en-US")} out${cost}.`;
      }
      case "project": {
        if (!hasProjects()) return "No projects are set up for me — my operator can add one with: pca project <bot> add <alias> <path>.";
        if (!argument) {
          return [
            `Projects: ${workspaces.aliases().join(", ")}.`,
            `Now: ${projectLabel(getPeerProject(peerKey)) ?? "the shared workspace"}.`,
            "Switch with /project <name> (add @<branch> for an isolated worktree); /project default goes back.",
          ].join("\n");
        }
        if (argument === "default" || argument === "off" || argument === "none") {
          if (!getPeerProject(peerKey)) return "Already in the shared workspace.";
          setPeerProject(peerKey, null);
          return "📁 Back to the shared workspace — fresh session.";
        }
        return switchProject(peerKey, argument);
      }
      default:
        // Bare "/<alias> [@branch]" is a shortcut for /project <alias>[@branch].
        if (workspaces?.has(cmd)) {
          return switchProject(peerKey, argument?.startsWith("@") ? `${cmd}${argument}` : cmd);
        }
        // Command-shaped but unknown (a typo like /rest, a habit like /start):
        // redirect to /help — the model answering a failed command as if it
        // were prose is baffling. Slash text that is NOT command-shaped never
        // matches COMMAND_RE and still goes to the model.
        return `I don't know /${cmd} — try /help to see what I can do.`;
    }
  };
}
