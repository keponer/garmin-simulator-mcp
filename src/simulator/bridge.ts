import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { locateGarminSdk } from "../config/sdk-locator.js";
import type { Point, Rect, WindowInfoResponse } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Resolves the path to the compiled macos-bridge binary.
 */
export function getBridgeBinaryPath(): string {
  // Try relative to this file
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate1 = path.resolve(currentDir, "../../bin/macos-bridge");
  if (fs.existsSync(candidate1)) {
    return candidate1;
  }
  // Try relative to process.cwd()
  const candidate2 = path.resolve(process.cwd(), "bin/macos-bridge");
  if (fs.existsSync(candidate2)) {
    return candidate2;
  }
  // Fall back to candidate1
  return candidate1;
}

/**
 * Runs a subcommand on the native Swift macos-bridge CLI.
 */
export async function runBridgeCommand(args: string[]): Promise<any> {
  if (process.platform === "win32") {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/native/windows-bridge.ps1");
    const encoded = Buffer.from(JSON.stringify(args)).toString("base64");
    const simulatorPath = args[0] === "ocr" ? "" : fs.realpathSync(locateGarminSdk().simulatorAppPath);
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, encoded, simulatorPath], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout.trim());
  }
  const binary = getBridgeBinaryPath();
  if (!fs.existsSync(binary)) {
    throw new Error(
      `macos-bridge binary not found at ${binary}. Build it first with: npm run build:swift`
    );
  }

  const { stdout, stderr } = await execFileAsync(binary, args);
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (stderr.trim()) {
      throw new Error(`macos-bridge error: ${stderr.trim()}`);
    }
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Failed to parse macos-bridge JSON output: ${trimmed}. Stderr: ${stderr}`
    );
  }
}

/**
 * Computes the client canvas origin inside the simulator window frame.
 * In ConnectIQ.app (wxWidgets on macOS), the window has a 28px macOS title bar at the top
 * and a 28px status bar at the bottom:
 * originX = Math.max(0, Math.round((windowBounds.width - bezelDimensions.width) / 2))
 * originY = top title bar height: if fallbackOffset is provided, use fallbackOffset.y;
 *           otherwise if windowBounds.height >= bezelDimensions.height + 28, use 28
 *           (the standard macOS title bar height, avoiding the bottom status bar);
 *           otherwise fallback to Math.max(0, windowBounds.height - bezelDimensions.height).
 */
export function computeCanvasOrigin(
  windowBounds: Rect,
  bezelDimensions?: { width: number; height: number },
  fallbackOffset?: Point
): Point {
  const fallback = fallbackOffset ?? { x: 0, y: 28 };
  if (!bezelDimensions || bezelDimensions.width <= 0 || bezelDimensions.height <= 0) {
    return fallback;
  }

  const originX = Math.max(0, Math.round((windowBounds.width - bezelDimensions.width) / 2));
  let originY: number;
  if (fallbackOffset !== undefined) {
    originY = fallbackOffset.y;
  } else if (windowBounds.height >= bezelDimensions.height + 28) {
    originY = 28;
  } else {
    originY = Math.max(0, windowBounds.height - bezelDimensions.height);
  }

  return { x: originX, y: originY };
}

/**
 * Inspects running Connect IQ simulator window information, bounds, and permissions.
 */
export async function getWindowInfo(): Promise<WindowInfoResponse> {
  return await runBridgeCommand(["window-info"]);
}

/**
 * Activates the Connect IQ simulator application window.
 */
export async function activateSimulator(): Promise<void> {
  const res = await runBridgeCommand(["activate"]);
  if (res && res.ok === false) {
    // Activation can be refused when another app owns a modal; raising the window
    // directly still makes it the click target.
    await raiseSimulatorWindow();
  }
}

/** Raises and focuses the simulator window (independent of app activation). */
export async function raiseSimulatorWindow(): Promise<void> {
  const res = await runBridgeCommand(["raise"]);
  if (res && res.ok === false && res.error) {
    throw new Error(res.error);
  }
}

/**
 * Synthesizes a mouse click at macOS screen coordinates (x, y).
 */
export async function clickScreenPoint(
  x: number,
  y: number,
  holdMs?: number
): Promise<void> {
  const args = ["click", "--x", String(x), "--y", String(y)];
  if (typeof holdMs === "number") {
    args.push("--hold-ms", String(holdMs));
  }
  const res = await runBridgeCommand(args);
  if (res && res.ok === false) {
    throw new Error(res.error ?? `Failed to click screen point (${x}, ${y})`);
  }
}

/**
 * Synthesizes a smooth mouse drag from (x1, y1) to (x2, y2).
 */
export async function dragScreenPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs?: number
): Promise<void> {
  const args = [
    "drag",
    "--x1",
    String(x1),
    "--y1",
    String(y1),
    "--x2",
    String(x2),
    "--y2",
    String(y2)
  ];
  if (typeof durationMs === "number") {
    args.push("--duration-ms", String(durationMs));
  }
  const res = await runBridgeCommand(args);
  if (res && res.ok === false) {
    throw new Error(
      res.error ?? `Failed to drag from (${x1}, ${y1}) to (${x2}, ${y2})`
    );
  }
}

/**
 * Synthesizes a keyboard key press by virtual key code.
 */
export async function sendKeyCode(keyCode: number, holdMs?: number): Promise<void> {
  if (process.platform === "win32") await raiseSimulatorWindow();
  const args = ["key", "--code", String(keyCode)];
  if (typeof holdMs === "number") {
    args.push("--hold-ms", String(holdMs));
  }
  const res = await runBridgeCommand(args);
  if (res && res.ok === false) {
    throw new Error(res.error ?? `Failed to send key code ${keyCode}`);
  }
}

/**
 * Triggers a menu item via macOS Accessibility (AXUIElement).
 */
export async function triggerMenu(
  menuPath: string[]
): Promise<{ ok: boolean; error?: string }> {
  return await runBridgeCommand(["menu", "--path", ...menuPath]);
}

/**
 * Captures raw window PNG buffer for a given CGWindowID using macOS /usr/sbin/screencapture.
 */
export async function captureRawWindowPng(windowId: number, windowScale = 1): Promise<Buffer> {
  const tmpFile = path.join(
    os.tmpdir(),
    `garmin-capture-${windowId}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );

  try {
    if (process.platform === "win32") {
      const result = await runBridgeCommand(["capture", String(windowId), tmpFile, String(windowScale)]);
      if (!result.ok) throw new Error(result.error);
      return await fs.promises.readFile(tmpFile);
    }
    await execFileAsync("/usr/sbin/screencapture", [
      "-l",
      String(windowId),
      "-o",
      "-x",
      tmpFile
    ]);

    if (!fs.existsSync(tmpFile)) {
      throw new Error(`screencapture did not produce output at ${tmpFile}`);
    }

    const buffer = await fs.promises.readFile(tmpFile);
    if (buffer.length === 0) {
      throw new Error(`screencapture produced an empty image for window ID ${windowId}`);
    }

    return buffer;
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        await fs.promises.unlink(tmpFile);
      }
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Object-oriented wrapper class for the macOS simulator bridge.
 */
export class SimulatorBridge {
  constructor(private bridgeBinaryPath: string = getBridgeBinaryPath()) {}

  getWindowInfo(): Promise<WindowInfoResponse> {
    return getWindowInfo();
  }

  activateSimulator(): Promise<void> {
    return activateSimulator();
  }

  clickScreenPoint(x: number, y: number, holdMs?: number): Promise<void> {
    return clickScreenPoint(x, y, holdMs);
  }

  dragScreenPoints(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs?: number
  ): Promise<void> {
    return dragScreenPoints(x1, y1, x2, y2, durationMs);
  }

  sendKeyCode(keyCode: number, holdMs?: number): Promise<void> {
    return sendKeyCode(keyCode, holdMs);
  }

  triggerMenu(menuPath: string[]): Promise<{ ok: boolean; error?: string }> {
    return triggerMenu(menuPath);
  }

  captureRawWindowPng(windowId: number): Promise<Buffer> {
    return captureRawWindowPng(windowId);
  }

  computeCanvasOrigin(
    windowBounds: Rect,
    bezelDimensions?: { width: number; height: number },
    fallbackOffset?: Point
  ): Point {
    return computeCanvasOrigin(windowBounds, bezelDimensions, fallbackOffset);
  }
}
