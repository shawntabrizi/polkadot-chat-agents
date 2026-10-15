// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Entry of the T3ams agent runtime bundle (see agent-core.ts for what it does).
 *
 * The app reads its deployment's domain once, while its config module
 * evaluates: that domain scopes every Statement Store topic and is the domain
 * the bot's key attestation is published under. In a browser it comes from the
 * page host; here it is the namespace the operator configured, handed over
 * through the app's own topic-namespace override before any app module loads.
 */

import "./node-env.ts";

import type { T3amsAgent, T3amsAgentOptions } from "./agent-core.ts";

export type {
  T3amsAgent,
  T3amsAgentOptions,
  T3amsDirectMessage,
  T3amsMention,
  T3amsWorkspaceInvite,
} from "./agent-core.ts";

/** The app's override key (`TOPIC_NAMESPACE_STORAGE_KEY` in src/shared/utils/topic-namespace.ts). */
const TOPIC_NAMESPACE_STORAGE_KEY = "t3ams-topic-namespace";

export async function startT3amsAgent(options: T3amsAgentOptions): Promise<T3amsAgent> {
  localStorage.setItem(TOPIC_NAMESPACE_STORAGE_KEY, options.namespace);
  // Dynamic on purpose: the app modules must evaluate after the namespace above is set.
  const { startAgentCore } = await import("./agent-core.ts");
  return startAgentCore(options);
}
