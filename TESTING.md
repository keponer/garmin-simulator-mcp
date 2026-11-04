# Testing and result integrity

`npm test` runs metadata, bridge/image, tool, process-manager, result-parser and unit-runner regression suites serially. The bridge/image suite uses synthetic images, not a live screenshot. Some suites inspect the installed SDK/window status; these are not app functional tests or cross-device app executions.

On Windows it also opens temporary native test windows to check executable matching, ambiguous processes, maximized/minimized geometry, foreground input guarding, native button activation, and storage-editor closure. These fixtures do not operate the installed Garmin simulator or its app data.

`npm run test:e2e` retains the existing live client verification. It can press a button on the active app when Screen Recording is enabled; run it only in an isolated simulator session. Its conditional skip of live captures must not be described as a successful live capture.

`npm run build:ts` rebuilds the server. Existing connected clients keep their loaded code until restarted. Use a fresh stdio client when validating a local change.

## Unit-test result contract

`run_unit_tests` now returns the raw output, a structured `summary`, exit status, signal and timeout state. Success requires:
- Exactly one SDK `RESULTS` table, `Ran N test(s)` count and terminal summary.
- At least one executed test and one named table result per executed test.
- Consistent passed/failed/error counts, no duplicate names and no conflicting error/verdict output.
- Zero failed/error tests, normal zero exit and no timeout.

Unrecognized output is incomplete, not success. If a later SDK uses a different format, add real output fixtures and corresponding parser tests before accepting it. The parser regression samples currently follow Garmin's documented output; no Mood Check-in test output has yet been obtained because its source does not compile.

An app startup timeout or zero launcher exit without a recognized startup marker is no longer reported as a confirmed launch. The existing accepted startup markers still need validation against a real successful app session. Native app stop semantics, background isolation, structured storage/time/sensor/notification controls and complication readback remain to be implemented/verified when app testing can proceed.

## Startup reporting

`monkeydo` consumes its `deviceStarted`/`appStarted` protocol messages internally and prints nothing, so a printed marker is rare. `run_app` now reports `launched: true` when the launcher is alive past `wait_ms` with no fatal output (`startupConfirmed: false`), or `startupConfirmed: true` when a marker is seen. Fatal launcher text (`Unable to connect to simulator`, `Encountered an app crash`, signature/PRG errors) fails the launch, and a launcher exit never counts as a launch.

## Storage scope

`snapshot_app_files` / `restore_app_files` only touch the simulator's documented per-app locations: `DATA/<APP>.{DAT,IDX,IMT}`, `SETTINGS/<APP>.SET`, `MEDIA/<APP>.PRG` and `[DATA/]DATA/MEDIA/OBJSTORE/<APP>/`. Container names (`DATA`, `SETTINGS`, `MEDIA`, `OBJSTORE`, …) are rejected, names are sorted for stable manifests, and restore refuses symlinks, checksums, and a directory inside simulator storage. Note that the simulator also keeps state in `GARMIN/sys.nfm`; file-level restore alone cannot reset app storage.

## Misc

- `set_glance_mode` uses `Settings > Glance Launch Mode` and honours omitted `enabled` as a toggle.
- `npm run typecheck:test` type-checks the test suite separately (`tsconfig.test.json`).
