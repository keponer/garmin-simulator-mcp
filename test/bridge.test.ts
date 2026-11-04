import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  computeCanvasOrigin,
  getWindowInfo,
  runBridgeCommand
} from "../src/simulator/bridge.js";
import {
  generateAnnotationOverlay,
  processSimulatorScreenshot
} from "../src/simulator/image-processor.js";
import type { DeviceProfile, Rect } from "../src/types.js";

async function runTests() {
  console.log("=== Running Garmin Emulator Bridge & Image Pipeline Tests ===");

  // -------------------------------------------------------------
  // Test 1: macos-bridge window-info CLI execution
  // -------------------------------------------------------------
  console.log("\n[Test 1] Testing macos-bridge window-info...");
  const windowInfo = await getWindowInfo();
  console.log("window-info result:", JSON.stringify(windowInfo, null, 2));

  assert.strictEqual(
    typeof windowInfo.running,
    "boolean",
    "windowInfo.running should be a boolean"
  );
  assert.ok(
    windowInfo.permissions,
    "windowInfo.permissions object should be defined"
  );
  assert.strictEqual(
    typeof windowInfo.permissions.screenRecording,
    "boolean",
    "screenRecording permission should be boolean"
  );
  assert.strictEqual(
    typeof windowInfo.permissions.accessibility,
    "boolean",
    "accessibility permission should be boolean"
  );

  if (windowInfo.running) {
    assert.ok(windowInfo.pid && windowInfo.pid > 0, "pid should be positive number");
    assert.ok(windowInfo.bounds, "bounds should be present when running");
    assert.ok(windowInfo.bounds.width > 0, "window width should be > 0");
    assert.ok(windowInfo.bounds.height > 0, "window height should be > 0");
    assert.ok(windowInfo.contentOffset, "contentOffset should be present");
  }
  console.log("✓ Test 1 passed: macos-bridge window-info executed successfully.");

  // -------------------------------------------------------------
  // Test 2: computeCanvasOrigin calculations
  // -------------------------------------------------------------
  console.log("\n[Test 2] Testing computeCanvasOrigin...");

  // Standard window with 28px title bar: window 639x722, bezel 639x694
  const standardBounds: Rect = { x: 100, y: 100, width: 639, height: 722 };
  const origin1 = computeCanvasOrigin(standardBounds, { width: 639, height: 694 });
  assert.deepStrictEqual(
    origin1,
    { x: 0, y: 28 },
    "Standard title bar offset should be x: 0, y: 28"
  );

  // Window with extra margins on both sides: window 700x800, bezel 600x750
  const origin2 = computeCanvasOrigin(
    { x: 50, y: 50, width: 700, height: 800 },
    { width: 600, height: 750 }
  );
  assert.deepStrictEqual(
    origin2,
    { x: 50, y: 28 },
    "Offset should center bezel horizontally and use 28px top titlebar"
  );

  // ConnectIQ.app fenix847mm window with 28px titlebar + 921px bezel + 28px bottom status bar (713x977)
  const fenixBounds: Rect = { x: 100, y: 100, width: 713, height: 977 };
  const originFenix = computeCanvasOrigin(fenixBounds, { width: 713, height: 921 });
  assert.deepStrictEqual(
    originFenix,
    { x: 0, y: 28 },
    "ConnectIQ.app has 28px titlebar at top and 28px status bar at bottom; originY must be 28"
  );

  // Fallback when bezel dimensions are undefined
  const origin3 = computeCanvasOrigin(standardBounds, undefined);
  assert.deepStrictEqual(
    origin3,
    { x: 0, y: 28 },
    "Fallback offset should default to x: 0, y: 28"
  );

  // Custom fallback
  const origin4 = computeCanvasOrigin(standardBounds, undefined, { x: 10, y: 35 });
  assert.deepStrictEqual(
    origin4,
    { x: 10, y: 35 },
    "Should use custom fallback offset when provided"
  );

  console.log("✓ Test 2 passed: computeCanvasOrigin math verified.");

  // -------------------------------------------------------------
  // Test 3: Synthetic Retina screenshot processing across all 3 view modes
  // -------------------------------------------------------------
  console.log("\n[Test 3] Testing processSimulatorScreenshot across all view modes...");

  const mockProfile: DeviceProfile = {
    deviceId: "fenix847mm",
    displayName: "fēnix® 8 47mm",
    deviceFamily: "fenix",
    displayType: "amoled",
    bezelDimensions: { width: 639, height: 694 },
    display: {
      isTouch: true,
      shape: "round",
      location: { x: 92, y: 120, width: 454, height: 454 },
      behaviors: [
        {
          gesture: "swipeRight",
          id: "onBack",
          maxDistToEdge: 81,
          maxSwipeDuration: 250,
          minSwipeDeltaX: 90,
          minSwipeDeltaY: 90
        }
      ]
    },
    keys: [
      {
        id: "enter",
        behavior: "onSelect",
        isHold: false,
        location: { x: 580, y: 140, width: 50, height: 60 },
        center: { x: 605, y: 170 },
        aliases: ["select"]
      },
      {
        id: "up",
        behavior: "previousPage",
        isHold: false,
        location: { x: 10, y: 250, width: 50, height: 60 },
        center: { x: 35, y: 280 },
        aliases: ["up"]
      },
      {
        id: "down",
        behavior: "nextPage",
        isHold: false,
        location: { x: 10, y: 350, width: 50, height: 60 },
        center: { x: 35, y: 380 },
        aliases: ["down"]
      },
      {
        id: "menu",
        behavior: "onMenu",
        isHold: true,
        location: { x: 10, y: 250, width: 50, height: 60 },
        center: { x: 35, y: 280 },
        aliases: ["menu"]
      },
      {
        id: "esc",
        behavior: "onBack",
        isHold: false,
        location: { x: 580, y: 450, width: 50, height: 60 },
        center: { x: 605, y: 480 },
        aliases: ["back"]
      }
    ]
  };

  // Create a 2x Retina synthetic window buffer (1278 x 1444 px for a 639 x 722 logical window)
  const windowBounds: Rect = { x: 100, y: 100, width: 639, height: 722 };
  const rawWindowPng = await sharp({
    create: {
      width: 1278,
      height: 1444,
      channels: 4,
      background: { r: 24, g: 26, b: 30, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  // Test 3a: View "screen"
  console.log("  Testing view: 'screen'...");
  const screenResult = await processSimulatorScreenshot({
    rawWindowPng,
    windowBounds,
    profile: mockProfile,
    view: "screen"
  });

  assert.strictEqual(screenResult.view, "screen");
  assert.strictEqual(screenResult.deviceId, "fenix847mm");
  assert.strictEqual(screenResult.width, 454, "Screen view width must match display.location.width");
  assert.strictEqual(screenResult.height, 454, "Screen view height must match display.location.height");
  assert.ok(screenResult.base64Png.length > 0, "Base64 PNG must not be empty");

  // Verify decoded image dimensions using sharp
  const screenDecoded = await sharp(
    Buffer.from(screenResult.base64Png, "base64")
  ).metadata();
  assert.strictEqual(screenDecoded.width, 454);
  assert.strictEqual(screenDecoded.height, 454);
  console.log("  ✓ view: 'screen' output 454x454 PNG");

  // Test 3b: View "bezel"
  console.log("  Testing view: 'bezel'...");
  const bezelResult = await processSimulatorScreenshot({
    rawWindowPng,
    windowBounds,
    profile: mockProfile,
    view: "bezel"
  });

  assert.strictEqual(bezelResult.view, "bezel");
  assert.strictEqual(bezelResult.width, 639, "Bezel width must match bezelDimensions.width");
  assert.strictEqual(bezelResult.height, 694, "Bezel height must match bezelDimensions.height");

  const bezelDecoded = await sharp(
    Buffer.from(bezelResult.base64Png, "base64")
  ).metadata();
  assert.strictEqual(bezelDecoded.width, 639);
  assert.strictEqual(bezelDecoded.height, 694);
  console.log("  ✓ view: 'bezel' output 639x694 PNG");

  // A resized Windows window adds empty space; it does not scale the device.
  for (const [width, scale] of [[650, 1], [1000, 1.25], [1000, 1.5]]) {
    const raw = await sharp({ create: { width, height: 760, channels: 3, background: '#000000' } })
      .composite([{ input: await sharp({ create: { width: 639, height: 694, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 8, top: 40 }])
      .png().toBuffer();
    const result = await processSimulatorScreenshot({ rawWindowPng: raw,
      windowBounds: { x: 0, y: 0, width: width * scale, height: 760 * scale },
      contentOffset: { x: 8 * scale, y: 40 * scale }, windowScale: scale, profile: mockProfile, view: 'bezel' });
    const pixel = await sharp(Buffer.from(result.base64Png, 'base64')).extract({ left: 400, top: 300, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], [255, 0, 0], `device crop must remain fixed at window width ${width}, scale ${scale}`);
  }

  // Test 3c: View "annotated"
  console.log("  Testing view: 'annotated'...");
  const tmpSavePath = path.join(os.tmpdir(), `garmin-test-annotated-${Date.now()}.png`);
  const annotatedResult = await processSimulatorScreenshot({
    rawWindowPng,
    windowBounds,
    profile: mockProfile,
    view: "annotated",
    savePath: tmpSavePath
  });

  assert.strictEqual(annotatedResult.view, "annotated");
  assert.strictEqual(annotatedResult.width, 639);
  assert.strictEqual(annotatedResult.height, 694);
  assert.strictEqual(annotatedResult.savedPath, tmpSavePath);

  assert.ok(fs.existsSync(tmpSavePath), "Saved image file must exist on disk");
  const savedFileStats = fs.statSync(tmpSavePath);
  assert.ok(savedFileStats.size > 0, "Saved file must not be 0 bytes");

  const annotatedDecoded = await sharp(fs.readFileSync(tmpSavePath)).metadata();
  assert.strictEqual(annotatedDecoded.width, 639);
  assert.strictEqual(annotatedDecoded.height, 694);

  // Clean up test file
  fs.unlinkSync(tmpSavePath);
  console.log("  ✓ view: 'annotated' output 639x694 PNG with SVG composite & disk persistence");

  // -------------------------------------------------------------
  // Test 4: generateAnnotationOverlay SVG content validation
  // -------------------------------------------------------------
  console.log("\n[Test 4] Validating SVG annotation overlay content...");
  const svg = generateAnnotationOverlay(mockProfile, 639, 694);
  assert.ok(svg.includes("<svg"), "SVG must include <svg tag");
  assert.ok(svg.includes("SCREEN (454x454)"), "SVG must include screen label");
  assert.ok(svg.includes("enter"), "SVG must include enter key label");
  assert.ok(svg.includes("menu"), "SVG must include menu key label");
  assert.ok(svg.includes("[HOLD]"), "SVG must indicate [HOLD] keys");
  assert.ok(svg.includes("stroke-dasharray=\"6,4\""), "SVG must include dashed screen border");
  console.log("✓ Test 4 passed: SVG annotation contains all required labels and elements.");

  if (process.platform === "win32") {
    const ocrFile = path.join(os.tmpdir(), `garmin-ocr-${process.pid}.png`);
    try {
      await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="150"><rect width="800" height="150" fill="white"/><text x="20" y="100" font-size="72">HELLO GARMIN</text></svg>')).png().toFile(ocrFile);
      const ocr = await runBridgeCommand(["ocr", ocrFile]);
      if (!ocr.ok && /language pack.*unavailable/i.test(ocr.error)) console.log("Windows OCR test skipped: no OCR language pack installed.");
      else {
        assert.equal(ocr.ok, true, ocr.error);
        assert.match(ocr.lines.map((line: { text: string }) => line.text).join(" "), /HELLO GARMIN/i);
        assert.ok(ocr.lines[0].bounds.width > 0 && ocr.lines[0].bounds.width <= 1);
      }
    } finally { fs.rmSync(ocrFile, { force: true }); }
  }

  console.log("\n========================================================");
  console.log("All Garmin Emulator Bridge & Image Tests PASSED successfully!");
  console.log("========================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
