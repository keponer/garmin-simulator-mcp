import assert from "node:assert/strict";
import { createServer } from "../src/index.js";
import {
  bezelPointToScreenPoint,
  getActiveDeviceId,
  resolveActiveDeviceProfile,
  setManualActiveDeviceId,
  watchPointToScreenPoint,
} from "../src/tools/shared.js";
import {
  handleListDevices,
  handleSetActiveDevice,
  handleSimulatorStatus,
} from "../src/tools/lifecycle.js";
import { handleGetAppLogs } from "../src/tools/visual.js";
import { processManager } from "../src/simulator/process-manager.js";

async function runToolsTests() {
  console.log("=== Running Garmin Emulator MCP Tools Tests ===");

  // 1. Test createServer registration
  console.log("\n[Test 1] Testing McpServer initialization & tools registration...");
  const server = createServer();
  assert.ok(server, "McpServer instance should be created");
  console.log("✓ Test 1 passed: McpServer initialized with tools.");

  // 2. Test shared active device resolution
  console.log("\n[Test 2] Testing device resolution & manual override...");
  const initialDevice = getActiveDeviceId();
  assert.ok(initialDevice, "Should have a non-empty default device ID");

  setManualActiveDeviceId("venu3");
  assert.strictEqual(getActiveDeviceId(), "venu3");

  const venuProfile = resolveActiveDeviceProfile();
  assert.strictEqual(venuProfile.deviceId, "venu3");
  assert.strictEqual(venuProfile.display.location.width, 454);
  assert.strictEqual(venuProfile.display.location.height, 454);

  // Reset to fenix847mm
  setManualActiveDeviceId("fenix847mm");
  const fenixProfile = resolveActiveDeviceProfile();
  assert.strictEqual(fenixProfile.deviceId, "fenix847mm");
  console.log("✓ Test 2 passed: Device resolution and profile parsing verified.");

  // 3. Test coordinate translation helpers
  console.log("\n[Test 3] Testing coordinate translation helpers...");
  const windowBounds = { x: 100, y: 100, width: 713, height: 977 };
  // Bezel is 713x921, window is 713x977 -> origin is (0, 28)
  const bezelPt = { x: 50, y: 50 };
  const screenPt = bezelPointToScreenPoint(bezelPt, windowBounds, fenixProfile);
  // screenPt.x = 100 + 0 + 50 = 150
  // screenPt.y = 100 + 28 + 50 = 178
  assert.deepStrictEqual(screenPt, { x: 150, y: 178 });
  assert.deepStrictEqual(bezelPointToScreenPoint(bezelPt, { x: 100, y: 100, width: 912, height: 1200 }, fenixProfile, { x: 10, y: 64 }, 1.25), { x: 173, y: 227 });
  assert.deepStrictEqual(bezelPointToScreenPoint(bezelPt, { x: 100, y: 100, width: 1500, height: 1500 }, fenixProfile, { x: 10, y: 64 }, 1.25), { x: 173, y: 227 });

  // Watch point: fenix847mm display.location is (134, 221)
  const watchPt = { x: 10, y: 20 };
  const watchScreenPt = watchPointToScreenPoint(watchPt, windowBounds, fenixProfile);
  // watchScreenPt.x = 100 + 0 + 134 + 10 = 244
  // watchScreenPt.y = 100 + 28 + 221 + 20 = 369
  assert.deepStrictEqual(watchScreenPt, { x: 244, y: 369 });
  console.log("✓ Test 3 passed: Bezel & watch coordinate math verified.");

  // 4. Test lifecycle handlers: list_devices, set_active_device, simulator_status
  console.log("\n[Test 4] Testing lifecycle tool handlers...");
  const listRes = await handleListDevices({ query: "fenix8" });
  assert.strictEqual(listRes.isError, undefined);
  const parsedList = JSON.parse((listRes.content[0] as any).text);
  assert.ok(parsedList.total >= 1, "Should find at least 1 fenix8 device");
  assert.ok(parsedList.devices.some((d: any) => d.deviceId === "fenix847mm"));

  const setActiveRes = await handleSetActiveDevice({ device_id: "fenix847mm" });
  assert.strictEqual(setActiveRes.isError, undefined);
  const parsedActive = JSON.parse((setActiveRes.content[0] as any).text);
  assert.strictEqual(parsedActive.activeDeviceId, "fenix847mm");

  const statusRes = await handleSimulatorStatus();
  assert.strictEqual(statusRes.isError, undefined);
  const parsedStatus = JSON.parse((statusRes.content[0] as any).text);
  assert.strictEqual(typeof parsedStatus.running, "boolean");
  assert.strictEqual(typeof parsedStatus.port1234Open, "boolean");
  assert.strictEqual(parsedStatus.activeDeviceId, "fenix847mm");
  console.log("✓ Test 4 passed: list_devices, set_active_device, and simulator_status verified.");

  // 5. Test log retrieval handler
  console.log("\n[Test 5] Testing log retrieval handler...");
  processManager.appendLog("test", "Test log entry 1");
  processManager.appendLog("test", "Test log entry 2");
  const logsRes = await handleGetAppLogs({ lines: 2 });
  assert.strictEqual(logsRes.isError, undefined);
  const logText = (logsRes.content[0] as any).text;
  assert.ok(logText.includes("Test log entry 1"));
  assert.ok(logText.includes("Test log entry 2"));
  console.log("✓ Test 5 passed: get_app_logs verified.");

  console.log("\n========================================================");
  console.log("All Garmin Emulator MCP Tools Tests PASSED successfully!");
  console.log("========================================================");
}

runToolsTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
