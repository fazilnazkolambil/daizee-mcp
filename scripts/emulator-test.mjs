// Runs tests/firestore.emulator.test.ts against the Firebase EMULATORS only.
//
//   npm run test:emulator                       Firestore emulator: proves the meal doc shape.
//   DAYZER0_DIR=~/path/to/DayZer0 npm run test:emulator
//                                               Also runs the DayZer0 app's own meal and weight
//                                               triggers in the Functions emulator, and checks
//                                               that they rebuild today's totals and post the card.
//
// The project id is "demo-daizee": Firebase treats "demo-" projects as
// emulator-only, so nothing here can reach a real project. The DayZer0 repo is
// only read: its functions code and lockfile are copied into a temp dir and
// installed there with npm ci.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "daizee-emulator-"));
const appDir = process.env.DAYZER0_DIR ? resolve(process.env.DAYZER0_DIR.replace(/^~(?=\/)/, process.env.HOME ?? "~")) : null;

const config = {
  firestore: {},
  emulators: {
    firestore: { port: 8085 },
    functions: { port: 5005 },
    ui: { enabled: false },
    singleProjectMode: true,
  },
};

if (appDir) {
  const src = join(appDir, "functions");
  if (!existsSync(join(src, "package-lock.json"))) {
    console.error(`No ${src}/package-lock.json: is DAYZER0_DIR the DayZer0 repo?`);
    process.exit(1);
  }
  const fn = join(work, "functions");
  cpSync(join(src, "src"), join(fn, "src"), { recursive: true });
  cpSync(join(src, "package.json"), join(fn, "package.json"));
  cpSync(join(src, "package-lock.json"), join(fn, "package-lock.json"));
  const install = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fn, stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
  // firebase-admin's database module needs this peer at load time on newer Node versions;
  // the app's lockfile does not carry it. Added to the temp copy only.
  const peer = spawnSync("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "@firebase/app@0.14"], { cwd: fn, stdio: "inherit" });
  if (peer.status !== 0) process.exit(peer.status ?? 1);
  // Only the triggers a voice log sets off: no schedules, no AI, no pushes.
  writeFileSync(
    join(fn, "index.js"),
    [
      'exports.onMealWritten = require("./src/triggers/meals/onMealWritten").onMealWritten;',
      'exports.onWeightLogWritten = require("./src/triggers/weight/onWeightLogWritten").onWeightLogWritten;',
      "",
    ].join("\n"),
  );
  config.functions = [{ source: "functions", codebase: "default" }];
}

writeFileSync(join(work, "firebase.json"), JSON.stringify(config, null, 2));
const only = appDir ? "firestore,functions" : "firestore";
const test = `cd ${JSON.stringify(root)} && ${appDir ? "DAYZER0_TRIGGERS=1 " : ""}npx vitest run tests/firestore.emulator.test.ts`;

const run = spawnSync("firebase", ["emulators:exec", "--project", "demo-daizee", "--only", only, test], {
  cwd: work,
  stdio: "inherit",
  env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "" },
});
rmSync(work, { recursive: true, force: true });
process.exit(run.status ?? 1);
