// User-facing durable-file commands. This deliberately sits above a generic
// peer-scoped store so every brain (echo, direct CLI, and HTTP bridge) gets
// the same authorization boundary before it sees a message.

const humanSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
};

const fileHelp = [
  "Files:",
  "/file put <path> - send one attachment with this caption to save it",
  "/file get <path> - send a saved file back to this chat",
  "/file ls [prefix] - list saved files",
  "/file info <path> - show a file's details",
  "/file rm <path> - remove a saved file",
].join("\n");

const parseCommand = (text) => {
  if (typeof text !== "string") return null;
  const match = /^\/file(?:\s+([\s\S]*?))?\s*$/i.exec(text);
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { action: "help", argument: "" };
  const separator = rest.search(/\s/);
  if (separator < 0) return { action: rest.toLowerCase(), argument: "" };
  return { action: rest.slice(0, separator).toLowerCase(), argument: rest.slice(separator).trim() };
};

const putArgument = (argument) => {
  const forceMatch = /(?:^|\s)--force\s*$/.exec(argument);
  const path = forceMatch ? argument.slice(0, forceMatch.index).trim() : argument.trim();
  if (!path) throw new Error("Usage: /file put <path> (attach exactly one file). Add --force to replace an existing file.");
  return { path, overwrite: Boolean(forceMatch) };
};

const fileError = (error) => {
  switch (error?.code) {
    case "FILE_STORE_EXISTS":
      return "A saved file already exists at that path. Use /file put <path> --force to replace it.";
    case "FILE_STORE_FILE_TOO_LARGE":
      return "That file is larger than this bot's durable-file limit.";
    case "FILE_STORE_FULL":
    case "FILE_STORE_ENTRY_LIMIT":
    case "FILE_STORE_PEER_FULL":
    case "FILE_STORE_PEER_ENTRY_LIMIT":
      return "This bot's durable file vault is full. Remove an old file and try again.";
    case "FILE_STORE_PATH_INVALID":
      return "That file path is not allowed. Use a relative path without .. or backslashes.";
    default:
      return `File operation failed: ${String(error?.message ?? error)}`;
  }
};

export const createFileCommandHandler = ({ fileStore, sendAttachment, log = () => {} }) => {
  if (!fileStore || typeof fileStore.putFromPath !== "function") throw new Error("fileStore is required");
  if (typeof sendAttachment !== "function") throw new Error("sendAttachment is required");

  return async (peerHex, message) => {
    const command = parseCommand(message?.text);
    if (!command) return null;
    const done = (reply = null) => ({ handled: true, reply });
    try {
      switch (command.action) {
        case "help":
        case "":
          return done(fileHelp);
        case "put": {
          const { path, overwrite } = putArgument(command.argument);
          const attachments = message?.attachments ?? [];
          if (attachments.length !== 1) return done("Usage: /file put <path> with exactly one attached file.");
          const attachment = attachments[0];
          if (!attachment.downloaded || !attachment.path) {
            return done(`That attachment could not be saved because its download failed: ${attachment.error ?? "unknown error"}`);
          }
          const saved = fileStore.putFromPath(peerHex, path, attachment.path, {
            mime: attachment.mime,
            overwrite,
          });
          return done(`Saved ${saved.path} (${humanSize(saved.size)}).`);
        }
        case "get": {
          if (!command.argument) return done("Usage: /file get <path>");
          const file = fileStore.get(peerHex, command.argument);
          if (!file) return done("No saved file exists at that path.");
          try {
            await sendAttachment(peerHex, {
              filePath: file.filePath,
              mime: file.mime,
              size: file.size,
              text: file.path,
            });
            log("BOT_FILE_DELIVERED", { peer: String(peerHex).replace(/^0x/i, "").slice(0, 16), path: file.path, bytes: file.size });
            return done();
          } catch (error) {
            log("BOT_FILE_DELIVERY_FAILED", { peer: String(peerHex).replace(/^0x/i, "").slice(0, 16), path: file.path, error: String(error?.message ?? error) });
            return done(`I could not deliver that file: ${String(error?.message ?? error)}`);
          }
        }
        case "ls":
        case "list": {
          const files = fileStore.list(peerHex, command.argument);
          if (files.length === 0) return done("No saved files.");
          const lines = files.slice(0, 50).map((file) => `${file.path} (${humanSize(file.size)})`);
          if (files.length > lines.length) lines.push(`... and ${files.length - lines.length} more`);
          return done(lines.join("\n"));
        }
        case "info": {
          if (!command.argument) return done("Usage: /file info <path>");
          const file = fileStore.get(peerHex, command.argument);
          if (!file) return done("No saved file exists at that path.");
          return done(`${file.path}\n${file.mime}, ${humanSize(file.size)}\nSaved ${new Date(file.updatedAt).toISOString()}`);
        }
        case "rm":
        case "remove":
        case "delete": {
          if (!command.argument) return done("Usage: /file rm <path>");
          if (!fileStore.remove(peerHex, command.argument)) return done("No saved file exists at that path.");
          return done("Saved file removed.");
        }
        default:
          return done(fileHelp);
      }
    } catch (error) {
      return done(fileError(error));
    }
  };
};
