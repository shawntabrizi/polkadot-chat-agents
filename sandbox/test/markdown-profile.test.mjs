// The neutral acceptance list for the apps (`fixtures/markdown-profile.json`)
// must say what the reference pipeline renders today. A change to the
// pipeline that changes a tree fails here; regenerate with
//   UPDATE_FIXTURES=1 node --test test/markdown-profile.test.mjs
// and review the diff, because that diff is a change request to three apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

import { createMarkdown } from "../lib/markdown.mjs";
import { structureOf } from "./markdown-profile.mjs";

const file = new URL("./fixtures/markdown-profile.json", import.meta.url);
const { window } = new JSDOM("");
const md = createMarkdown(window);
const fixture = JSON.parse(fs.readFileSync(file, "utf8"));

if (process.env.UPDATE_FIXTURES) {
  for (const c of fixture.cases) c.structure = structureOf(md, window, c.input);
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
}

for (const c of fixture.cases) {
  test(`markdown profile: ${c.name}`, () => { assert.deepEqual(structureOf(md, window, c.input), c.structure); });
}

test("markdown profile: every case has a tree, and no two cases share a name", () => {
  assert.ok(fixture.cases.length > 0);
  for (const c of fixture.cases) assert.ok(Array.isArray(c.structure) && c.structure.length > 0, `${c.name} has no tree`);
  assert.equal(new Set(fixture.cases.map((c) => c.name)).size, fixture.cases.length);
});
