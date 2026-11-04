export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GarminSdkPaths {
  connectIqRoot: string;
  sdkPath: string;
  binDir: string;
  devicesDir: string;
  simulatorIniPath: string;
  simulatorAppPath: string;
  monkeycPath: string;
  monkeydoPath: string;
  shellPath: string;
}

export interface SimulatorIniState {
  lastUsedDevice?: string;
  windowX?: number;
  windowY?: number;
  windowWidth?: number;
  windowHeight?: number;
  glance?: boolean;
  raw: Record<string, string>;
}

export interface DeviceKeyMapping {
  id: string;
  behavior?: string;
  isHold: boolean;
  location: Rect;
  center: Point;
  aliases: string[];
}

export interface SwipeGestureBehavior {
  gesture: string;
  id?: string;
  maxDistToEdge?: number;
  maxSwipeDuration?: number;
  minSwipeDeltaX?: number;
  minSwipeDeltaY?: number;
}

export interface DeviceDisplayInfo {
  isTouch: boolean;
  shape: string;
  location: Rect;
  behaviors: SwipeGestureBehavior[];
}

export interface DeviceProfile {
  deviceId: string;
  displayName: string;
  deviceFamily?: string;
  displayType?: string;
  partNumber?: string;
  bezelImageFile?: string;
  bezelDimensions?: { width: number; height: number };
  display: DeviceDisplayInfo;
  keys: DeviceKeyMapping[];
}

export interface WindowInfoResponse {
  running: boolean;
  pid?: number;
  windowId?: number;
  bounds?: Rect;
  contentOffset?: Point;
  scale?: number;
  permissions: {
    screenRecording: boolean;
    accessibility: boolean;
  };
  error?: string;
}

export type ScreenshotViewMode = "screen" | "bezel" | "annotated";

export interface ProcessedScreenshot {
  base64Png: string;
  width: number;
  height: number;
  view: ScreenshotViewMode;
  deviceId: string;
  savedPath?: string;
}
