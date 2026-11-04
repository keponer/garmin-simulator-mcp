import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {
  DeviceProfile,
  ProcessedScreenshot,
  Rect,
  ScreenshotViewMode
} from "../types.js";
import { computeCanvasOrigin } from "./bridge.js";

/**
 * Escapes characters for safe inclusion in SVG text and attributes.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates an SVG annotation overlay showing the watch screen boundary,
 * coordinate ticks, and physical button hitboxes.
 */
export function generateAnnotationOverlay(
  profile: DeviceProfile,
  bezelW: number,
  bezelH: number
): string {
  const disp = profile.display.location;
  const elements: string[] = [];

  // 1. Green dashed boundary around the watch display
  elements.push(`
    <!-- Screen Display Boundary -->
    <rect x="${disp.x}" y="${disp.y}" width="${disp.width}" height="${disp.height}"
          fill="rgba(0, 230, 118, 0.06)" stroke="#00E676" stroke-width="2" stroke-dasharray="6,4" />
  `);

  // Screen display title badge
  elements.push(`
    <rect x="${disp.x + 4}" y="${disp.y + 4}" width="150" height="20" rx="3" fill="rgba(0, 0, 0, 0.75)" />
    <text x="${disp.x + 8}" y="${disp.y + 18}" fill="#00E676" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="bold">SCREEN (${disp.width}x${disp.height})</text>
  `);

  // Coordinate ticks every 100px along X
  for (let offset = 100; offset < disp.width; offset += 100) {
    const tx = disp.x + offset;
    elements.push(`
      <line x1="${tx}" y1="${disp.y}" x2="${tx}" y2="${disp.y + 8}" stroke="#00E676" stroke-width="1.5" />
      <line x1="${tx}" y1="${disp.y + disp.height - 8}" x2="${tx}" y2="${disp.y + disp.height}" stroke="#00E676" stroke-width="1.5" />
      <text x="${tx}" y="${disp.y + 20}" fill="#00E676" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" text-anchor="middle">${offset}</text>
    `);
  }

  // Coordinate ticks every 100px along Y
  for (let offset = 100; offset < disp.height; offset += 100) {
    const ty = disp.y + offset;
    elements.push(`
      <line x1="${disp.x}" y1="${ty}" x2="${disp.x + 8}" y2="${ty}" stroke="#00E676" stroke-width="1.5" />
      <line x1="${disp.x + disp.width - 8}" y1="${ty}" x2="${disp.x + disp.width}" y2="${ty}" stroke="#00E676" stroke-width="1.5" />
      <text x="${disp.x + 12}" y="${ty + 4}" fill="#00E676" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" text-anchor="start">${offset}</text>
    `);
  }

  // Center crosshair
  const cx = disp.x + Math.round(disp.width / 2);
  const cy = disp.y + Math.round(disp.height / 2);
  elements.push(`
    <line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="#00E676" stroke-width="1.5" />
    <line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="#00E676" stroke-width="1.5" />
    <text x="${cx}" y="${cy - 12}" fill="#00E676" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" text-anchor="middle" font-weight="bold">(${Math.round(disp.width / 2)}, ${Math.round(disp.height / 2)})</text>
  `);

  // 2. Physical button hitboxes
  const colors = [
    "#FF5252",
    "#448AFF",
    "#FFD700",
    "#FF4081",
    "#7C4DFF",
    "#FF9100",
    "#00B0FF",
    "#E040FB"
  ];

  profile.keys.forEach((key, index) => {
    const color = colors[index % colors.length];
    const loc = key.location;
    const label = `${key.id}${key.behavior ? ` (${key.behavior})` : ""}${key.isHold ? " [HOLD]" : ""}`;
    const escapedLabel = escapeXml(label);

    const badgeWidth = Math.max(70, label.length * 6.5 + 12);
    const badgeX = Math.max(2, Math.min(loc.x, bezelW - badgeWidth - 2));
    const badgeY = loc.y > 20 ? loc.y - 6 : loc.y + loc.height + 16;

    elements.push(`
      <!-- Key: ${escapedLabel} -->
      <rect x="${loc.x}" y="${loc.y}" width="${loc.width}" height="${loc.height}"
            fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2" rx="4" />
      <circle cx="${key.center.x}" cy="${key.center.y}" r="3.5" fill="${color}" />
      <rect x="${badgeX}" y="${badgeY - 14}" width="${badgeWidth}" height="16" rx="3" fill="rgba(0, 0, 0, 0.85)" stroke="${color}" stroke-width="1" />
      <text x="${badgeX + 6}" y="${badgeY - 2}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="bold">${escapedLabel}</text>
    `);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bezelW}" height="${bezelH}" viewBox="0 0 ${bezelW} ${bezelH}">${elements.join("\n")}</svg>`;
}

/**
 * Processes a raw window screenshot captured from ConnectIQ.app:
 * 1. Analyzes Retina scale factor (e.g. 2x vs 1x).
 * 2. Crops to client canvas area (bezel) and normalizes to 1x logical coordinates.
 * 3. Renders the requested view mode:
 *    - "screen": tightly cropped to the watch display area (1:1 with tap_screen coordinates).
 *    - "bezel": full 1x simulator bezel.
 *    - "annotated": bezel overlaid with SVG button hitboxes and screen coordinate ticks.
 * 4. Optionally saves the image to disk.
 */
export async function processSimulatorScreenshot(params: {
  rawWindowPng: Buffer;
  windowBounds: Rect;
  contentOffset?: { x: number; y: number };
  windowScale?: number;
  profile: DeviceProfile;
  view: ScreenshotViewMode;
  savePath?: string;
}): Promise<ProcessedScreenshot> {
  const { rawWindowPng, windowBounds, profile, view, savePath } = params;

  // 1. Inspect image dimensions to compute Retina scale factor
  const metadata = await sharp(rawWindowPng).metadata();
  const imgW = metadata.width ?? windowBounds.width;
  const imgH = metadata.height ?? windowBounds.height;

  const scaleX = imgW / (windowBounds.width || 1);
  const scaleY = imgH / (windowBounds.height || 1);

  // 2. Compute canvas origin and 1x bezel dimensions
  const canvasOrigin = params.windowScale && params.contentOffset ? params.contentOffset : computeCanvasOrigin(windowBounds, profile.bezelDimensions);
  const bezelW = profile.bezelDimensions?.width ?? windowBounds.width;
  const bezelH =
    profile.bezelDimensions?.height ??
    Math.max(1, windowBounds.height - canvasOrigin.y);

  // 3. Extract bezel region in raw pixel coordinates
  let rawLeft = Math.round(canvasOrigin.x * scaleX);
  let rawTop = Math.round(canvasOrigin.y * scaleY);
  const deviceScale = params.windowScale && params.contentOffset ? params.windowScale : 1;
  let rawWidth = Math.round(bezelW * scaleX * deviceScale);
  let rawHeight = Math.round(bezelH * scaleY * deviceScale);

  // Clamp within raw image boundaries
  rawLeft = Math.max(0, Math.min(rawLeft, imgW - 1));
  rawTop = Math.max(0, Math.min(rawTop, imgH - 1));
  rawWidth = Math.max(1, Math.min(rawWidth, imgW - rawLeft));
  rawHeight = Math.max(1, Math.min(rawHeight, imgH - rawTop));

  // Extract and resize to 1x logical bezel size
  const bezel1xBuffer = await sharp(rawWindowPng)
    .extract({
      left: rawLeft,
      top: rawTop,
      width: rawWidth,
      height: rawHeight
    })
    .resize(bezelW, bezelH, { fit: "fill" })
    .png()
    .toBuffer();

  let finalBuffer: Buffer;
  let finalWidth: number;
  let finalHeight: number;

  switch (view) {
    case "screen": {
      const disp = profile.display.location;
      const cropLeft = Math.max(0, Math.min(disp.x, bezelW - 1));
      const cropTop = Math.max(0, Math.min(disp.y, bezelH - 1));
      const cropWidth = Math.max(1, Math.min(disp.width, bezelW - cropLeft));
      const cropHeight = Math.max(1, Math.min(disp.height, bezelH - cropTop));

      finalBuffer = await sharp(bezel1xBuffer)
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight
        })
        .png()
        .toBuffer();

      finalWidth = cropWidth;
      finalHeight = cropHeight;
      break;
    }

    case "bezel": {
      finalBuffer = bezel1xBuffer;
      finalWidth = bezelW;
      finalHeight = bezelH;
      break;
    }

    case "annotated": {
      const svg = generateAnnotationOverlay(profile, bezelW, bezelH);
      finalBuffer = await sharp(bezel1xBuffer)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();

      finalWidth = bezelW;
      finalHeight = bezelH;
      break;
    }

    default: {
      const exhaustiveCheck: never = view;
      throw new Error(`Unsupported screenshot view mode: ${exhaustiveCheck}`);
    }
  }

  // 4. Save to disk if requested
  if (savePath) {
    const parentDir = path.dirname(savePath);
    await fs.promises.mkdir(parentDir, { recursive: true });
    await fs.promises.writeFile(savePath, finalBuffer);
  }

  return {
    base64Png: finalBuffer.toString("base64"),
    width: finalWidth,
    height: finalHeight,
    view,
    deviceId: profile.deviceId,
    savedPath: savePath
  };
}
