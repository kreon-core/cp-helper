# CP Helper - pre-1.0 history

Condensed development history from 0.2.8 to 0.4.19.
For 1.x releases, see CHANGELOG.md.

## 0.4.x (stabilization before 1.0)

- Locked scope to C++ workflows.
- Hardened LeetCode import behavior and starterCode clipboard flow.
- Added C++ dispatch-main generation for LeetCode-style class solutions.
- Simplified legacy command compatibility and finalized cpHelper command namespace.
- Improved OJ Sync extraction accuracy and payload normalization.

## 0.3.x (rename and integration phase)

- Renamed project and identifiers to CP Helper / cp-helper conventions.
- Renamed cp-extractor to OJ Sync and aligned payload source naming.
- Added and refined local HTTP import server behavior.
- Simplified settings and removed legacy compatibility branches.

## 0.2.x (foundation phase)

- Built the core samples webview workflow (import, edit, run, verdicts).
- Added URI and clipboard import commands.
- Added run lifecycle improvements: source snapshot, dirty-save before run, stop handling.
- Refined keybinding/focus behavior so shortcuts work from editor and webview contexts.
- Iterated UI compactness, readability, and stream rendering limits.

## Milestone snapshots

- 0.2.8: Initial changelog and release-process documentation.
- 0.2.38: Local POST /import path introduced for browser companion.
- 0.3.0: Breaking rename to CP Helper identifiers and workbench ids.
- 0.3.1: Companion extension renamed to OJ Sync.
- 0.4.0: Legacy settings/aliases cleanup completed.
- 0.4.19: Final pre-1.0 C++-only stabilization baseline.

Use git history for per-commit detail.
