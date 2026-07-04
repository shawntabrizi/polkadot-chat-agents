// Thin HTTP client for the bot-core bridge (the Polkadot transport daemon).
// Contract: GET /health, GET /inbound?wait=<secs> (long-poll), POST /send {chat_id,text}.

export type InboundMsg = { chat_id: string; text: string; message_id: string };
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
