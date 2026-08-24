# Changelog

All notable changes to CP Helper are documented in this file.

Versioning from 1.0.0 follows SemVer: MAJOR.MINOR.PATCH.

## [1.0.7] - 2026-08-24

### Fixed
- OJ Sync now reads Codeforces samples one line per line. Codeforces separates sample lines with `<br>` rather than newlines, so the previous `textContent` read imported `3`, `1 2`, `420 421` as the single line `31 2420 421...`. Block-level line wrappers (the newer `test-example-line` layout), CRLF, trailing spaces, and trailing blank lines are normalized as well.
- OJ Sync import now starts Run all even when the Samples view has not been opened in this window (for example CP Helper docked in the panel while the terminal has focus). The run request waited on a fixed 120 ms timer and reached a webview whose case list was still empty, so nothing ran; it is now held until the webview has its cases. The `Run First Sample` / `Run All Samples` commands use the same path.
- Revealing the Samples view now follows the view to wherever it is docked, so an OJ Sync import switches the panel to CP Helper on the first import of a window too. `workbench.view.extension.cp-helper` only opens the container in its contributed location (secondary sidebar), which is a no-op for a container dragged into the panel; the view's own focus command is used instead.
- A failed Samples view reveal no longer makes the local import POST fail after the samples were already imported.

## [1.0.6] - 2026-08-12

### Fixed
- OJ Sync imports no longer show the previously imported problem when the Samples view was not opened since the window started. The import path now writes `.vscode/.cp-helper-cases.json` as well as workspace state, so the cold webview's `restore` no longer answers with the last problem's cases file.

### Changed
- Run buttons (toolbar, per problem, per sample, and the palette shortcuts) stay enabled during a run and now restart: clicking one kills the running compile/program and starts the new run. The superseded run's results are discarded so they cannot repaint the UI of the run that replaced it. Stop still cancels without starting anything.

## [1.0.5] - 2026-07-26

### Changed
- Output channel now writes structured server-style records: `YYYY-MM-DD HH:MM:SS.mmm LEVEL [scope] message`, with fixed-width level (DEBUG/INFO/WARN/ERROR) and scope (core, webview, compile, runner, stress, import, server) columns.
- Failures are logged at WARN or ERROR instead of sharing one flat level with progress messages (compile failures, stopped runs, rejected checker runs, non-AC verdicts, export/save/clipboard errors, port already in use).
- Each sample is now a single record - `sample 3: WA exit=0 time=13ms in=386B out=12B` - replacing the previous four lines per sample. Expected and actual output are dumped as indented detail lines only when the sample fails.
- The run command is logged once per run instead of repeated for every sample in a batch.
- Run all ends with a summary record, `run all: 2/3 passed in 37ms`, replacing the contentless "Run all: finished".
- Activation logs the extension version instead of instructions for finding the log.

## [1.0.4] - 2026-06-17

### Changed
- Replace non-ASCII typographic characters (em dashes, ellipses, arrows, curly quotes) with ASCII equivalents in all source files and documentation.

## [1.0.3] - 2026-04-24

### Changed
- Verdict labels are now pill-shaped badges with colour-coded background and border (green/red/blue/amber) for faster at-a-glance scanning.
- Case numbers in the test-case header are displayed as small rounded badges instead of bare text.
- Added a copy-to-clipboard button on every Stdout and Stderr output field; button flashes green on success.
- Elapsed time now renders as `234ms` below 1 s and `1.23s` at or above, replacing the raw millisecond integer.
- Case cards gain a subtle box-shadow on hover for clearer interactivity.
- Case-group panels fade and slide in when expanded (CSS animation).
- Export icon flashes green for 2.5 s after a successful file export.
- Improved empty-state message to mention JSON paste, OJ Sync, and custom groups.
- Clarified import-textarea placeholder text.

## [1.0.2] - 2026-04-23

### Changed
- Fix integer output tokens now requiring exact match; epsilon tolerance no longer applies to plain integers, preventing false AC verdicts (e.g. `635270835` wrongly matching `635270834`).

## [1.0.1] - 2026-04-22

### Changed
- Replaced all text buttons with icon-only SVG buttons for a more compact UI.

## [1.0.0] - 2026-04-13

First stable release. Behavior is equivalent to 0.4.19; this release marks production readiness.

### Highlights
- C++ samples runner with AC/WA/TLE/RE verdicts.
- Samples webview in the secondary sidebar with per-case Run and Run all.
- Import via JSON paste, clipboard command, vscode:// URI, or local HTTP POST /import.
- Float-aware output comparison, optional -DLOCAL compile flag, and Stop support.
- Added execution-time display in verdict badges.
- Added relative float epsilon setting (cp-helper.floatRelEpsilon).
- Added hardened local import and runner limits (413 on oversized body, output caps).
- Added runtime validation for webview run messages.
- Added custom checker command for non-unique outputs.
- Added compile preset picker command.
- Added persisted case file at .vscode/.cp-helper-cases.json.
- Added case export to testcases/sample_N.in|out.
- Added stress-test command with generator/reference workflow.
- OJ Sync companion aligned to 1.0.0 for CP Helper 1.0.0.

## Earlier versions

Pre-1.0 development history (0.2.8 to 0.4.19) is in docs/CHANGELOG-pre-1.0.md.
