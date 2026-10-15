// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `@parity/product-sdk-statement-store` for an agent: the real module, with
 * `createTransport` returning the agent's own transport (direct RPC to a
 * statement-store node, statements signed by the bot's account) instead of
 * the host one.
 */

import type { StatementTransport } from "@parity/product-sdk-statement-store-real";
import { agentHost } from "./agent-host.ts";

export * from "@parity/product-sdk-statement-store-real";

export async function createTransport(): Promise<StatementTransport> {
  return agentHost().createStatementTransport();
}
