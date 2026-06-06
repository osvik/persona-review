import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tscBin = require.resolve("typescript/bin/tsc");

const result = spawnSync(process.execPath, [tscBin], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run TypeScript compiler: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (process.platform !== "win32") {
  chmodSync(new URL("../dist/cli.js", import.meta.url), 0o755);
}
