// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * What the agent supplies in place of a host: entropy, durable storage, the
 * statement-store transport and the root-account signer. Installed once by
 * `startT3amsAgent` before any T3ams module asks for a host capability.
 */

import type { HostLocalStorage } from "@t3ams-real/host";
import type { StatementTransport } from "@parity/product-sdk-statement-store-real";

export interface AgentHost {
  readonly deriveEntropy: (context: Uint8Array) => Promise<Uint8Array>;
  readonly storage: HostLocalStorage;
  /** A fresh transport per call: the app destroys one whose host session died and asks for another. */
  readonly createStatementTransport: () => StatementTransport;
  readonly signRootBytes: (payload: Uint8Array) => Promise<Uint8Array>;
}

let installed: AgentHost | null = null;

export function installAgentHost(host: AgentHost): void {
  if (installed != null) throw new Error("The T3ams agent host is already installed in this process.");
  installed = host;
}

export function agentHost(): AgentHost {
  if (installed == null) throw new Error("The T3ams agent host is not installed: call startT3amsAgent first.");
  return installed;
}
