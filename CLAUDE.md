# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile          # compile src/ → out/ (tsc)
npm run watch            # incremental compilation in watch mode
npm run vsix             # package extension as .vsix (vsce package)
npm run vsix:bump        # bump patch version + package .vsix
npm run vsix:local:run   # build & install .vsix into local VS Code profile
```

There are no automated tests. Verification is done by running the extension locally.

## Architecture

CP Helper is a VS Code extension for competitive programming. It runs C++ code against imported test cases from competitive programming sites and reports verdicts (AC/WA/TLE/RE).

The project has two independently packaged components:

**VS Code extension (`src/`, `public/`)**
- TypeScript compiled to CommonJS (`out/`)
- Activates on the "CP Helper: Focus Samples" command and related events
- `extension.ts` — entry point: registers commands, sets up the webview panel, starts the local HTTP import server, and handles URI scheme imports
- `webview-provider.ts` — `WebviewViewProvider` that hosts the secondary sidebar UI; relays messages between the extension host and the webview JS
- `run-tests.ts` — core run engine: compiles the active C++ file, spawns child processes per test case, assigns verdicts
- `run-state.ts` — low-level shell execution wrapper with timeout + SIGKILL support
- `output-compare.ts` — float-aware token comparison (abs + relative epsilon)
- `case-groups.ts` — test case persistence via workspace memento and `.vscode/.cp-helper-cases.json`
- `local-import-server.ts` — listens on `localhost:17337` for JSON POST from OJ Sync
- `compile-expansion.ts` — expands `{{file}}`, `{{out}}`, `{{dir}}` in user-configured compile/run command templates
- `public/cp-helper-view.js` — webview UI (vanilla JS, no bundler); communicates with the extension host via `vscode.postMessage`

**Companion Chrome extension (`oj-sync/`)**
- Scrapes test cases from AtCoder, Codeforces, and LeetCode
- Sends samples as JSON via `POST http://127.0.0.1:17337/import` or via `vscode://` URI
- Version must stay in sync with the VS Code extension version

## Key Data Flow

1. OJ Sync (Chrome) scrapes samples → POSTs JSON to local HTTP server
2. `local-import-server.ts` receives it → calls `import-samples.ts` to validate and normalize
3. Cases are stored via `case-groups.ts` (memento + JSON file)
4. User triggers run → `run-tests.ts` compiles with the configured command, then runs each case
5. Output is compared in `output-compare.ts`; verdict posted back to webview
6. Webview (`public/cp-helper-view.js`) renders results in the secondary sidebar

## Compile/Run Command Templates

User-facing settings (`cp-helper.compileCommand`, `cp-helper.runCommand`) support template tokens expanded by `compile-expansion.ts`:
- `{{file}}` — absolute path to the active C++ source file
- `{{out}}` — absolute path to the compiled binary
- `{{dir}}` — directory of the source file

## Release

Both components share the same version. To release:
1. Update version in `package.json` and `oj-sync/manifest.json`
2. Update `CHANGELOG.md`
3. Push tag `vX.Y.Z` or trigger `.github/workflows/release.yml` manually

The workflow validates that both versions match, compiles, packages, and produces `cp-helper-X.Y.Z.vsix`, `oj-sync-X.Y.Z.zip`, and `SHA256SUMS.txt` as release artifacts. See `docs/RELEASE-WORKFLOW.md` for the full process.

Use the `/release` skill when bumping the version.
