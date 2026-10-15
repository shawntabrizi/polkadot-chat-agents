// SPDX-License-Identifier: GPL-3.0-or-later

// The People chain username directory, for the MLS e2e test: usernames
// resolve from T3AMS_TEST_DIRECTORY ({ "name.01": "<ss58 account>" }) instead
// of the chain, so the test needs no registered usernames.

import { xidHexFromAccountId, type PeopleContact } from "@t3ams-test-real/people-resources";

export * from "@t3ams-test-real/people-resources";

const directory = (): Record<string, string> => JSON.parse(process.env.T3AMS_TEST_DIRECTORY ?? "{}");

export async function resolveUsernameOwner(username: string): Promise<string | null> {
  return directory()[username] ?? null;
}

export async function resolveContactByUsername(username: string): Promise<PeopleContact | null> {
  const accountId = directory()[username];
  if (accountId == null) return null;
  return { username, accountId, identifierKeyHex: null, fullUsername: username, xidHex: xidHexFromAccountId(accountId) };
}
