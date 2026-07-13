// Account resolution for the polkadot channel. Reads cfg.channels.polkadot
// (single default account, or accounts.<id>) and the bridge URL/token env.
// Kept self-contained (no SDK account-helper coupling) for portability.

export const POLKADOT_CHANNEL_ID = "polkadot";
const DEFAULT_OUTBOUND_FILE_MAX_BYTES = 25 * 1024 * 1024;

export type ResolvedPolkadotAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  bridgeUrl: string;
  bridgeToken: string;
  // Per-artifact limit before bytes are copied into the authenticated bridge
  // vault. Keep this aligned with T3ams' default attachment admission limit.
  outboundFileMaxBytes: number;
  dmPolicy: "open" | "pairing" | "allowlist" | "closed";
  allowFrom: string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const channelCfg = (cfg: any) => cfg?.channels?.[POLKADOT_CHANNEL_ID] ?? {};
const normId = (s: unknown) => String(s).trim().replace(/^0x/i, "").toLowerCase();
const positiveBytes = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_OUTBOUND_FILE_MAX_BYTES
    ? parsed
    : fallback;
};

export function resolvePolkadotAccount({ cfg, accountId }: { cfg: any; accountId?: string | null }): ResolvedPolkadotAccount {
  const root = channelCfg(cfg);
  const id = accountId ?? root.defaultAccount ?? "default";
  const acct = root.accounts?.[id] ?? {};
  const bridgeUrl = acct.bridgeUrl ?? root.bridgeUrl ?? process.env.POLKADOT_BRIDGE_URL ?? "http://127.0.0.1:8799";
  const bridgeToken = String(acct.bridgeToken ?? root.bridgeToken ?? process.env.POLKADOT_BRIDGE_TOKEN ?? "").trim();
  const outboundFileMaxBytes = positiveBytes(
    acct.outboundFileMaxBytes ?? root.outboundFileMaxBytes ?? process.env.POLKADOT_OUTBOUND_FILE_MAX_BYTES,
    DEFAULT_OUTBOUND_FILE_MAX_BYTES,
  );
  const dmPolicy = (acct.dmPolicy ?? root.dmPolicy ?? "pairing") as ResolvedPolkadotAccount["dmPolicy"];
  const allowFrom = (acct.allowFrom ?? root.allowFrom ?? []).map(normId);
  const enabled = acct.enabled ?? root.enabled ?? true;
  return {
    accountId: id,
    name: acct.name ?? root.name,
    enabled,
    configured: Boolean(bridgeUrl && bridgeToken),
    bridgeUrl,
    bridgeToken,
    outboundFileMaxBytes,
    dmPolicy,
    allowFrom,
  };
}

export function listPolkadotAccountIds(cfg: any): string[] {
  const ids = Object.keys(channelCfg(cfg).accounts ?? {});
  return ids.length ? ids : ["default"];
}

export function resolveDefaultPolkadotAccountId(cfg: any): string {
  return channelCfg(cfg).defaultAccount ?? "default";
}
