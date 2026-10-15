// SPDX-License-Identifier: GPL-3.0-or-later

// A "person" for the MLS e2e test: the same headless T3ams app the bot runs,
// plus the actions a member takes in the UI (create a workspace, add an agent,
// @mention it, DM it). Compiled against the SPA checkout by the test.

import "../../../transports/t3ams/runtime/node-env.ts";

import type { HumanOptions, Human } from "./human-core.ts";

export type { HumanOptions, Human };

export async function startHuman(options: HumanOptions): Promise<Human> {
  localStorage.setItem("t3ams-topic-namespace", options.namespace);
  // Dynamic on purpose: the app modules must evaluate after the namespace above is set.
  const { startHumanCore } = await import("./human-core.ts");
  return startHumanCore(options);
}
