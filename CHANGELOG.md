# Changelog

All notable changes to CP Helper are documented in this file.

Versioning from 1.0.0 follows SemVer: MAJOR.MINOR.PATCH.

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
