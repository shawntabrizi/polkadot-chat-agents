// Per-account background loop: long-poll the bot-core bridge and dispatch each
// inbound message into OpenClaw's agent core via channelRuntime.inbound.run.
// The agent's reply comes back through delivery.deliver -> POST /send.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge, type BridgeClient, type InboundMsg } from "./bridge.js";
import { POLKADOT_CHANNEL_ID, resolvePolkadotAccount, type ResolvedPolkadotAccount } from "./accounts.js";

const POLL_WAIT_SECS = 25;
const MAX_CONCURRENT_DISPATCHES = 4;
const MAX_PENDING_DISPATCHES = 100;
const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_OUTBOUND_MEDIA_PER_REPLY = 4;
const DISPATCH_SHUTDOWN_WAIT_MS = 30_000;
const T3AMS_THREAD_ROOT_RE = /^[0-9a-f]{64}$/i;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// bot-core leases and serializes each T3ams thread independently. Resolve
// OpenClaw's route on the base conversation, then scope memory and dispatch
// ordering to the thread so unrelated threads never block or share context.
export const normalizeT3amsThreadRootId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const root = value.trim().replace(/^0x/i, "");
  return T3AMS_THREAD_ROOT_RE.test(root) ? root.toLowerCase() : null;
};

export const t3amsThreadSessionKey = (routeSessionKey: string, threadRootId?: unknown): string => {
  const root = normalizeT3amsThreadRootId(threadRootId);
  return root == null ? routeSessionKey : `${routeSessionKey}:thread:${root}`;
};

export const t3amsDispatchKey = (chatId: unknown, threadRootId?: unknown): string =>
  JSON.stringify(["polkadot", String(chatId || "invalid"), normalizeT3amsThreadRootId(threadRootId)]);

type DispatchHandle = { done: Promise<void> };
type QueuedDispatch = { run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };

// Preserve per-chat ordering without letting one slow agent turn serialize every
// other chat. `submit` waits for capacity, so a hostile bridge batch cannot make
// this process retain an unbounded number of agent jobs.
class BoundedKeyedDispatcher {
  private readonly queues = new Map<string, QueuedDispatch[]>();
  private readonly ready: string[] = [];
  private readonly readySet = new Set<string>();
  private readonly activeKeys = new Set<string>();
  private readonly capacityWaiters: Array<() => void> = [];
  private readonly abortController = new AbortController();
  private readonly activeTasks = new Set<Promise<void>>();
  private active = 0;
  private pending = 0;
  private closed = false;

  constructor(private readonly maxConcurrent: number, private readonly maxPending: number) {}

  async submit(key: string, run: () => Promise<void>): Promise<DispatchHandle> {
    while (!this.closed && this.pending >= this.maxPending) {
      await new Promise<void>((resolve) => this.capacityWaiters.push(resolve));
    }
    if (this.closed) throw new Error("polkadot dispatcher is closed");

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const done = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    const queue = this.queues.get(key) ?? [];
    queue.push({ run, resolve, reject });
    this.queues.set(key, queue);
    this.pending += 1;
    this.markReady(key);
    this.pump();
    return { done };
  }

  get signal(): AbortSignal { return this.abortController.signal; }

  async close(reason = new Error("polkadot dispatcher stopped")): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort(reason);
    for (const queue of this.queues.values()) {
      for (const task of queue) task.reject(reason);
      this.pending -= queue.length;
    }
    this.queues.clear();
    this.ready.length = 0;
    this.readySet.clear();
    while (this.capacityWaiters.length > 0) this.capacityWaiters.shift()!();
    const active = Promise.allSettled([...this.activeTasks]);
    await Promise.race([active, delay(DISPATCH_SHUTDOWN_WAIT_MS)]);
  }

  private markReady(key: string): void {
    if (this.activeKeys.has(key) || this.readySet.has(key) || !(this.queues.get(key)?.length)) return;
    this.ready.push(key);
    this.readySet.add(key);
  }

  private pump(): void {
    while (!this.closed && this.active < this.maxConcurrent && this.ready.length > 0) {
      const key = this.ready.shift()!;
      this.readySet.delete(key);
      if (this.activeKeys.has(key)) continue;
      const queue = this.queues.get(key);
      const task = queue?.shift();
      if (!task) continue;
      if (queue?.length === 0) this.queues.delete(key);
      this.active += 1;
      this.activeKeys.add(key);
      const running = this.run(key, task);
      this.activeTasks.add(running);
      void running.finally(() => this.activeTasks.delete(running));
    }
  }

  private async run(key: string, task: QueuedDispatch): Promise<void> {
    try {
      await task.run();
      task.resolve();
    } catch (error) {
      task.reject(error);
    } finally {
      this.active -= 1;
      this.pending -= 1;
      this.activeKeys.delete(key);
      this.markReady(key);
      this.releaseCapacity();
      this.pump();
    }
  }

  private releaseCapacity(): void {
    while (this.pending < this.maxPending && this.capacityWaiters.length > 0) this.capacityWaiters.shift()!();
  }
}

type MaterializedAttachments = { notes: string; tempDir?: string };

const extensionForMime = (mime: string): string => {
  const suffix = mime.split("/", 2)[1]?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return suffix || "bin";
};

const attachmentKind = (value: unknown): string =>
  value === "image" || value === "document" || value === "video" || value === "audio" || value === "general" ? value : "file";

const validMime = (value: unknown): string | null => {
  const mime = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/.test(mime)
    ? mime.toLowerCase()
    : null;
};

const attachmentMime = (value: unknown): string => validMime(value) ?? "application/octet-stream";

const channelContextNotes = (value: unknown): string => {
  if (!Array.isArray(value)) return "";
  const lines: string[] = [];
  for (const record of value.slice(0, 64)) {
    if (!record || typeof record !== "object") continue;
    const item = record as { text?: unknown; sender_name?: unknown; sender_xid?: unknown; thread_root_id?: unknown };
    if (typeof item.text !== "string" || !item.text) continue;
    const sender = typeof item.sender_name === "string" && item.sender_name
      ? item.sender_name
      : typeof item.sender_xid === "string" && item.sender_xid
        ? item.sender_xid
        : "channel member";
    const thread = typeof item.thread_root_id === "string" && item.thread_root_id ? `; thread ${item.thread_root_id}` : "";
    lines.push(`[Earlier channel message from ${sender.slice(0, 512)}${thread}]: ${item.text.slice(0, 4096)}`);
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
};

const contentLength = (response: Response): number | null => {
  const value = response.headers.get("content-length");
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const readResponseBytes = async (response: Response, maxBytes: number): Promise<Buffer> => {
  const declared = contentLength(response);
  if (declared != null && declared > maxBytes) throw new Error("attachment exceeds download limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("attachment response has no body");
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error("attachment exceeds download limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received);
};

// The agent only sees text, and the gateway container has no curl/wget for it
// to fetch URLs with — so fetch each attachment from the authenticated bridge
// and hand the agent a local, owner-only file path. The files are scoped to a
// single inbound turn and removed as soon as OpenClaw returns from that turn.
async function materializeAttachments(msg: InboundMsg, bridge: BridgeClient): Promise<MaterializedAttachments> {
  if (!msg.attachments?.length) return { notes: "" };
  const notes: string[] = [];
  let tempDir: string | undefined;
  let totalBytes = 0;

  const ensureTempDir = async (): Promise<string> => {
    if (!tempDir) {
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "polkadot-media-"));
      await fsp.chmod(tempDir, 0o700);
    }
    return tempDir;
  };

  for (const [index, a] of msg.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).entries()) {
    if (!a || typeof a !== "object") {
      notes.push("\n[attachment metadata was invalid]");
      continue;
    }
    const kind = attachmentKind(a.kind);
    const mime = attachmentMime(a.mime);
    // `downloaded` is only a cache-status hint. The bridge's opaque /media
    // URL is authenticated and may materialize a T3ams attachment on demand.
    if (typeof a.url !== "string" || !a.url.startsWith("/media/")) {
      notes.push(`\n[attachment ${kind} (${mime}) could not be downloaded]`);
      continue;
    }
    const advertisedBytes = Number(a.size);
    const remaining = MAX_TOTAL_ATTACHMENT_BYTES - totalBytes;
    if (remaining <= 0 || (Number.isFinite(advertisedBytes) && advertisedBytes > Math.min(MAX_ATTACHMENT_BYTES, remaining))) {
      notes.push(`\n[attachment ${kind} (${mime}) was skipped because it exceeds the attachment limit]`);
      continue;
    }
    try {
      const response = await bridge.fetchMedia(a.url);
      const bytes = await readResponseBytes(response, Math.min(MAX_ATTACHMENT_BYTES, remaining));
      const dir = await ensureTempDir();
      const filePath = path.join(dir, `attachment-${index}.${extensionForMime(mime)}`);
      await fsp.writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
      totalBytes += bytes.byteLength;
      notes.push(`\n[attachment ${kind} from the user, saved at ${filePath} (${mime}, ${bytes.byteLength} bytes) - read that file to view it]`);
    } catch (error) {
      notes.push(`\n[attachment ${kind}: could not be fetched from the bridge]`);
    }
  }
  if (msg.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    notes.push(`\n[${msg.attachments.length - MAX_ATTACHMENTS_PER_MESSAGE} additional attachments were skipped]`);
  }
  return { notes: notes.join(""), tempDir };
}

const cleanupAttachments = async ({ tempDir }: MaterializedAttachments): Promise<void> => {
  if (!tempDir) return;
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
};

// OpenClaw ReplyPayload carries outgoing artifacts as mediaUrl/mediaUrls. The
// bridge purposefully does not accept those host paths directly: copy each
// regular local file into the authenticated, conversation-scoped vault first,
// then reference only that vault path from /send. Remote URLs are intentionally
// not fetched here; doing so would turn a model-generated reply into an SSRF
// capability inside the private bridge network.
type OutboundReplyPayload = {
  text?: unknown;
  // OpenClaw uses this for hidden chain-of-thought payloads. Never turn it
  // into a visible progress frame or a normal chat reply.
  isReasoning?: unknown;
  // A framework may already own a preview message. Carry that immutable edit
  // target through the T3ams bridge.
  editOf?: unknown;
  mediaUrl?: unknown;
  mediaUrls?: unknown;
  mediaType?: unknown;
  mimeType?: unknown;
  mediaMimeType?: unknown;
  contentType?: unknown;
};

const outboundEditOf = (payload: OutboundReplyPayload): string | null => {
  if (!Object.prototype.hasOwnProperty.call(payload, "editOf")) return null;
  const value = payload.editOf;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("polkadot live edit requires a non-empty editOf message id");
  }
  return value.trim();
};

type PreparedOutboundMedia = {
  sourcePath: string;
  vaultPath: string;
  mime: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".text": "text/plain",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
};

const mimeForOutboundMedia = (payload: OutboundReplyPayload, sourcePath: string): string => {
  for (const candidate of [payload.mediaMimeType, payload.mimeType, payload.contentType, payload.mediaType]) {
    const mime = validMime(candidate);
    if (mime != null) return mime;
  }
  return MIME_BY_EXTENSION[path.extname(sourcePath).toLowerCase()] ?? "application/octet-stream";
};

const mediaReferences = (payload: OutboundReplyPayload): string[] => {
  const listed = Array.isArray(payload.mediaUrls) && payload.mediaUrls.length > 0
    ? payload.mediaUrls
    : null;
  if (listed != null) {
    if (listed.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("polkadot reply contains an invalid mediaUrls entry");
    }
    if (listed.length > MAX_OUTBOUND_MEDIA_PER_REPLY) {
      throw new Error(`polkadot reply exceeds ${MAX_OUTBOUND_MEDIA_PER_REPLY} outbound attachments`);
    }
    return listed.map((value) => value.trim());
  }
  if (typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()) return [payload.mediaUrl.trim()];
  return [];
};

// OpenClaw's buffered dispatcher calls a channel delivery function for tool,
// block, and final payloads. Keep the live state local to one leased inbound
// turn: the first accepted status message becomes the only editable bubble,
// while the final answer retains a normal-send fallback.
type OutboundDeliveryInfo = { kind?: unknown };
type T3amsLiveReply = {
  typing: () => Promise<boolean>;
  update: (payload: OutboundReplyPayload, info?: OutboundDeliveryInfo) => Promise<boolean>;
  deliverFinal: (payload: OutboundReplyPayload) => Promise<boolean>;
  // Buffered dispatchers may deliberately absorb delivery errors for progress
  // frames. Surface a terminal failure after they settle so the leased message
  // is not ACKed before an answer has actually landed.
  assertTerminalDelivery: () => void;
};

const MAX_LIVE_UPDATE_CODE_POINTS = 4_096;

const outboundText = (payload: OutboundReplyPayload): string => {
  if (payload.isReasoning === true || typeof payload.text !== "string") return "";
  return payload.text.trim();
};

const visibleLiveText = (payload: OutboundReplyPayload): string => {
  const text = outboundText(payload);
  if (!text) return "";
  const codePoints = Array.from(text);
  return codePoints.length <= MAX_LIVE_UPDATE_CODE_POINTS
    ? text
    : `${codePoints.slice(0, MAX_LIVE_UPDATE_CODE_POINTS).join("")}…`;
};

const isIntermediateDelivery = (info: OutboundDeliveryInfo | undefined): boolean =>
  typeof info?.kind === "string" && info.kind !== "final";

const liveTextForDelivery = (
  payload: OutboundReplyPayload,
  info: OutboundDeliveryInfo | undefined,
): string => {
  if (payload.isReasoning === true) return "";
  // Tool frames may contain arguments, output, or provider detail. Keep the
  // transcript useful without exposing raw tool payloads.
  if (info?.kind === "tool") return "Working with a tool…";
  // Block payloads are response prose; unknown intermediate kinds remain
  // conservative until their display semantics are defined.
  return info?.kind === "block" ? visibleLiveText(payload) : "Working…";
};

export const createT3amsLiveReply = ({
  bridge,
  account,
  chatId,
  replyTo,
  threadRootId,
  deliveryId,
  leaseId,
  log,
}: {
  bridge: BridgeClient;
  account: ResolvedPolkadotAccount;
  chatId: string;
  replyTo: string;
  threadRootId?: string;
  deliveryId?: string;
  leaseId?: string;
  log?: (message: string) => void;
}): T3amsLiveReply => {
  let liveMessageId: string | undefined;
  let liveEditsUnavailable = false;
  let terminal = false;
  let terminalFailure: unknown = null;
  let typingRequest: Promise<boolean> | null = null;
  let liveCapability: "unknown" | "supported" | "unavailable" = "unknown";
  let queued: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queued.then(operation, operation);
    // A failed best-effort progress frame must not block terminal delivery.
    queued = result.then(() => undefined, () => undefined);
    return result;
  };

  const typing = async (): Promise<boolean> => {
    if (liveCapability === "unavailable" || typeof bridge.typing !== "function") return false;
    if (typingRequest != null) return typingRequest;
    typingRequest = bridge.typing(chatId, { deliveryId, leaseId }).then(() => {
      liveCapability = "supported";
      return true;
    }).catch((error) => {
      // The first response is a capability probe. If it is unsupported, keep
      // intermediate output hidden and still send a normal final response.
      if (liveCapability === "unknown") liveCapability = "unavailable";
      log?.(`polkadot typing update unavailable: ${String(error)}`);
      return false;
    }).finally(() => { typingRequest = null; });
    return typingRequest;
  };

  const publishLiveText = async (text: string): Promise<boolean> => {
    const result = liveMessageId == null
      ? await bridge.send(chatId, text, { replyTo, threadRootId, deliveryId, leaseId })
      : await bridge.send(chatId, text, { editOf: liveMessageId, threadRootId, deliveryId, leaseId });
    if (!result.success) {
      // A definitive bridge response means a later final answer must use the
      // normal delivery path rather than rely on another edit.
      liveEditsUnavailable = true;
      log?.(`polkadot live reply unavailable: ${String(result.error ?? "unknown bridge error")}`);
      return false;
    }
    if (liveMessageId == null) {
      const messageId = typeof result.message_id === "string" ? result.message_id.trim() : "";
      if (!messageId) {
        liveEditsUnavailable = true;
        log?.("polkadot live reply did not return a message id");
        return false;
      }
      liveMessageId = messageId;
    }
    return true;
  };

  const deliverNormally = async (payload: OutboundReplyPayload): Promise<boolean> =>
    await deliverOutboundReply({
      bridge,
      account,
      chatId,
      replyTo,
      threadRootId,
      deliveryId,
      leaseId,
      payload,
    });

  return {
    typing,

    update: async (payload, info) => {
      // Preserve an explicit framework-owned preview target. Only a visible
      // block can carry one; raw tool payloads must never select an edit target.
      const explicitEditOf = info?.kind === "block" ? outboundEditOf(payload) : null;
      if (explicitEditOf != null) {
        void typing();
        return enqueue(async () => {
          if (terminal) return false;
          try {
            const visibleReplySent = await deliverNormally(payload);
            if (visibleReplySent) liveMessageId = explicitEditOf;
            return visibleReplySent;
          } catch (error) {
            log?.(`polkadot explicit live reply update failed: ${String(error)}`);
            return false;
          }
        });
      }
      const text = liveTextForDelivery(payload, info);
      if (!text || terminal) return false;
      void typing();
      return enqueue(async () => {
        if (terminal || liveEditsUnavailable) return false;
        if (liveMessageId == null && !(await typing())) return false;
        try {
          return await publishLiveText(text);
        } catch (error) {
          // A thrown request is ambiguous. Keep final delivery retryable.
          log?.(`polkadot live reply update failed: ${String(error)}`);
          return false;
        }
      });
    },

    deliverFinal: async (payload) => await enqueue(async () => {
      if (terminal || payload.isReasoning === true) return false;
      terminal = true;
      try {
        if (outboundEditOf(payload) != null) return await deliverNormally(payload);

        const text = outboundText(payload);
        const hasMedia = mediaReferences(payload).length > 0;
        if (
          liveMessageId != null
          && !liveEditsUnavailable
          && !hasMedia
          && text
          && Array.from(text).length <= MAX_LIVE_UPDATE_CODE_POINTS
        ) {
          const result = await bridge.send(chatId, text, {
            editOf: liveMessageId,
            threadRootId,
            deliveryId,
            leaseId,
          });
          if (result.success) return true;
          // A non-success response proves the edit was not accepted. Fall
          // back to one ordinary final response.
          liveEditsUnavailable = true;
          log?.(`polkadot final live edit unavailable: ${String(result.error ?? "unknown bridge error")}`);
        }
        return await deliverNormally(payload);
      } catch (error) {
        terminalFailure = error;
        throw error;
      }
    }),

    assertTerminalDelivery: () => {
      if (terminalFailure != null) throw terminalFailure;
    },
  };
};

const localMediaPath = (reference: string): string => {
  if (reference.startsWith("file:")) {
    try {
      const url = new URL(reference);
      if (url.protocol !== "file:") throw new Error("not a file URL");
      return fileURLToPath(url);
    } catch {
      throw new Error("polkadot outbound media file URL is invalid");
    }
  }
  if (!path.isAbsolute(reference)) {
    throw new Error("polkadot outbound media must be an absolute local path or file URL");
  }
  return reference;
};

const vaultFileName = (sourcePath: string): string => {
  const raw = path.basename(sourcePath).normalize("NFC");
  const safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 160);
  return safe || "attachment.bin";
};

const prepareOutboundMedia = async (
  payload: OutboundReplyPayload,
  maxBytes: number,
): Promise<PreparedOutboundMedia[]> => {
  const sources = mediaReferences(payload);
  return Promise.all(sources.map(async (reference) => {
    const sourcePath = localMediaPath(reference);
    const stat = await fsp.lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("polkadot outbound media must be a regular local file");
    }
    if (stat.size > maxBytes) {
      throw new Error(`polkadot outbound media exceeds the ${maxBytes}-byte account limit`);
    }
    return {
      sourcePath,
      // A random opaque filename avoids collisions and never exposes the host
      // path through the bridge or the T3ams attachment metadata.
      vaultPath: `openclaw/${randomUUID()}-${vaultFileName(sourcePath)}`,
      mime: mimeForOutboundMedia(payload, sourcePath),
    };
  }));
};

// Read exactly the size validated above. Re-check the opened file's identity
// and size to avoid following a symlink or accepting a file replaced between
// validation and upload.
const readPreparedMedia = async (media: PreparedOutboundMedia, maxBytes: number): Promise<Buffer> => {
  const initial = await fsp.lstat(media.sourcePath);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > maxBytes) {
    throw new Error("polkadot outbound media changed before it could be uploaded");
  }
  const handle = await fsp.open(media.sourcePath, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== initial.size || opened.dev !== initial.dev || opened.ino !== initial.ino) {
      throw new Error("polkadot outbound media changed before it could be uploaded");
    }
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead <= 0) throw new Error("polkadot outbound media ended before it could be uploaded");
      offset += bytesRead;
    }
    const finalStat = await handle.stat();
    if (finalStat.size !== opened.size || finalStat.dev !== opened.dev || finalStat.ino !== opened.ino) {
      throw new Error("polkadot outbound media changed while it was being uploaded");
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

export const deliverOutboundReply = async ({
  bridge,
  account,
  chatId,
  replyTo,
  threadRootId,
  deliveryId,
  leaseId,
  payload,
}: {
  bridge: BridgeClient;
  account: ResolvedPolkadotAccount;
  chatId: string;
  replyTo: string;
  threadRootId?: string;
  deliveryId?: string;
  leaseId?: string;
  payload: OutboundReplyPayload;
}): Promise<boolean> => {
  const text = String(payload.text ?? "").trim();
  const editOf = outboundEditOf(payload);

  if (editOf != null) {
    if (!text) throw new Error("polkadot live edit requires non-empty text");
    if (mediaReferences(payload).length > 0) throw new Error("polkadot live edit cannot include outbound media");
    // Do not add replyTo: bot-core correctly rejects a reply target paired
    // with an edit, and the active delivery lease already binds this edit to
    // its thread lane.
    const result = await bridge.send(chatId, text, { editOf, threadRootId, deliveryId, leaseId });
    if (!result.success) throw new Error(`polkadot /send edit failed: ${result.error ?? "unknown"}`);
    return true;
  }
  const media = await prepareOutboundMedia(payload, account.outboundFileMaxBytes);

  // Preserve the exact text-only behavior used before file delivery existed.
  if (media.length === 0) {
    if (!text) return false;
    const result = await bridge.send(chatId, text, { replyTo, threadRootId, deliveryId, leaseId });
    if (!result.success) throw new Error(`polkadot /send failed: ${result.error ?? "unknown"}`);
    return true;
  }

  // T3ams accepts a caption and reply target with a file. The first artifact
  // carries the text and quote; later artifacts retain an existing thread root
  // only. A top-level reply target is not itself a thread root.
  for (const [index, item] of media.entries()) {
    const bytes = await readPreparedMedia(item, account.outboundFileMaxBytes);
    let uploaded = false;
    try {
      await bridge.putFile(chatId, item.vaultPath, bytes, item.mime);
      uploaded = true;
      const result = await bridge.send(chatId, index === 0 ? text : "", {
        filePath: item.vaultPath,
        ...(index === 0 ? { replyTo } : {}),
        threadRootId,
        deliveryId,
        leaseId,
      });
      if (!result.success) throw new Error(`polkadot file /send failed: ${result.error ?? "unknown"}`);
    } finally {
      // The vault is durable for explicit framework artifacts, but these are
      // transient reply staging files. Once /send finishes it has uploaded the
      // encrypted attachment, so reclaim the vault entry best-effort.
      if (uploaded) await bridge.removeFile(chatId, item.vaultPath).catch(() => undefined);
    }
  }
  return true;
};

export async function startPolkadotGatewayAccount(ctx: any): Promise<void> {
  const account: ResolvedPolkadotAccount = resolvePolkadotAccount({ cfg: ctx.cfg, accountId: ctx.account?.accountId });
  if (!account.enabled) return;
  if (!account.configured) throw new Error(`polkadot account "${account.accountId}" is missing bridgeUrl or bridgeToken`);

  // gateway startup injects the full PluginRuntimeChannel here (typed thin; cast it — as raft does).
  const channelRuntime = ctx.channelRuntime;
  if (!channelRuntime?.inbound?.run) throw new Error("polkadot requires OpenClaw channel runtime (inbound.run)");

  const bridge = createBridge(account.bridgeUrl, account.bridgeToken);
  const dispatcher = new BoundedKeyedDispatcher(MAX_CONCURRENT_DISPATCHES, MAX_PENDING_DISPATCHES);
  ctx.setStatus?.({ accountId: account.accountId, running: true, connected: true, lastStartAt: Date.now(), lastError: null });

  try {
    while (!ctx.abortSignal?.aborted) {
      let batch: InboundMsg[] = [];
      try {
        batch = await bridge.poll(POLL_WAIT_SECS, ctx.abortSignal, MAX_CONCURRENT_DISPATCHES * 2);
      } catch (error) {
        if (ctx.abortSignal?.aborted) break;
        ctx.log?.warn?.(`polkadot poll error: ${String(error)}`);
        await delay(1500);
        continue;
      }
      for (const msg of batch) {
        if (ctx.abortSignal?.aborted) break;
        // Align OpenClaw dispatch lanes with bot-core's per-thread leases.
        // A slow turn in one workspace-channel thread must not mix with or
        // serialize an unrelated thread in the same conversation.
        const chatKey = t3amsDispatchKey(msg.chat_id, msg.thread_root_id);
        const { done } = await dispatcher.submit(
          chatKey,
          () => processDelivery(ctx, channelRuntime, account, bridge, msg, dispatcher.signal),
        );
        // processDelivery records and logs failures. Keep this defensive catch
        // so a future change cannot turn a rejected task into an unhandled one.
        void done.catch((error) => ctx.log?.warn?.(`polkadot dispatch task failed: ${String(error)}`));
      }
    }
  } finally {
    await dispatcher.close();
    ctx.setStatus?.({ accountId: account.accountId, running: false, connected: false, lastStopAt: Date.now() });
  }
}

async function processDelivery(
  ctx: any,
  channelRuntime: any,
  account: ResolvedPolkadotAccount,
  bridge: BridgeClient,
  msg: InboundMsg,
  signal: AbortSignal,
): Promise<void> {
  const lease = startLeaseKeeper(bridge, msg, signal);
  try {
    if (signal.aborted) return;
    try {
      await dispatchInbound(ctx, channelRuntime, account, bridge, msg, signal);
    } catch (error) {
      // OpenClaw can lose an optimistic session commit immediately after a turn.
      // Retrying once is safe because no bridge acknowledgement was sent yet.
      if (!/initialization conflicted/i.test(String(error))) throw error;
      await delay(1000);
      if (signal.aborted) return;
      await dispatchInbound(ctx, channelRuntime, account, bridge, msg, signal);
    }
    if (signal.aborted) return;
    await lease.renewNow();
    if (signal.aborted) return;
    if (msg.delivery_id && msg.lease_id) await acknowledgeWithRetry(bridge, msg.delivery_id, msg.lease_id);
  } catch (error) {
    // Do not acknowledge a failed handoff. The lease will expire and bot-core
    // will redeliver it instead of silently discarding the user's message.
    ctx.log?.warn?.(`polkadot dispatch error: ${String(error)}`);
  } finally {
    lease.stop();
  }
}

type LeaseKeeper = { renewNow: () => Promise<void>; stop: () => void };

// Renew at one-third of the advertised lease, capped so a normal five-minute
// lease doesn't create needless bridge traffic. The final synchronous renewal
// proves ownership immediately before ACKing a completed agent handoff.
function startLeaseKeeper(bridge: BridgeClient, msg: InboundMsg, signal: AbortSignal): LeaseKeeper {
  if (!msg.delivery_id || !msg.lease_id) return { renewNow: async () => {}, stop: () => {} };
  const advertised = Number(msg.lease_ms);
  const leaseMs = Number.isSafeInteger(advertised) && advertised >= 1_000 ? advertised : 300_000;
  const intervalMs = Math.max(250, Math.min(60_000, Math.floor(leaseMs / 3)));
  let stopped = false;
  let renewing: Promise<void> | null = null;

  const renew = async () => {
    if (stopped || signal.aborted) return;
    if (renewing) return renewing;
    renewing = bridge.renew(msg.delivery_id!, msg.lease_id!).finally(() => { renewing = null; });
    return renewing;
  };
  const timer = setInterval(() => { void renew().catch(() => {}); }, intervalMs);
  return {
    renewNow: renew,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}

async function acknowledgeWithRetry(bridge: BridgeClient, deliveryId: string, leaseId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await bridge.ack(deliveryId, leaseId);
      return;
    } catch (error) {
      lastError = error;
      await delay(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("inbound acknowledgement failed");
}

export async function dispatchInbound(
  ctx: any,
  channelRuntime: any,
  account: ResolvedPolkadotAccount,
  bridge: BridgeClient,
  msg: InboundMsg,
  signal: AbortSignal,
): Promise<void> {
  const chatId = msg.chat_id;
  const threadRootId = typeof msg.thread_root_id === "string" ? msg.thread_root_id : undefined;
  const isChannel = msg.conversation_type === "channel";
  const senderId = typeof msg.sender_xid === "string" ? msg.sender_xid : chatId;
  const senderName = typeof msg.sender_name === "string" && msg.sender_name ? msg.sender_name : senderId;
  const materialized = await materializeAttachments(msg, bridge);
  try {
    const route = channelRuntime.routing.resolveAgentRoute({
      cfg: ctx.cfg,
      channel: POLKADOT_CHANNEL_ID,
      accountId: account.accountId,
      peer: { kind: "direct", id: chatId },
    });
    const routeSessionKey = t3amsThreadSessionKey(route.sessionKey, threadRootId);
    const storePath = channelRuntime.session.resolveStorePath(ctx.cfg.session?.store, { agentId: route.agentId });
    const liveReply = createT3amsLiveReply({
      bridge,
      account,
      chatId,
      replyTo: msg.message_id,
      threadRootId,
      deliveryId: msg.delivery_id,
      leaseId: msg.lease_id,
      log: (message) => ctx.log?.warn?.(message),
    });
    // Keep the operation visible when OpenClaw begins work before it emits its
    // first buffered callback. The capability probe is strictly best-effort.
    void liveReply.typing();

    await channelRuntime.inbound.run({
      channel: POLKADOT_CHANNEL_ID,
      accountId: account.accountId,
      raw: msg,
      adapter: {
        ingest: () => ({
          id: msg.message_id || randomUUID(),
          timestamp: Date.now(),
          rawText: msg.text,
          textForAgent: msg.text + channelContextNotes(msg.channel_context) + materialized.notes,
          textForCommands: msg.text,
          raw: msg,
        }),
        resolveTurn: (input: any) => {
          const ctxPayload = channelRuntime.inbound.buildContext({
            channel: POLKADOT_CHANNEL_ID,
            accountId: account.accountId,
            provider: POLKADOT_CHANNEL_ID,
            surface: POLKADOT_CHANNEL_ID,
            messageId: input.id,
            timestamp: input.timestamp,
            from: `polkadot:${senderId}`,
            sender: { id: senderId, name: senderName },
            conversation: { kind: isChannel ? "group" : "direct", id: chatId, label: chatId },
            route: {
              agentId: route.agentId,
              accountId: account.accountId,
              routeSessionKey,
              dispatchSessionKey: routeSessionKey,
            },
            reply: { to: `polkadot:${chatId}`, replyToId: input.id },
            message: { rawBody: input.rawText, bodyForAgent: input.textForAgent, commandBody: input.textForCommands },
          });
          return {
            cfg: ctx.cfg,
            channel: POLKADOT_CHANNEL_ID,
            accountId: account.accountId,
            agentId: route.agentId,
            routeSessionKey,
            storePath,
            ctxPayload,
            recordInboundSession: channelRuntime.session.recordInboundSession,
            dispatchReplyWithBufferedBlockDispatcher: channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
            // Buffered delivery emits tool, block, and final payloads. Keep
            // progress in one leased bridge-owned bubble, then edit it in
            // place for the terminal response when the operation plane permits.
            delivery: {
              deliver: async (payload: any, info?: OutboundDeliveryInfo) => {
                if (signal.aborted) throw new Error("polkadot dispatcher stopped");
                const outbound = (payload ?? {}) as OutboundReplyPayload;
                const visibleReplySent = isIntermediateDelivery(info)
                  ? await liveReply.update(outbound, info)
                  : await liveReply.deliverFinal(outbound);
                return { visibleReplySent };
              },
              onError: (error: unknown) => ctx.log?.warn?.(`polkadot deliver failed: ${String(error)}`),
            },
            record: { onRecordError: (error: unknown) => ctx.log?.warn?.(`polkadot session record failed: ${String(error)}`) },
          };
        },
      },
    });
    // OpenClaw's buffered dispatcher may catch delivery errors so one failed
    // progress frame does not abort its stream. A failed final is different:
    // leave the lease unacknowledged for a safe redelivery.
    liveReply.assertTerminalDelivery();
  } finally {
    await cleanupAttachments(materialized);
  }
}
