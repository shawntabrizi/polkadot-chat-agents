// SPDX-License-Identifier: GPL-3.0-or-later

// Compile the headless T3ams agent (agent.ts) against a T3ams SPA checkout.
//
// The agent IS the app's messaging stack, so it is built with the app's own
// toolchain and module aliases, from the checkout the operator points at:
// whatever protocol that checkout speaks, the bot speaks. Two modules are
// swapped for Node versions (host-shim.ts, statement-store-shim.ts); the real
// ones stay reachable under `*-real` aliases for the shims to re-export.
//
// Output: one ESM bundle plus the core-crypto WASM next to it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(new URL(import.meta.url).pathname);

/** The T3ams key registry contract the public deployments use (paseo-next-v2,
 *  Asset Hub). Peers read MLS capability from it. */
export const T3AMS_DEFAULT_REGISTRY_ADDRESS = "0xa2098781edc0916546128d020affc438317edc2c";

/**
 * @param {{ spaRoot: string, outDir: string, registryAddress?: string, network?: string,
 *           entries?: Record<string, string>, aliases?: { find: RegExp, replacement: string }[] }} options
 *   `entries` and `aliases` let a test harness compile extra entry points (and
 *   swap modules) against the same checkout; the bot itself uses the defaults.
 * @returns {Promise<{ entry: string }>}
 */
export async function buildT3amsAgentRuntime({
  spaRoot,
  outDir,
  registryAddress = T3AMS_DEFAULT_REGISTRY_ADDRESS,
  network = "paseo-next-v2",
  entries = { agent: path.join(HERE, "agent.ts") },
  aliases = [],
}) {
  const root = path.resolve(spaRoot);
  const spa = (relative) => path.join(root, relative);
  const resolveInSpa = (specifier) => path.join(root, "node_modules", specifier);
  // The checkout's own toolchain, located at run time: the bot has no vite of its own.
  const { build } = await import(pathToFileURL(resolveInSpa("vite/dist/node/index.js")).href);
  const { coreCryptoIdbHook } = await import(pathToFileURL(spa("packages/mls/src/core-crypto-idb-hook.ts")).href);
  const statementStorePkg = JSON.parse(
    fs.readFileSync(resolveInSpa("@parity/product-sdk-statement-store/package.json"), "utf8"),
  );
  const statementStoreEntry = resolveInSpa(
    path.join("@parity/product-sdk-statement-store", statementStorePkg.exports?.["."]?.import ?? statementStorePkg.module ?? "dist/index.js"),
  );

  fs.rmSync(outDir, { recursive: true, force: true });
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    mode: "production",
    envDir: false,
    publicDir: false,
    define: {
      global: "globalThis",
      "import.meta.env.VITE_NETWORK": JSON.stringify(network),
      "import.meta.env.VITE_T3AMS_REGISTRY_ADDRESS": JSON.stringify(registryAddress),
      "import.meta.env.VITE_MLS_CUTOVER_ENABLED": JSON.stringify("true"),
      "import.meta.env.VITE_T3AMS_APP_VERSION": JSON.stringify("agent"),
      "import.meta.env.VITE_T3AMS_COMMIT": JSON.stringify("agent"),
      "import.meta.env.VITE_T3AMS_SDK_VERSIONS": JSON.stringify("{}"),
      "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(""),
    },
    plugins: [coreCryptoIdbHook()],
    resolve: {
      alias: [
        ...aliases,
        { find: /^@t3ams\/host$/, replacement: path.join(HERE, "host-shim.ts") },
        { find: /^@t3ams-real\/host$/, replacement: spa("packages/host/src/index.ts") },
        { find: /^@parity\/product-sdk-statement-store$/, replacement: path.join(HERE, "statement-store-shim.ts") },
        { find: /^@parity\/product-sdk-statement-store-real$/, replacement: statementStoreEntry },
        { find: /^sonner$/, replacement: path.join(HERE, "sonner-shim.ts") },
        { find: /^@\//, replacement: `${spa("src")}/` },
        { find: /^@app\//, replacement: `${spa("src/app")}/` },
        { find: /^@features\//, replacement: `${spa("src/features")}/` },
        { find: /^@shared\//, replacement: `${spa("src/shared")}/` },
        { find: /^@t3ams\/bcts$/, replacement: spa("packages/bcts/src/index.ts") },
        { find: /^@t3ams\/identity$/, replacement: spa("packages/identity/src/index.ts") },
        { find: /^@t3ams\/signing$/, replacement: spa("packages/signing/src/index.ts") },
        { find: /^@t3ams\/gstp-client$/, replacement: spa("packages/gstp-client/src/index.ts") },
        { find: /^@t3ams\/mls$/, replacement: spa("packages/mls/src/index.ts") },
        { find: /^@t3ams\/utils$/, replacement: spa("packages/utils/src/index.ts") },
      ],
    },
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: entries,
        onwarn(warning, warn) {
          // Third-party "use client" directives and annotation positions: harmless in a Node bundle.
          if (warning.code === "MODULE_LEVEL_DIRECTIVE" || warning.code === "INVALID_ANNOTATION") return;
          warn(warning);
        },
        output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "agent-[name].mjs" } },
    },
  });
  fs.copyFileSync(
    resolveInSpa("@wireapp/core-crypto/dist/browser/autogenerated/wasm-bindgen/index_bg.wasm"),
    path.join(outDir, "index_bg.wasm"),
  );
  return { entry: path.join(outDir, "agent.mjs") };
}

/**
 * Type-check the runtime sources against the checkout's own types, so a T3ams
 * API the runtime calls that changed shape fails here instead of at run time.
 * Runs the checkout's TypeScript with its tsconfig, plus the runtime's aliases.
 *
 * @param {{ spaRoot: string, include?: string[], paths?: Record<string, string[]> }} options
 */
export function typecheckT3amsAgentRuntime({ spaRoot, include = [path.join(HERE, "*.ts")], paths = {} }) {
  const root = path.resolve(spaRoot);
  const spaConfig = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-t3ams-tsc-"));
  try {
    const config = {
      extends: path.join(root, "tsconfig.json"),
      compilerOptions: {
        baseUrl: root,
        types: ["node"],
        typeRoots: [path.join(root, "node_modules/@types")],
        paths: {
          ...spaConfig.compilerOptions.paths,
          "@t3ams-real/host": spaConfig.compilerOptions.paths["@t3ams/host"],
          "@parity/product-sdk-statement-store-real": ["node_modules/@parity/product-sdk-statement-store/dist/index.d.ts"],
          ...paths,
        },
      },
      include: [...include, path.join(root, "vite-env.d.ts")],
      exclude: [],
    };
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config));
    const tsc = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(dir, "tsconfig.json")], {
      cwd: root,
      encoding: "utf8",
    });
    if (tsc.status !== 0) throw new Error(`the T3ams agent runtime does not type-check against this checkout:\n${tsc.stdout}${tsc.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [spaRoot, outDir] = process.argv.slice(2);
  if (!spaRoot || !outDir) {
    console.error("usage: node build.mjs <path-to-t3ams-spa> <out-dir>");
    process.exit(2);
  }
  const { entry } = await buildT3amsAgentRuntime({
    spaRoot,
    outDir: path.resolve(outDir),
    registryAddress: process.env.T3AMS_REGISTRY_ADDRESS || T3AMS_DEFAULT_REGISTRY_ADDRESS,
    network: process.env.T3AMS_NETWORK ?? "paseo-next-v2",
  });
  console.log(entry);
}
