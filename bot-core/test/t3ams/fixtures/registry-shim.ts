// SPDX-License-Identifier: GPL-3.0-or-later

// The T3ams key registry contract, for the MLS e2e test: a key attestation is
// "published" as a file under T3AMS_TEST_REGISTRY_DIR and read back from it.
// Both sides still build, sign and parse the real attestation; only the Asset
// Hub contract call is replaced. Peers treat an account as MLS-capable only
// once its attestation can be read, so without this every DM stays on the
// legacy carrier, exactly as it would on a chain without the registry.

import fs from "node:fs";
import path from "node:path";
import {
  parseAttestationPayload,
  type PublishedKeys,
} from "@t3ams-test-real/t3ams-registry";

export * from "@t3ams-test-real/t3ams-registry";

const recordPath = (accountSs58: string): string => {
  const dir = process.env.T3AMS_TEST_REGISTRY_DIR;
  if (dir == null) throw new Error("T3AMS_TEST_REGISTRY_DIR is not set");
  // The test spells every account in one SS58 form, so the address is a stable file name.
  return path.join(dir, `${accountSs58}.json`);
};

export function registryAvailable(): boolean {
  return true;
}

export async function publishKeyAttestation(ownerAccountSs58: string, payload: Uint8Array): Promise<void> {
  fs.writeFileSync(recordPath(ownerAccountSs58), Buffer.from(payload).toString("utf8"));
}

export async function resolveIdentityKeys(accountSs58: string): Promise<PublishedKeys | null> {
  let raw: string;
  try {
    raw = fs.readFileSync(recordPath(accountSs58), "utf8");
  } catch {
    return null;
  }
  const parsed = parseAttestationPayload(new TextEncoder().encode(raw));
  if (parsed == null) return null;
  return {
    signingPubKeyHex: parsed.signingPubKey,
    agreementPubKeyHex: parsed.agreementPubKey,
    mlsProtocolVersion: parsed.mlsProtocolVersion ?? null,
    updatedAt: parsed.ts,
  };
}
