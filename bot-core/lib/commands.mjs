// In-chat slash commands for the brains bot-core itself hosts (direct CLI
// brains). Pure logic over injected state so it can be unit-tested: the caller
// provides the per-peer history/model maps and environment facts.
//
// Contract: returns a reply string for command-shaped input (known commands
// act, unknown ones redirect to /help), and null for anything that is not
// command-shaped — that text belongs to the model.

const COMMAND_RE = /^\/([a-z]+)(?:\s+(\S+))?\s*$/i;

export function createCommandHandler({ aiHistory, peerModelOverrides, defaultModel, username, chainConnected, trimOverrides = () => {} }) {
  return (peerKey, text) => {
    const m = COMMAND_RE.exec(text);
    if (!m) return null;
    const [, cmd, argument] = m;
    switch (cmd.toLowerCase()) {
      case "help":
        return [
          "Commands:",
          "/reset — forget our conversation so far",
          "/model — show the model answering you (/model <name> to switch, /model default to go back)",
          "/ping — check the bot is alive",
        ].join("\n");
      case "reset":
        aiHistory.delete(peerKey);
        return "🧹 Fresh start — I've forgotten our conversation.";
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
      default:
        // Command-shaped but unknown (a typo like /rest, a habit like /start):
        // redirect to /help — the model answering a failed command as if it
        // were prose is baffling. Slash text that is NOT command-shaped never
        // matches COMMAND_RE and still goes to the model.
        return `I don't know /${cmd.toLowerCase()} — try /help to see what I can do.`;
    }
  };
}
