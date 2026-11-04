#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { testingResult, inspectUI, actOnUI, snapshotAppFiles, restoreAppFiles } from "./tools/testing.js";
import { runBridgeCommand } from "./simulator/bridge.js";
import { processManager } from "./simulator/process-manager.js";
import {
  handleBuildApp,
  handleLaunchSimulator,
  handleListDevices,
  handleRunApp,
  handleRunUnitTests,
  handleSetActiveDevice,
  handleSimulatorStatus,
  handleStopApp,
} from "./tools/lifecycle.js";
import {
  handleHoldScreen,
  handlePressButton,
  handlePressButtonSequence,
  handleSendKey,
  handleSwipeScreen,
  handleTapScreen,
} from "./tools/navigation.js";
import {
  handleGetAppLogs,
  handleGetScreenshot,
} from "./tools/visual.js";
import {
  handleSetGlanceMode,
  handleTriggerMenuAction,
} from "./tools/environment.js";

/**
 * Creates and configures the Garmin Emulator MCP Server with all 17 automation tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "garmin-emulator-mcp",
    version: "0.1.0",
  });

  // ==========================================
  // Lifecycle Tools
  // ==========================================

  server.tool(
    "simulator_status",
    "Inspect Connect IQ simulator process status, window ID, bounds, macOS Screen Recording and Accessibility permissions, TCP port 1234 status, and active device profile metadata.",
    {},
    async () => handleSimulatorStatus()
  );

  server.tool(
    "launch_simulator",
    "Launch the Garmin Connect IQ simulator application (ConnectIQ.app) from the SDK and wait for its TCP port 1234 to be open.",
    {
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Maximum milliseconds to wait for the simulator TCP port 1234 to open (default: 15000)"
        ),
    },
    async (args) => handleLaunchSimulator(args)
  );

  server.tool(
    "list_devices",
    "List all installed Garmin device profiles in Connect IQ SDK Devices directory with display resolutions, touch support, screen shape, and available buttons.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Filter devices by ID or display name substring (e.g. 'fenix', 'forerunner', 'venu', 'edge')"
        ),
      touch_only: z
        .boolean()
        .optional()
        .describe("Only return touchscreen-enabled devices"),
    },
    async (args) => handleListDevices(args)
  );

  server.tool(
    "set_active_device",
    "Set the active Garmin device ID for subsequent simulator commands, button presses, touch gestures, and screenshot cropping.",
    {
      device_id: z
        .string()
        .describe(
          "Target device ID (e.g. 'fenix847mm', 'venu3', 'fr965', 'epix2pro47mm')"
        ),
    },
    async (args) => handleSetActiveDevice(args)
  );

  server.tool(
    "build_app",
    "Build a Monkey C project for a specified device using the SDK monkeyc compiler.",
    {
      project_dir: z
        .string()
        .describe(
          "Path to Monkey C project directory containing monkey.jungle or manifest.xml"
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Garmin device ID to build for (e.g. 'fenix847mm'). Defaults to active device."
        ),
      jungle_file: z
        .string()
        .optional()
        .describe(
          "Path to jungle build file (defaults to project_dir/monkey.jungle)"
        ),
      developer_key_path: z
        .string()
        .optional()
        .describe(
          "Path to developer key (.der). Defaults to developer_key.der in project or SDK."
        ),
      output_prg_path: z
        .string()
        .optional()
        .describe("Destination file path for output .prg binary"),
      extra_args: z
        .array(z.string())
        .optional()
        .describe("Extra CLI flags to pass directly to monkeyc"),
    },
    async (args) => handleBuildApp(args)
  );

  server.tool(
    "run_app",
    "Push and run a compiled Monkey C executable (.prg) on the active device in the simulator using monkeydo, and stream logs.",
    {
      prg_path: z
        .string()
        .describe("Path to the compiled executable .prg file"),
      device_id: z
        .string()
        .optional()
        .describe("Garmin device ID to run on (defaults to active device)"),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait for app launch and initial log output (default: 2500)"
        ),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture and return an initial watch screenshot after launching (default: true)"
        ),
    },
    async (args) => handleRunApp(args)
  );

  server.tool(
    "stop_app",
    "Stop the currently running Garmin Monkey C app process in the simulator.",
    {},
    async () => handleStopApp()
  );

  server.tool(
    "run_unit_tests",
    "Run Monkey C unit tests for a compiled .prg test binary in the simulator using monkeydo -t.",
    {
      prg_path: z
        .string()
        .describe("Path to compiled test .prg executable"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID to execute tests on (defaults to active device)"),
      test_name: z
        .string()
        .optional()
        .describe("Optional specific test name or suite prefix to execute"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Maximum execution timeout in milliseconds (default: 30000)"),
    },
    async (args) => handleRunUnitTests(args)
  );

  // ==========================================
  // Navigation & User Input Tools
  // ==========================================

  server.tool(
    "press_button",
    "Press a physical bezel button on the active Garmin device (e.g. 'select', 'back', 'up', 'down', 'menu'). Supports short clicks or long-press holds, and returns the updated watch screen.",
    {
      button: z
        .string()
        .describe(
          "Button identifier or alias (e.g. 'select', 'enter', 'start', 'back', 'esc', 'up', 'down', 'menu')"
        ),
      hold: z
        .boolean()
        .optional()
        .describe("Perform a long press (hold) instead of short click"),
      hold_ms: z
        .number()
        .optional()
        .describe(
          "Custom hold duration in milliseconds (defaults to 1200ms for hold, 80ms for short click)"
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Device profile ID to resolve button coordinates from (defaults to active device)"
        ),
      method: z
        .enum(["mouse", "key"])
        .optional()
        .describe(
          "Input synthesis method: 'mouse' clicks bezel hitbox center; 'key' sends macOS virtual keycode (default: 'mouse')"
        ),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture and return a screenshot after the button press (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after button press before capturing screenshot (default: 350)"
        ),
    },
    async (args) => handlePressButton(args)
  );

  server.tool(
    "press_button_sequence",
    "Execute a sequence of button presses in order with configurable delays, capturing the final watch screen.",
    {
      steps: z
        .array(
          z.object({
            button: z.string().describe("Button name"),
            hold: z.boolean().optional().describe("Long press"),
            hold_ms: z.number().optional().describe("Custom hold ms"),
            wait_ms: z
              .number()
              .optional()
              .describe("Delay after step (default: 300ms)"),
          })
        )
        .describe("List of button press steps to execute in sequence"),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after sequence completes (default: true)"
        ),
    },
    async (args) => handlePressButtonSequence(args)
  );

  server.tool(
    "send_key",
    "Send a platform virtual key code or named key ('enter', 'esc', 'up', 'down', 'menu', 'space') to the Connect IQ simulator window.",
    {
      key: z
        .string()
        .optional()
        .describe(
          "Key name or alias (e.g. 'enter', 'return', 'select', 'esc', 'back', 'up', 'down', 'menu', 'space')"
        ),
      key_code: z
        .number()
        .optional()
        .describe(
          "Platform virtual key code (Windows and macOS use different codes)"
        ),
      hold_ms: z
        .number()
        .optional()
        .describe("Key hold duration in milliseconds (default: 80)"),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture and return a screenshot after key press (default: false)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after key press before capturing screenshot (default: 350)"
        ),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
    },
    async (args) => handleSendKey(args)
  );

  server.tool(
    "tap_screen",
    "Tap the watch touchscreen at specific display coordinates (X, Y) or normalized coordinates (0.0..1.0).",
    {
      x: z
        .number()
        .describe(
          "X coordinate: display pixels (0..width) or normalized ratio (0.0..1.0 if normalized: true)"
        ),
      y: z
        .number()
        .describe(
          "Y coordinate: display pixels (0..height) or normalized ratio (0.0..1.0 if normalized: true)"
        ),
      normalized: z
        .boolean()
        .optional()
        .describe(
          "Whether coordinates are normalized 0.0 to 1.0 (default: false)"
        ),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after tapping (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after tap before capturing screenshot (default: 350)"
        ),
    },
    async (args) => handleTapScreen(args)
  );

  server.tool(
    "swipe_screen",
    "Synthesize a touch drag gesture on the watch display in a cardinal direction ('up', 'down', 'left', 'right'), adhering to device gesture thresholds.",
    {
      direction: z
        .enum(["up", "down", "left", "right"])
        .describe(
          "Direction of swipe gesture: 'up' (next page), 'down' (previous page), 'right' (back/exit), 'left'"
        ),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after swiping (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after swipe before capturing screenshot (default: 350)"
        ),
    },
    async (args) => handleSwipeScreen(args)
  );

  server.tool(
    "hold_screen",
    "Long-press at specific coordinates on the watch touchscreen (e.g. to open a watchface complication or menu).",
    {
      x: z
        .number()
        .describe("X coordinate: display pixels or normalized ratio"),
      y: z
        .number()
        .describe("Y coordinate: display pixels or normalized ratio"),
      duration_ms: z
        .number()
        .optional()
        .describe("Touch hold duration in milliseconds (default: 1000)"),
      normalized: z
        .boolean()
        .optional()
        .describe(
          "Whether coordinates are normalized 0.0 to 1.0 (default: false)"
        ),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after holding (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after touch before capturing screenshot (default: 350)"
        ),
    },
    async (args) => handleHoldScreen(args)
  );

  // ==========================================
  // Visual Inspection & Logs Tools
  // ==========================================

  server.tool(
    "get_screenshot",
    "Capture a screenshot of the Connect IQ simulator. Supports watch display crop ('screen', 1:1 pixel mapping), full window with bezel ('bezel'), or annotated debug view with button hitboxes and coordinate grid ('annotated').",
    {
      view: z
        .enum(["screen", "bezel", "annotated"])
        .optional()
        .describe(
          "Screenshot view mode: 'screen' crops to watch display; 'bezel' captures device bezel; 'annotated' composites SVG debug overlay (default: 'screen')"
        ),
      device_id: z
        .string()
        .optional()
        .describe("Device profile ID (defaults to active device)"),
      save_path: z
        .string()
        .optional()
        .describe("Optional file path on disk to save the PNG image"),
    },
    async (args) => handleGetScreenshot(args)
  );

  server.tool(
    "get_app_logs",
    "Retrieve console output, System.println logs, and crash traces from the running Monkey C application and simulator.",
    {
      lines: z
        .number()
        .optional()
        .describe(
          "Number of most recent log lines to retrieve (defaults to all)"
        ),
      clear: z
        .boolean()
        .optional()
        .describe(
          "Whether to clear the log buffer after reading (default: false)"
        ),
    },
    async (args) => handleGetAppLogs(args)
  );

  // ==========================================
  // Environment & Menu Automation Tools
  // ==========================================

  server.tool(
    "trigger_menu_action",
    "Trigger a macOS menu item in ConnectIQ.app via Accessibility (AXUIElement), such as simulation data or activity settings.",
    {
      menu_path: z
        .array(z.string())
        .describe(
          "Hierarchical menu path to click, e.g. ['Simulation', 'Activity Data'] or ['Settings', 'Glance View']"
        ),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after menu trigger (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait after menu click before capturing screenshot (default: 400)"
        ),
    },
    async (args) => handleTriggerMenuAction(args)
  );

  server.tool(
    "set_glance_mode",
    "Toggle or set the simulator Glance View mode (Settings > Glance View) for testing widget glance summaries.",
    {
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Target glance view state (true to enable, false to disable, or omitted to toggle)"
        ),
      capture_after: z
        .boolean()
        .optional()
        .describe(
          "Whether to capture a screenshot after toggling (default: true)"
        ),
      wait_ms: z
        .number()
        .optional()
        .describe(
          "Milliseconds to wait before capturing screenshot (default: 400)"
        ),
    },
    async (args) => handleSetGlanceMode(args)
  );

  server.tool("inspect_ui", "Read simulator Accessibility hierarchy, including menus and native dialogs. Paths are ephemeral: inspect before acting.",
    { depth: z.number().int().min(1).max(14).default(7) },
    async ({ depth }) => testingResult(() => inspectUI(depth)));
  server.tool("act_on_ui", "Act on a freshly inspected native simulator element. set writes AXValue; AXPress activates controls.",
    { path: z.array(z.number().int().nonnegative()).min(1), action: z.enum(["set", "select", "focus", "AXPress", "AXConfirm", "AXIncrement", "AXDecrement"]), value: z.string().optional() },
    async (args) => testingResult(() => actOnUI(args.path, args.action, args.value)));
  server.tool("snapshot_app_files", "Back up only files matching explicit PRG basenames from simulator APPS. Does not stop the app; use an idle/stopped session.",
    { directory: z.string(), app_names: z.array(z.string()) },
    async (args) => testingResult(() => snapshotAppFiles(args.directory, args.app_names)));
  server.tool("restore_app_files", "Restore a verified app-scoped snapshot. Requires explicit confirmation and a stopped app; never use while app/background writes are active.",
    { directory: z.string(), app_names: z.array(z.string()), confirm_stopped: z.literal(true) },
    async (args) => testingResult(() => restoreAppFiles(args.directory, args.app_names)));
  server.tool("terminate_simulator", "Terminate only ConnectIQ.app; force is for an unresponsive simulator. Does not delete stored data. Relaunch separately after confirming stopped status.",
    { force: z.boolean().default(false) },
    async ({ force }) => testingResult(() => runBridgeCommand(["terminate", ...(force ? ["--force"] : [])])));
  server.tool("recognize_image_text", "Recognize text in a saved simulator PNG using on-device OCR. Returns text and normalized bounds; confidence is available on macOS. OCR is evidence, not a replacement for storage assertions.",
    { image_path: z.string() },
    async ({ image_path }) => testingResult(() => runBridgeCommand(["ocr", image_path])));
  server.tool("close_storage_editor", "Close the simulator's persistent-storage editor and verify the window is gone. Safe when already closed.",
    {},
    async () => testingResult(() => runBridgeCommand(["storage-close"])));
  return server;
}

/**
 * Server main function: starts the stdio transport.
 */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Do not leave a simulator launcher behind when this server exits; stale
  // monkeydo/shell processes accumulate and fight over port 1234.
  const killChild = () => {
    const child = processManager.getActiveProcess();
    if (child) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
  };
  process.once("exit", killChild);
  process.once("SIGINT", () => { killChild(); process.exit(0); });
  process.once("SIGTERM", () => { killChild(); process.exit(0); });
  // A stdio client that just closes the pipe leaves no signal and no exit, so the
  // server used to outlive its client with the monkeydo child still attached.
  const shutdown = () => { killChild(); process.exit(0); };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
}

// Run main if this is the entry script
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"));

if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error starting Garmin Emulator MCP server:", err);
    process.exit(1);
  });
}
