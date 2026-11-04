import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
const results = [];
for (const suite of ["metadata", "bridge", "tools", "process-manager", "unit-results", "unit-runner", "testing-tools", ...(process.platform === "win32" ? ["windows-native"] : [])]) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [tsx, `test/${suite}.test.ts`], { cwd: root, stdio: "inherit" });
  results.push({ suite, exitCode: result.status, signal: result.signal, error: result.error?.message,
    durationMs: Date.now() - started, passed: !result.error && result.status === 0 && !result.signal });
}
const report = { time: new Date().toISOString(), passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length, results };
if (process.env.GARMIN_MCP_TEST_REPORT) fs.writeFileSync(process.env.GARMIN_MCP_TEST_REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(`${report.passed} MCP suites passed; ${report.failed} failed.`);
if (report.failed) process.exitCode = 1;
