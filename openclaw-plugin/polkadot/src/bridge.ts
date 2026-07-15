// Thin HTTP client for the bot-core bridge (the Polkadot transport daemon).
// Contract: authenticated GET /health, leased GET /inbound?wait=<secs>,
// POST /inbound/ack, POST /send {chat_id,text?,file_path?,reply_to?,edit_of?,thread_root_id?,delivery_id?,lease_id?},
// GET/PUT/DELETE /files/:chat/:path (peer-scoped artifact vault), and GET
// /media/:id (authenticated attachment retrieval, cached or on-demand).

// Attachment metadata as bot-core exposes it. `url` is an authenticated,
// opaque bridge capability; it may download into bot-core's private cache on
// first use. `downloaded` is only an advisory cache-status bit.
export type InboundAttachment = {
  id: string;
  kind: "image" | "document" | "video" | "audio" | "general";
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  peaks?: number[];
  downloaded: boolean;
  url?: string;
  error?: string;
};

export type InboundMsg = {
  chat_id: string;
  text: string;
  message_id: string;
  // A leased delivery remains in bot-core until this id is acknowledged after
  // OpenClaw has accepted the turn. It is deliberately separate from the app
  // message id, which is used for conversation/session identity.
  delivery_id?: string;
  // Lease ownership prevents a worker whose lease expired from acknowledging a
  // redelivery that another harness instance now owns.
  lease_id?: string;
  // The adapter renews long-running deliveries before this interval elapses.
  lease_ms?: number;
  // present for non-plain-text kinds: "richText" | "reply" | "edited"
  kind?: string;
  reply_to?: string;
  // T3ams carries this for a threaded prompt. It is optional on the
  // Polkadot-app transport and safe for adapters to forward unchanged.
  thread_root_id?: string;
  conversation_type?: "dm" | "channel";
  sender_xid?: string;
  sender_name?: string;
  workspace_id?: string;
  channel_id?: string;
  edit_of?: string;
  attachments?: InboundAttachment[];
  channel_context?: Array<{
    message_id: string;
    sender_xid: string;
    sender_name?: string;
    text: string;
    thread_root_id?: string;
  }>;
};
export type SendResult = { success: boolean; message_id?: string; error?: string };
export type ProactiveRequestOptions = {
  // Send the separately-configured T3ams proactive capability header. This
  // is for framework-originated work with no leased inbound delivery; normal
  // gateway replies continue to send their delivery/lease pair instead.
  proactive?: boolean;
};
export type BridgeLeaseOptions = {
  // Bind a bridge activity signal to the currently leased inbound delivery.
  // T3ams requires the pair for worker activity; non-leased calls omit both.
  deliveryId?: string;
  leaseId?: string;
};
export type BridgeActivityOptions = BridgeLeaseOptions & ProactiveRequestOptions;
export type SendOptions = {
  replyTo?: string;
  // Replace a prior bot-issued text message. The bridge rejects an edit paired
  // with a reply target or a file, but exposing the field lets a framework
  // forward live frames without hand-rolling requests.
  editOf?: string;
  threadRootId?: string | null;
  // Bind a reply to the currently leased inbound delivery. Both values are
  // omitted for non-leased sends; the bridge validates an active pair.
  deliveryId?: string;
  leaseId?: string;
  // A vault-relative path previously written with putFile for this exact chat.
  // The bridge never accepts a host filesystem path in /send.
  filePath?: string;
} & ProactiveRequestOptions;

export type PutFileResult = {
  success: boolean;
  path?: string;
  mime?: string;
  size?: number;
  error?: string;
};

export type BridgeClient = ReturnType<typeof createBridge>;

type BridgeResponse = { success?: boolean; error?: string; [key: string]: unknown };

const responseJson = async <T>(response: Response): Promise<T> => {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`bridge returned invalid JSON (HTTP ${response.status})`);
  }
};

const requireSuccess = async (response: Response, operation: string): Promise<BridgeResponse> => {
  const data = await responseJson<BridgeResponse>(response);
  if (!response.ok || data.success !== true) {
    throw new Error(`${operation} failed: ${String(data.error ?? `HTTP ${response.status}`)}`);
  }
  return data;
};

export function createBridge(baseUrl: string, token: string, proactiveToken = "") {
  const base = baseUrl.replace(/\/+$/, "");
  if (!token?.trim()) throw new Error("polkadot bridge token is required");
  const headers = { authorization: `Bearer ${token}` };
  const proactive = proactiveToken.trim();
  const proactiveHeaders = (requested: boolean): Record<string, string> => {
    if (!requested) return {};
    if (!proactive) throw new Error("polkadot proactive bridge token is not configured");
    return { "x-bridge-proactive-token": proactive };
  };
  const fileUrl = (chatId: string, filePath: string): string => {
    if (!chatId) throw new Error("cannot access a file vault with an empty chat id");
    if (!filePath) throw new Error("cannot access an empty file path");
    // Encode the whole vault-relative path so a slash remains part of the
    // bridge's path argument rather than being mistaken for an HTTP segment.
    return `${base}/files/${encodeURIComponent(chatId)}/${encodeURIComponent(filePath)}`;
  };
  return {
    health: async (): Promise<{ ok?: boolean; account?: string; identifierKey?: string; username?: string }> => {
      const response = await fetch(`${base}/health`, { headers });
      return responseJson(response);
    },

    // Long-poll for inbound messages; returns [] on timeout.
    poll: async (waitSecs: number, signal?: AbortSignal, limit = 8): Promise<InboundMsg[]> => {
      const cappedLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 1));
      const res = await fetch(`${base}/inbound?wait=${waitSecs}&limit=${cappedLimit}`, { headers, signal });
      if (!res.ok) throw new Error(`inbound poll HTTP ${res.status}`);
      const data = await responseJson<unknown>(res);
      return Array.isArray(data) ? (data as InboundMsg[]) : [];
    },

    ack: async (deliveryId: string, leaseId: string): Promise<void> => {
      if (!deliveryId) throw new Error("cannot acknowledge an empty delivery id");
      if (!leaseId) throw new Error("cannot acknowledge an empty lease id");
      const res = await fetch(`${base}/inbound/ack`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ delivery_id: deliveryId, lease_id: leaseId }),
      });
      const data = await requireSuccess(res, "inbound acknowledgement");
      if (data.acknowledged !== 1) throw new Error("inbound acknowledgement lost its lease");
    },

    renew: async (deliveryId: string, leaseId: string): Promise<void> => {
      if (!deliveryId) throw new Error("cannot renew an empty delivery id");
      if (!leaseId) throw new Error("cannot renew an empty lease id");
      const res = await fetch(`${base}/inbound/renew`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ delivery_id: deliveryId, lease_id: leaseId }),
      });
      const data = await requireSuccess(res, "inbound lease renewal");
      if (data.renewed !== 1) throw new Error("inbound lease renewal lost its lease");
    },

    send: async (chatId: string, text: string, options: SendOptions = {}): Promise<SendResult> => {
      if (typeof options.editOf === "string" && typeof options.replyTo === "string") {
        throw new Error("polkadot bridge edits cannot include replyTo");
      }
      if (typeof options.editOf === "string" && typeof options.filePath === "string") {
        throw new Error("polkadot bridge edits cannot include filePath");
      }
      const body = {
        chat_id: chatId,
        text,
        ...(typeof options.filePath === "string" ? { file_path: options.filePath } : {}),
        ...(typeof options.replyTo === "string" ? { reply_to: options.replyTo } : {}),
        ...(typeof options.editOf === "string" ? { edit_of: options.editOf } : {}),
        ...(typeof options.threadRootId === "string" ? { thread_root_id: options.threadRootId } : {}),
        ...(typeof options.deliveryId === "string" ? { delivery_id: options.deliveryId } : {}),
        ...(typeof options.leaseId === "string" ? { lease_id: options.leaseId } : {}),
      };
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...headers, ...proactiveHeaders(options.proactive === true), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await responseJson<SendResult>(res);
      if (!res.ok || data.success !== true) return { success: false, error: data.error ?? `HTTP ${res.status}` };
      return data;
    },

    // Store raw bytes under the bridge's conversation-scoped artifact vault.
    // This is deliberately separate from /send so a harness can never hand
    // bot-core a path from the OpenClaw host filesystem.
    putFile: async (
      chatId: string,
      filePath: string,
      bytes: Uint8Array,
      mime = "application/octet-stream",
      { overwrite = false }: { overwrite?: boolean } = {},
    ): Promise<PutFileResult> => {
      const url = `${fileUrl(chatId, filePath)}${overwrite ? "?overwrite=1" : ""}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "content-type": mime },
        body: bytes,
      });
      const data = await responseJson<PutFileResult>(res);
      if (!res.ok || data.success !== true) {
        throw new Error(`file upload failed: ${String(data.error ?? `HTTP ${res.status}`)}`);
      }
      return data;
    },

    removeFile: async (chatId: string, filePath: string): Promise<void> => {
      const res = await fetch(fileUrl(chatId, filePath), { method: "DELETE", headers });
      await requireSuccess(res, "file removal");
    },

    react: async (
      chatId: string,
      messageId: string,
      emoji: string,
      remove = false,
      options: BridgeActivityOptions = {},
    ): Promise<void> => {
      const res = await fetch(`${base}/react`, {
        method: "POST",
        headers: { ...headers, ...proactiveHeaders(options.proactive === true), "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          emoji,
          remove,
          ...(typeof options.deliveryId === "string" ? { delivery_id: options.deliveryId } : {}),
          ...(typeof options.leaseId === "string" ? { lease_id: options.leaseId } : {}),
        }),
      });
      await requireSuccess(res, "reaction");
    },

    typing: async (chatId: string, options: BridgeActivityOptions = {}): Promise<void> => {
      const res = await fetch(`${base}/typing`, {
        method: "POST",
        headers: { ...headers, ...proactiveHeaders(options.proactive === true), "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          ...(typeof options.deliveryId === "string" ? { delivery_id: options.deliveryId } : {}),
          ...(typeof options.leaseId === "string" ? { lease_id: options.leaseId } : {}),
        }),
      });
      await requireSuccess(res, "typing");
    },

    fetchMedia: async (relativePath: string, signal?: AbortSignal): Promise<Response> => {
      if (!relativePath.startsWith("/media/")) throw new Error("invalid bridge media path");
      const res = await fetch(`${base}${relativePath}`, { headers, signal });
      if (!res.ok) throw new Error(`media download HTTP ${res.status}`);
      return res;
    },
  };
}
