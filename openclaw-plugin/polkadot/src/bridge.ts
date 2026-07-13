// Thin HTTP client for the bot-core bridge (the Polkadot transport daemon).
// Contract: authenticated GET /health, leased GET /inbound?wait=<secs>,
// POST /inbound/ack, POST /send {chat_id,text,reply_to?,edit_of?}, and
// GET /media/:id (downloaded attachments).

// Attachment metadata as bot-core exposes it: bytes are already downloaded on
// the bot-core side and served at `url` (relative to the bridge base URL).
export type InboundAttachment = {
  id: string;
  kind: "image" | "video" | "general";
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
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
  edit_of?: string;
  attachments?: InboundAttachment[];
};
export type SendResult = { success: boolean; message_id?: string; error?: string };

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

export function createBridge(baseUrl: string, token: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (!token?.trim()) throw new Error("polkadot bridge token is required");
  const headers = { authorization: `Bearer ${token}` };
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

    send: async (chatId: string, text: string): Promise<SendResult> => {
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const data = await responseJson<SendResult>(res);
      if (!res.ok || data.success !== true) return { success: false, error: data.error ?? `HTTP ${res.status}` };
      return data;
    },

    react: async (chatId: string, messageId: string, emoji: string, remove = false): Promise<void> => {
      const res = await fetch(`${base}/react`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, emoji, remove }),
      });
      await requireSuccess(res, "reaction");
    },

    fetchMedia: async (relativePath: string, signal?: AbortSignal): Promise<Response> => {
      if (!relativePath.startsWith("/media/")) throw new Error("invalid bridge media path");
      const res = await fetch(`${base}${relativePath}`, { headers, signal });
      if (!res.ok) throw new Error(`media download HTTP ${res.status}`);
      return res;
    },
  };
}
