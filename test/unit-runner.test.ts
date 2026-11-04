import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SimulatorProcessManager } from "../src/simulator/process-manager.js";
import type { GarminSdkPaths } from "../src/types.js";

// No real simulator or app state is touched by these process-lifecycle regressions.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-unit-runner-"));
const fixture = path.join(root, "fake-monkeydo.js");
const executable = process.platform === "win32" ? process.execPath : path.join(root, "fake-monkeydo");
const sdk = { monkeydoPath: executable } as GarminSdkPaths;
const good = "RESULTS\nexample PASS\nRan 1 test\nPASSED (failures=0, errors=0)\n";

async function fake(body: string): Promise<void> {
  const target = process.platform === "win32" ? fixture : executable;
  await fs.writeFile(target, `#!${process.execPath}\n${body}\n`);
  await fs.chmod(target, 0o700);
}

try {
  const manager = new SimulatorProcessManager();
  const suites: Array<[string, string, boolean]> = [
    ["success", `process.stdout.write(${JSON.stringify(good)});`, true],
    ["exit1", `process.stdout.write(${JSON.stringify(good)}); process.exitCode=1;`, true],
    ["exit2", `process.stdout.write(${JSON.stringify(good)}); process.exitCode=2;`, false],
    ["fatal", `process.stdout.write(${JSON.stringify(good)}); console.log('Encountered an app crash.');`, false],
    ["empty", ``, false],
    ["partial", `console.log('PASS');`, false],
    ["failed", `console.log('RESULTS\\nfirst PASS\\nsecond ERROR\\nRan 2 tests\\nFAILED (passed=1, failed=0, errors=1)');`, false],
    ["signal", `process.stdout.write(${JSON.stringify(good)}); process.kill(process.pid,'SIGTERM');`, false],
    ["timeout", `console.error('timeout diagnostic'); setInterval(()=>{},1000);`, false],
  ];
  for (const [mode, body, expected] of suites) {
    if (mode === "signal" && process.platform === "win32") continue;
    await fake(body);
    const result = await manager.runUnitTests(sdk, {
      prgPath: process.platform === "win32" ? fixture : mode, deviceId: "fenix847mm", timeoutMs: mode === "timeout" ? 2500 : 8000,
    });
    assert.equal(result.passed, expected, mode);
    if (mode === "exit1") assert.match(result.exitCodeWarning ?? "", /exited 1 despite a complete PASSED summary/);
    if (mode === "exit2") assert.equal(result.exitCode, 2);
    if (mode === "signal") assert.equal(result.signal, "SIGTERM");
    if (mode === "timeout") {
      assert.equal(result.timedOut, true);
      assert.match(result.output, /timeout diagnostic/);
    }
    console.log(`PASS runner ${mode}`);
  }

  const missing = await manager.runUnitTests({ monkeydoPath: path.join(root, "missing") } as GarminSdkPaths,
    { prgPath: "unused", deviceId: "fenix847mm", timeoutMs: 1000 });
  assert.equal(missing.passed, false);
  console.log("PASS runner spawn error");
  await assert.rejects(manager.runUnitTests(sdk, { prgPath: "unused", deviceId: "fenix847mm", timeoutMs: 0 }));
  console.log("PASS runner rejects invalid timeout");

  const prg = process.platform === "win32" ? fixture : path.join(root, "test.prg");
  await fs.writeFile(prg, "fixture");

  // A launcher that exits immediately, even with code 0, is not a launch.
  await fake(`process.exit(0);`);
  const exited = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 5000 });
  assert.equal(exited.launched, false);
  console.log("PASS zero launcher exit does not confirm startup");

  // Alive past the wait window with no errors: inferred launch, not confirmed.
  await fake(`setInterval(()=>{},1000);`);
  const alive = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 4000 });
  assert.equal(alive.launched, true);
  assert.equal(alive.startupConfirmed, false);
  await manager.stopActiveApp();
  console.log("PASS alive launcher past the wait window counts as an inferred launch");

  // An explicit SDK marker confirms the startup.
  await fake(`console.log('appStarted'); setInterval(()=>{},1000);`);
  const marked = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 5000 });
  assert.equal(marked.launched, true);
  assert.equal(marked.startupConfirmed, true);
  await manager.stopActiveApp();
  console.log("PASS explicit startup marker sets startupConfirmed");

  // A marker split across stream chunks is still recognised.
  await fake(`process.stdout.write('appSta'); setTimeout(()=>process.stdout.write('rted\\n'),50); setInterval(()=>{},1000);`);
  const split = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 5000 });
  assert.equal(split.launched, true);
  assert.equal(split.startupConfirmed, true);
  await manager.stopActiveApp();
  console.log("PASS startup marker split across chunks is detected");

  // Fatal text without a trailing newline is flushed before the timeout decision.
  await fake(`process.stdout.write('Unable to connect to simulator'); setInterval(()=>{},1000);`);
  const partial = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 6000 });
  assert.equal(partial.launched, false);
  assert.match(partial.fatalError ?? "", /Unable to connect to simulator/);
  assert.equal(manager.isAppRunning(), false);
  console.log("PASS trailing fatal line without newline fails the launch");

  // Fatal output wins over liveness, and the launcher is stopped.
  await fake(`console.log('Unable to connect to simulator'); setInterval(()=>{},1000);`);
  const fatal = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 6000 });
  assert.equal(fatal.launched, false);
  assert.match(fatal.fatalError ?? "", /Unable to connect to simulator/);
  assert.equal(manager.isAppRunning(), false);
  console.log("PASS fatal launcher output fails the launch and stops the process");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
