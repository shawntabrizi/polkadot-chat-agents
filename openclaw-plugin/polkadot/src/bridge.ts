// Thin HTTP client for the bot-core bridge (the Polkadot transport daemon).
// Contract: GET /health, GET /inbound?wait=<secs> (long-poll), POST /send
// {chat_id,text,reply_to?,edit_of?}, GET /media/:id (downloaded attachments).

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
  // present for non-plain-text kinds: "richText" | "reply" | "edited"
  kind?: string;
  reply_to?: string;
  edit_of?: string;
  attachments?: InboundAttachment[];
};
export type SendResult = { success: boolean; message_id?: string; error?: string };

export function createBridge(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    health: (): Promise<{ ok?: boolean; account?: string; identifierKey?: string; username?: string }> =>
      fetch(`${base}/health`).then((r) => r.json()),

    // Long-poll for inbound messages; returns [] on timeout.
    poll: async (waitSecs: number, signal?: AbortSignal): Promise<InboundMsg[]> => {
      const res = await fetch(`${base}/inbound?wait=${waitSecs}`, { signal });
      if (!res.ok) throw new Error(`inbound poll HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? (data as InboundMsg[]) : [];
    },

    send: async (chatId: string, text: string): Promise<SendResult> => {
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      return res.json();
    },
  };
}
