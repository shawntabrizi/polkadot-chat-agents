// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `@t3ams/host` for an agent running in Node.
 *
 * The T3ams app reaches every host capability through this one module. The
 * runtime build aliases `@t3ams/host` here and re-exports the real module for
 * everything that does not depend on a host (network registry, chain client
 * cache, tx-signer helpers), replacing only what a host would answer:
 *
 * - `isInHost()` is true, so the app keeps its durable state in the host
 *   key-value store (here a file owned by the bot) and opens its MLS keystore
 *   on that store instead of IndexedDB, which Node does not have.
 * - `deriveEntropy` derives from the bot's seed, the way a host derives from
 *   its wallet, so the vault key and identity survive restarts.
 * - Chain clients always open a direct WebSocket: there is no host bridge.
 * - The root-account signer (identity attestation) is the bot's own account.
 * - Permission and allowance prompts report "granted": the operator funded the
 *   bot's account out of band, and there is nobody to prompt.
 */

import {
  getOrCreateClient as realGetOrCreateClient,
  type HostLocalStorage,
} from "@t3ams-real/host";
import type { PolkadotClient } from "polkadot-api";
import { agentHost } from "./agent-host.ts";

export * from "@t3ams-real/host";

export function isInHost(): boolean {
  return true;
}

export function isInsideContainerSync(): boolean {
  return true;
}

export function canOpenDirectSocket(): boolean {
  return true;
}

export function getOrCreateClient(
  genesis: `0x${string}`,
  wsFallback: string,
  options: Parameters<typeof realGetOrCreateClient>[2] = {},
): Promise<PolkadotClient> {
  return realGetOrCreateClient(genesis, wsFallback, { ...options, inHost: () => false });
}

export async function deriveEntropy(
  context: Uint8Array,
): Promise<{ ok: true; value: Uint8Array } | { ok: false; error: Error }> {
  try {
    return { ok: true, value: await agentHost().deriveEntropy(context) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function getHostLocalStorage(): Promise<HostLocalStorage> {
  return agentHost().storage;
}

export async function getAccountsProvider(): Promise<unknown> {
  const { signRootBytes } = agentHost();
  return {
    getLegacyAccountSigner: () => ({ signBytes: signRootBytes }),
  };
}

export async function requestHostGrant(): Promise<boolean> {
  return true;
}

export async function requestRemoteOriginPermission(): Promise<boolean> {
  return true;
}

export async function requestHostAllowances<T extends string>(
  tags: readonly T[],
): Promise<Record<T, boolean>> {
  return Object.fromEntries(tags.map((tag) => [tag, true])) as Record<T, boolean>;
}

export async function requestMediaPermissions(): Promise<boolean> {
  return false;
}

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export async function getNotificationManager(): Promise<null> {
  return null;
}

export async function getHostProvider(): Promise<null> {
  return null;
}

export async function getPreimageManager(): Promise<null> {
  return null;
}

export async function getTruApi(): Promise<never> {
  throw new Error("The T3ams agent runtime has no host TruAPI.");
}

export async function navigateTo(): Promise<void> {}
