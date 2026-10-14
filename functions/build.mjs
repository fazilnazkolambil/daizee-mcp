// Packages the function: bundles OUR code (src/ + functions/src) into one file,
// keeps npm packages external (Cloud Build installs them from package.json),
// and copies the fictional seed data next to it.
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

rmSync(resolve(here, "lib"), { recursive: true, force: true });
rmSync(resolve(here, "seed"), { recursive: true, force: true });

await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile: resolve(here, "lib/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "info",
});

cpSync(resolve(here, "../seed"), resolve(here, "seed"), { recursive: true });
console.log("functions: built lib/index.js and copied seed/");
