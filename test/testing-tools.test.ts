import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snapshotAppFiles, restoreAppFiles, validateAppNames, appFilePatterns } from "../src/tools/testing.js";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-state-tools-"));
try {
  const root = path.join(temporary, "APPS");
  await fs.mkdir(path.join(root, "DATA/OBJSTORE/TEST"), { recursive: true });
  await fs.writeFile(path.join(root, "DATA/TEST.DAT"), "original");
  await fs.writeFile(path.join(root, "DATA/OTHER.DAT"), "unrelated");
  const snapshot = path.join(temporary, "backup");
  const saved = await snapshotAppFiles(snapshot, ["TEST"], root);
  assert.equal(Object.keys(saved.files).length, 1);
  await assert.rejects(snapshotAppFiles(snapshot, ["TEST"], root));
  await fs.writeFile(path.join(root, "DATA/TEST.DAT"), "changed");
  await fs.writeFile(path.join(root, "DATA/OBJSTORE/TEST/new.cmp"), "new");
  await restoreAppFiles(snapshot, ["TEST"], root);
  assert.equal(await fs.readFile(path.join(root, "DATA/TEST.DAT"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(root, "DATA/OTHER.DAT"), "utf8"), "unrelated");
  await assert.rejects(fs.access(path.join(root, "DATA/OBJSTORE/TEST/new.cmp")));
  await assert.rejects(restoreAppFiles(snapshot, ["OTHER"], root));
  await fs.writeFile(path.join(snapshot, "files/DATA/TEST.DAT"), "tampered");
  await assert.rejects(restoreAppFiles(snapshot, ["TEST"], root));
  for (const invalid of [[], ["../TEST"], [""], ["test"], ["TEST.PRG"], ["DATA"], ["OBJSTORE"], ["SETTINGS"]]) assert.throws(() => validateAppNames(invalid));
  // Only the app's own documented locations may match.
  const patterns = appFilePatterns("TEST");
  const matches = (p: string) => patterns.some((pattern) => pattern.test(p));
  assert.equal(matches("DATA/TEST.DAT"), true);
  assert.equal(matches("SETTINGS/TEST.SET"), true);
  assert.equal(matches("MEDIA/TEST.PRG"), true);
  assert.equal(matches("DATA/MEDIA/OBJSTORE/TEST/TEST.SEN"), true);
  assert.equal(matches("DATA/OTHER.DAT"), false);
  assert.equal(matches("DATA/MEDIA/OBJSTORE/OTHER/TEST.CMP"), false);
  assert.equal(matches("DATA/TEST2.DAT"), false);
  assert.deepEqual(validateAppNames(["B", "A"]), ["A", "B"]);
  // Intermediate directory swapped for a symlink must be refused.
  const symlinkSnapshot = path.join(temporary, "backup-symlink");
  await snapshotAppFiles(symlinkSnapshot, ["TEST"], root);
  await fs.rename(path.join(symlinkSnapshot, "files/DATA"), path.join(symlinkSnapshot, "files/DATA-real"));
  await fs.symlink(path.join(symlinkSnapshot, "files/DATA-real"), path.join(symlinkSnapshot, "files/DATA"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(restoreAppFiles(symlinkSnapshot, ["TEST"], root), /symbolic link/);
  console.log("PASS snapshot/readback, restore, scoped cleanup, unrelated preservation, identity, checksum, overwrite and path safety");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
