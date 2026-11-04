import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const encode = (text: string) => Buffer.from(text).toString("base64");

async function run() {
  if (process.platform !== "win32") { console.log("SKIP Windows native bridge tests on this platform"); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-native-test-"));
  const expected = path.join(root, "sdk", "simulator.exe");
  const unrelated = path.join(root, "unrelated", "simulator.exe");
  const processes: ChildProcess[] = [];
  const bridge = async (args: string[]) => {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(repo, "src/native/windows-bridge.ps1"), encode(JSON.stringify(args)), expected]);
    return JSON.parse(stdout.trim());
  };
  const start = async (exe: string, mode = "normal") => {
    const child = spawn(exe, [mode], { stdio: "ignore" });
    processes.push(child);
    await once(child, "spawn");
    await exec("powershell.exe", ["-NoProfile", "-Command",
      `$p=Get-Process -Id ${child.pid}; for($i=0;$i -lt 40;$i++){ $p.Refresh(); if($p.MainWindowHandle -ne 0){exit 0}; Start-Sleep -Milliseconds 100 }; exit 1`]);
    return child;
  };
  const stop = async (child: ChildProcess) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill(); await exited;
  };
  type Node = { AXTitle?: string; path: number[]; children?: Node[] };
  const find = (node: Node, title: string): Node | undefined =>
    node.AXTitle === title ? node : node.children?.map(child => find(child, title)).find(Boolean);
  try {
    await fs.mkdir(path.dirname(expected)); await fs.mkdir(path.dirname(unrelated));
    const source = await fs.readFile(path.join(repo, "test/fixtures/windows-simulator.cs"), "utf8");
    const build = `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(source)}')); ` +
      `$output=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(expected)}')); ` +
      "Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $output -OutputType WindowsApplication";
    await exec("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(build, "utf16le").toString("base64")]);
    await fs.copyFile(expected, unrelated);
    const other = await start(unrelated);
    assert.equal((await bridge(["window-info"])).running, false);
    assert.equal((await bridge(["terminate", "--force"])).alreadyStopped, true);
    assert.equal(other.exitCode, null, "unrelated simulator must remain alive");
    console.log("PASS ignores unrelated simulator.exe, including forced termination");

    const main = await start(expected, "maximized");
    const before = await bridge(["window-info"]);
    assert.equal(before.pid, main.pid);
    const focused = await bridge(["raise"]);
    assert.equal(typeof focused.foregroundWindowId, "number", focused.error);
    assert.equal(focused.ok, focused.foregroundWindowId === before.windowId, "success requires the actual foreground window");
    assert.deepEqual((await bridge(["window-info"])).bounds, before.bounds);
    console.log("PASS raise preserves maximized geometry");
    const duplicate = await start(expected);
    const ambiguous = await bridge(["terminate", "--force"]);
    assert.equal(ambiguous.ok, false); assert.match(ambiguous.error, /Multiple Garmin simulators/);
    assert.equal(main.exitCode, null); assert.equal(duplicate.exitCode, null);
    await stop(duplicate); await stop(main);
    console.log("PASS refuses ambiguous simulator instances");

    const minimized = await start(expected, "minimized");
    await bridge(["raise"]);
    const restored = await bridge(["window-info"]);
    assert.ok(restored.bounds.x > -30000 && restored.bounds.y > -30000);
    await stop(minimized);
    console.log("PASS restores minimized windows");

    const modal = await start(expected, "modal-editor");
    for (const args of [["key", "--code", "invalid"], ["click", "--x", "invalid"], ["drag", "--x1", "invalid"]]) {
      const blocked = await bridge(args);
      assert.equal(blocked.ok, false);
      assert.match(blocked.error, /not the foreground window; no input was sent/);
    }
    await stop(modal);
    console.log("PASS blocks key, click and drag when the main window is not foreground");

    const editor = await start(expected, "editor");
    const inspected = await bridge(["ui-tree", "4"]);
    const cancel = find(inspected.tree, "Cancel"); assert.ok(cancel);
    const press = await bridge(["ui-action", cancel.path.join("."), "AXPress"]);
    assert.equal(press.ok, true, press.error);
    assert.equal(find((await bridge(["ui-tree", "4"])).tree, "Modify Object Store"), undefined);
    await stop(editor);
    console.log("PASS activates native Cancel through its freshly inspected path");

    const closeable = await start(expected, "editor");
    const closed = await bridge(["storage-close"]);
    assert.equal(closed.closed, true, closed.error);
    assert.equal(find((await bridge(["ui-tree", "4"])).tree, "Modify Object Store"), undefined);
    assert.equal((await bridge(["storage-close"])).alreadyClosed, true);
    await stop(closeable);
    const held = await start(expected, "hold-editor");
    const failed = await bridge(["storage-close"]);
    assert.equal(failed.ok, false); assert.match(failed.error, /remained open/);
    assert.ok(find((await bridge(["ui-tree", "4"])).tree, "Modify Object Store"));
    await stop(held);
    console.log("PASS closes owned storage editor and rejects unsuccessful cancellation");
  } finally {
    for (const child of processes) await stop(child);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
}
await run();
