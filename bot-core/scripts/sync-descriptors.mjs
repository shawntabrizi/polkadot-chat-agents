// Copy the papi-generated descriptors dist into vendor/ (which we own and ship).
// Needed because .papi/descriptors/.gitignore (papi-managed) excludes dist, and
// npm's packlist honors nested ignore files — so the tarball can't include the
// dist in place. vendor/descriptors is committed and packed instead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", ".papi", "descriptors", "dist");
const dest = path.join(here, "..", "vendor", "descriptors");
if (!fs.existsSync(src)) { console.error("no generated descriptors — run `papi generate` first"); process.exit(1); }
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
// PAPI emits blank declaration-comment lines with indentation for the Bulletin
// descriptor. Normalize this generated addition so `prepare` does not create a
// whitespace-only diff in the committed package asset.
const normalizedDeclarations = new Set(["bulletinPaseoNextV2.d.ts"]);
for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
  if (!entry.isFile() || !normalizedDeclarations.has(entry.name)) continue;
  const file = path.join(dest, entry.name);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/[\t ]+$/gm, ""));
}
// Nearest package.json must say ESM, or Node parses the .js files as CJS.
fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ type: "module", sideEffects: false }, null, 2) + "\n");
console.log("synced descriptors dist -> vendor/descriptors");
