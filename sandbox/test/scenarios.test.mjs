// Every file in scenarios/ is a test: a fresh daemon, personas driven through
// pcs, a bot created and run through pca. The same runner backs
// `pcs scenario run <file>`. Needs bot-core's dependencies installed.
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "../lib/scenario.mjs";

const dir = fileURLToPath(new URL("../scenarios/", import.meta.url));

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  test(`scenario ${file}`, async () => {
    const lines = [];
    try {
      await runScenario(path.join(dir, file), { log: (line) => lines.push(line) });
    } catch (error) {
      error.message += `\nscenario log:\n  ${lines.join("\n  ")}`;
      throw error;
    }
  });
}
