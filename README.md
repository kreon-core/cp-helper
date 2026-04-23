# CP Helper

CP Helper is a Visual Studio Code extension for competitive programming workflows.

It runs C++ code against imported sample cases and reports AC, WA, TLE, or RE.

## Release scope

- Stable baseline: 1.0.2
- Language support: C++ only
- Companion browser extension: OJ Sync 1.0.2

## Requirements

- Visual Studio Code >= 1.82.0 (official Microsoft build)

## Install

- VSIX install: run npm run vsix, then use Extensions: Install from VSIX.
- Development: npm install, npm run compile, then press F5 (Run Extension).

## Quick start

1. Open a C++ source file.
2. Open CP Helper in the secondary sidebar.
3. Import sample JSON.
4. Click Run all or Run per case.

Sample JSON:

```json
[{ "sample": 1, "input": "1 2\n", "output": "3\n" }]
```

## Main commands

| Command | Purpose |
| --- | --- |
| cpHelper.focusSamples | Open the Samples view |
| cpHelper.runFirstSample | Run first sample in group 0 |
| cpHelper.runAllSamples | Run all samples in group 0 |
| cpHelper.importFromClipboard | Import JSON from clipboard |
| cpHelper.showOutput | Show CP Helper output channel |

Default keybindings:

- Ctrl+' / Cmd+': run first sample
- Ctrl+Enter / Cmd+Enter: run all samples

## Key settings

| Setting | Purpose |
| --- | --- |
| cp-helper.compileCommand | Compile command template |
| cp-helper.runCommand | Execute command template |
| cp-helper.runTimeoutMs | Compile/run timeout in ms |
| cp-helper.floatAbsEpsilon | Absolute float tolerance |
| cp-helper.floatRelEpsilon | Relative float tolerance |
| cp-helper.trimOutput | Trim trailing whitespace before compare |
| cp-helper.enableLocalImportServer | Enable localhost import server |
| cp-helper.localImportPort | Local import port (default 17337) |
| cp-helper.instantRunAllOnLocalImport | Auto-run after single-group local import |

## Import methods

- Local HTTP: POST to http://127.0.0.1:<port>/import
- Clipboard command: cpHelper.importFromClipboard
- URI handler: vscode://from-cero.cp-helper/focusSamples or importFromClipboard
- Manual paste into the webview Import box

## Repository layout

| Path | Purpose |
| --- | --- |
| src/ | Extension host source |
| public/ | Webview JS/CSS assets |
| oj-sync/ | Chrome companion extension |
| docs/ | Changelog and behavior notes |

## Publishing checklist

1. Bump package.json version.
2. Bump oj-sync/manifest.json version.
3. Update CHANGELOG.md.
4. Ensure package-lock.json matches.
5. Run npm run compile.
6. Build package with npm run vsix.
7. Run GitHub Actions release workflow (see docs/RELEASE-WORKFLOW.md).

## More docs

- CHANGELOG.md
- docs/CHANGELOG-pre-1.0.md
- docs/RELEASE-WORKFLOW.md
- oj-sync/README.md

## License

MIT
