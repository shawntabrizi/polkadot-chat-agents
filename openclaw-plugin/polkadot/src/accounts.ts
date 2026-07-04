// Account resolution for the polkadot channel. Reads cfg.channels.polkadot
// (single default account, or accounts.<id>) and the POLKADOT_BRIDGE_URL env.
// Kept self-contained (no SDK account-helper coupling) for portability.

export const POLKADOT_CHANNEL_ID = "polkadot";

export type ResolvedPolkadotAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  bridgeUrl: string;
  dmPolicy: "open" | "pairing" | "closed";
  allowFrom: string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const channelCfg = (cfg: any) => cfg?.channels?.[POLKADOT_CHANNEL_ID] ?? {};
const normId = (s: unknown) => String(s).trim().replace(/^0x/i, "").toLowerCase();

export function resolvePolkadotAccount({ cfg, accountId }: { cfg: any; accountId?: string | null }): ResolvedPolkadotAccount {
  const root = channelCfg(cfg);
  const id = accountId ?? root.defaultAccount ?? "default";
  const acct = root.accounts?.[id] ?? {};
  const bridgeUrl = acct.bridgeUrl ?? root.bridgeUrl ?? process.env.POLKADOT_BRIDGE_URL ?? "http://127.0.0.1:8799";
  const dmPolicy = (acct.dmPolicy ?? root.dmPolicy ?? "pairing") as ResolvedPolkadotAccount["dmPolicy"];
  const allowFrom = (acct.allowFrom ?? root.allowFrom ?? []).map(normId);
  const enabled = acct.enabled ?? root.enabled ?? true;
  return { accountId: id, name: acct.name ?? root.name, enabled, configured: Boolean(bridgeUrl), bridgeUrl, dmPolicy, allowFrom };
}

export function listPolkadotAccountIds(cfg: any): string[] {
  const ids = Object.keys(channelCfg(cfg).accounts ?? {});
  return ids.length ? ids : ["default"];
}

export function resolveDefaultPolkadotAccountId(cfg: any): string {
  return channelCfg(cfg).defaultAccount ?? "default";
}
