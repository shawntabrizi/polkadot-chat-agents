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
// Nearest package.json must say ESM, or Node parses the .js files as CJS.
fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ type: "module", sideEffects: false }, null, 2) + "\n");
console.log("synced descriptors dist -> vendor/descriptors");
