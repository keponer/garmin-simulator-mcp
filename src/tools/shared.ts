import type {
  DeviceProfile,
  Point,
  ProcessedScreenshot,
  Rect,
  ScreenshotViewMode,
} from "../types.js";
import { readSimulatorIni } from "../config/sdk-locator.js";
import { parseDeviceProfile } from "../metadata/device-parser.js";
import {
  computeCanvasOrigin,
  getWindowInfo,
  captureRawWindowPng,
} from "../simulator/bridge.js";
import { processSimulatorScreenshot } from "../simulator/image-processor.js";
import { processManager } from "../simulator/process-manager.js";

let manualActiveDeviceId: string | undefined;

/**
 * Sets the active device ID override manually.
 */
export function setManualActiveDeviceId(id: string): void {
  manualActiveDeviceId = id;
}

/**
 * Returns the currently active device ID according to precedence:
 * explicit argument -> manual override -> processManager pushed device -> simulator.ini -> fallback "fenix847mm".
 */
export function getActiveDeviceId(explicitDeviceId?: string): string {
  if (explicitDeviceId) {
    return explicitDeviceId;
  }
  if (manualActiveDeviceId) {
    return manualActiveDeviceId;
  }
  const procDev = processManager.getCurrentDeviceId();
  if (procDev) {
    return procDev;
  }
  try {
    const iniState = readSimulatorIni();
    if (iniState.lastUsedDevice) {
      return iniState.lastUsedDevice;
    }
  } catch {
    // SDK root or simulator.ini may not be initialized yet
  }
  return "fenix847mm";
}

/**
 * Resolves and parses the DeviceProfile for the active or explicitly requested device.
 */
export function resolveActiveDeviceProfile(
  explicitDeviceId?: string
): DeviceProfile {
  const deviceId = getActiveDeviceId(explicitDeviceId);
  return parseDeviceProfile(deviceId);
}

/**
 * Translates a watch bezel-relative coordinate (0..bezelWidth, 0..bezelHeight)
 * to an absolute macOS screen coordinate (X, Y) suitable for Quartz / CGEvent.
 */
export function bezelPointToScreenPoint(
  bezelPt: Point,
  windowBounds: Rect,
  profile: DeviceProfile,
  contentOffset?: Point,
  scale = 1
): Point {
  if (contentOffset) {
    return { x: Math.round(windowBounds.x + contentOffset.x + bezelPt.x * scale), y: Math.round(windowBounds.y + contentOffset.y + bezelPt.y * scale) };
  }
  const canvasOrigin = computeCanvasOrigin(
    windowBounds,
    profile.bezelDimensions
  );
  return {
    x: Math.round(windowBounds.x + canvasOrigin.x + bezelPt.x),
    y: Math.round(windowBounds.y + canvasOrigin.y + bezelPt.y),
  };
}

/**
 * Translates a watch display-relative coordinate (0..displayWidth, 0..displayHeight)
 * to an absolute macOS screen coordinate (X, Y) suitable for Quartz / CGEvent.
 */
export function watchPointToScreenPoint(
  watchPt: Point,
  windowBounds: Rect,
  profile: DeviceProfile,
  contentOffset?: Point,
  scale = 1
): Point {
  return bezelPointToScreenPoint(
    {
      x: profile.display.location.x + watchPt.x,
      y: profile.display.location.y + watchPt.y,
    },
    windowBounds,
    profile,
    contentOffset,
    scale
  );
}

export type McpToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Captures a screenshot from the running Connect IQ simulator window, processes it
 * into the requested view mode ("screen", "bezel", or "annotated"), and formats it
 * as MCP content blocks (image block + concise text summary).
 */
export async function captureAndFormatScreenshot(options?: {
  view?: ScreenshotViewMode;
  deviceId?: string;
  savePath?: string;
}): Promise<{
  screenshot: ProcessedScreenshot;
  mcpContent: McpToolContent[];
}> {
  const windowInfo = await getWindowInfo();

  if (!windowInfo.running || !windowInfo.windowId || !windowInfo.bounds) {
    throw new Error(
      "Connect IQ simulator window is not running or not visible. Launch the simulator first using launch_simulator."
    );
  }

  const profile = resolveActiveDeviceProfile(options?.deviceId);
  const rawWindowPng = await captureRawWindowPng(windowInfo.windowId, windowInfo.scale);

  const screenshot = await processSimulatorScreenshot({
    rawWindowPng,
    windowBounds: windowInfo.bounds,
    contentOffset: windowInfo.contentOffset,
    windowScale: windowInfo.scale,
    profile,
    view: options?.view ?? "screen",
    savePath: options?.savePath,
  });

  const metadataText =
    `Garmin simulator screenshot captured [device: ${screenshot.deviceId}, ` +
    `view: ${screenshot.view}, dimensions: ${screenshot.width}x${screenshot.height}px` +
    `${screenshot.savedPath ? `, saved: ${screenshot.savedPath}` : ""}].`;

  const mcpContent: McpToolContent[] = [
    {
      type: "image",
      data: screenshot.base64Png,
      mimeType: "image/png",
    },
    {
      type: "text",
      text: metadataText,
    },
  ];

  return {
    screenshot,
    mcpContent,
  };
}
