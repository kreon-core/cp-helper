# CP Helper

CP Helper is a Visual Studio Code extension for competitive programming workflows.

It runs C++ code against imported sample cases and reports AC, WA, TLE, or RE.

C++ is the only supported language. Run and Debug target the active C++ editor, or the last one
you visited when the active tab is not C++, and are disabled until one has been opened
(accepted extensions: .cpp, .cc, .cxx, .c++, .cp, .ixx, and .C on case-sensitive filesystems).

## Release scope

- Stable baseline: 1.1.0
- Language support: C++ only
- Companion browser extension: OJ Sync 1.1.0

## Requirements

- Visual Studio Code >= 1.82.0 (official Microsoft build)

## Install

- VSIX install: run npm run vsix, then use Extensions: Install from VSIX.
- Local install: npm run vsix:local:run packages and installs into the "Problem Solving [ C++ ]" profile. Set CP_HELPER_PROFILE to target a different one, for example CP_HELPER_PROFILE="Default" npm run vsix:local:run.
- Development: npm install, npm run compile, then press F5 (Run Extension).

## Quick start

1. Open a C++ source file.
2. Open CP Helper in the secondary sidebar.
3. Import sample JSON. Each import adds a problem to the list; re-importing one you already have
   refreshes it where it sits.
4. Click Run in a problem header, or Run per case. Every run button has a LOCAL twin beside it
   that compiles cp-helper.localCompileCommand instead of cp-helper.compileCommand.

Sample JSON:

```json
[{ "sample": 1, "input": "1 2\n", "output": "3\n" }]
```

## Main commands

| Command | Purpose |
| --- | --- |
| cpHelper.focusSamples | Open the Samples view |
| cpHelper.runFirstSample | Run the first sample of the active problem |
| cpHelper.runFirstSampleLocal | Run the first sample of the active problem with the LOCAL build |
| cpHelper.runAllSamples | Run every sample of the active problem |
| cpHelper.runAllSamplesLocal | Run every sample of the active problem with the LOCAL build |
| cpHelper.importFromClipboard | Import JSON from clipboard |
| cpHelper.showOutput | Show CP Helper output channel |
| cpHelper.copySubmitBridgeUrl | Copy the submit bridge URL (with its token) for the OJ Sync options page |

Default keybindings:

- Ctrl+' / Cmd+': run the first sample of the active problem
- Ctrl+Shift+' / Cmd+Shift+': the same with the LOCAL build
- Ctrl+Enter / Cmd+Enter: run every sample of the active problem
- Ctrl+Shift+Enter / Cmd+Shift+Enter: the same with the LOCAL build

Every shortcut runs **the problem your source file belongs to**. A problem is bound to a file the
first time you run it, so `a.cpp` keeps driving problem A and `b.cpp` problem B, wherever they sit
in the list. A file bound to nothing claims the first unbound problem; if every problem is already
taken, the shortcut falls back to the first one and rebinds it. Any problem can also be run from
the buttons in its own header, which is how you point it at a different file.

## Key settings

| Setting | Purpose |
| --- | --- |
| cp-helper.compileCommand | NORMAL build, used by the plain Run buttons (keep it judge-like: -O2, no sanitizers) |
| cp-helper.localCompileCommand | LOCAL build, used by the LOCAL Run buttons (empty = compileCommand with -DLOCAL injected) |
| cp-helper.debugCompileCommand | DEBUG build behind each sample's Debug button, compiled without -DLOCAL (empty = compileCommand plus -g -O0) |
| cp-helper.runCommand | Execute command template |
| cp-helper.runTimeoutMs | Compile/run timeout in ms (used when the problem carries no judge limit) |
| cp-helper.useJudgeTimeLimit | Judge NORMAL runs against the time limit scraped at import (LOCAL runs keep runTimeoutMs) |
| cp-helper.timeLimitFactor | Slack over the judge limit before the process is killed |
| cp-helper.maxParallelSamples | Samples a problem's Run all executes at once (0 = auto) |
| cp-helper.floatAbsEpsilon | Absolute float tolerance |
| cp-helper.floatRelEpsilon | Relative float tolerance |
| cp-helper.trimOutput | Trim trailing whitespace before compare |
| cp-helper.notifications | Notification for everything but a submit: `auto` (self-dismissing toast, default), `sticky`, `off` |
| cp-helper.enableLocalImportServer | Enable localhost import server |
| cp-helper.localImportPort | Local import port (default 17337) |
| cp-helper.instantRunAllOnLocalImport | Run the problem that was just synced, after a single-problem local import |
| cp-helper.submitLanguageCodeforces | Language option to pick on the Codeforces submit form |
| cp-helper.submitLanguageAtCoder | Language option to pick on the AtCoder submit form (whitespace ignored when matching) |
| cp-helper.submitConfirm | Ask before every submit (default on) |
| cp-helper.submitNotifications | Notification a submit pops: `auto` (self-dismissing toast, default), `sticky`, `off` |
| cp-helper.submitPollTimeoutMs | How long to watch the judge for the verdict after a submit |

## Samples view

- The list holds one group per imported problem, in the order they arrived. An import appends a
  new problem and refreshes one that is already there, so a contest can be synced problem by
  problem without losing what is on screen.
- The active problem - the one the run keybindings act on - is the one bound to the file in the
  editor. Its header carries an accent rail and the title above the list names it, so switching
  source files switches which problem the shortcuts hit.
- Each problem group header sticks to the top of the list while its samples scroll past, and each
  sample header sticks below it, so the group's disclosure and the sample's number and buttons stay
  reachable inside a long input or output.
- A problem header shows the source it is bound to, using the same file readout the toolbar carries
  for the run target. It is highlighted on the problem bound to the file in the editor and muted on
  the others, whose passed counts also drop their green/red tint, so results left over from another
  source are not mistaken for the current ones. Any run sets the binding, not just Run all.
- A sample's header carries a coloured cap: neutral grey until it runs, then green AC, red WA,
  blue TLE, or amber RE.
- A verdict shows the program's own execution time and, separately, the overhead outside it
  (process spawn and output drain).

## Submit

Each problem header carries its own Submit button. It sends the active C++ file to Codeforces or
AtCoder for that problem and reports the verdict back into the header.

CP Helper never logs in to a judge and never sees a judge password. It hands the job to **OJ Sync**
in your browser, which fills the judge's own submit form in a tab that is already signed in. That
is also why Codeforces works at all: its login is behind a captcha that no HTTP client can pass.

Pairing, once per machine:

1. Run **CP Helper: Copy Submit Bridge URL**.
2. Open the OJ Sync options page and paste it under **Submit bridge**, then Save.

The URL contains a token. Anything that can open a WebSocket to your loopback address - including
any page you visit - could otherwise receive the source CP Helper pushes, so treat it as a
password: the token is what keeps them out.

Notes:

- A submit is a real, rate-limited, publicly visible submission on your account. The confirmation
  dialog names the problem and language; `cp-helper.submitConfirm` turns it off.
- The target comes from the import, so only problems imported with OJ Sync can be submitted.
  Custom groups and LeetCode have no Submit button.
- One submit runs at a time; the other problems' Submit buttons stay disabled until it settles.
- Codeforces rejects a resubmission of byte-identical source; that rejection is reported as-is.
- After the submit, OJ Sync watches your submissions page until the verdict settles, and CP Helper
  shows it in that problem's header and as a notification.

## Build cache

Compiled binaries are content-addressed: the cache key is a hash of the source bytes plus the
selected compile command, so a save that changed nothing reuses the existing binary
instead of recompiling. Binaries live under the extension's global storage and survive a window
reload; the 64 most recently used are kept and older ones are pruned on activation.

## Output log

Open it with the command CP Helper: Show Output Log, or set cp-helper.showOutputOnRun to open it automatically on each run.

Every record is one line: `YYYY-MM-DD HH:MM:SS.mmm LEVEL [scope] message`.

```
2026-07-26 08:49:30.423 INFO  [runner]  run all: 3 test(s)
2026-07-26 08:49:30.424 INFO  [compile] exec: g++ -std=c++23 -o "/tmp/cp-helper-2f51fda8" "a.cpp"
2026-07-26 08:49:30.435 INFO  [runner]  sample 1: AC exit=0 time=10ms in=8B out=4B
2026-07-26 08:49:30.461 WARN  [runner]  sample 2: WA exit=0 time=13ms in=386B out=12B
2026-07-26 08:49:30.461 WARN  [runner]      expected (5B, normalized):
2026-07-26 08:49:30.461 WARN  [runner]        exp| 42
2026-07-26 08:49:30.461 WARN  [runner]      actual (5B, normalized):
2026-07-26 08:49:30.461 WARN  [runner]        got| 41
2026-07-26 08:49:30.461 WARN  [runner]  run all: 1/2 passed in 37ms
```

Levels: DEBUG, INFO, WARN (recoverable or non-AC), ERROR (failed operation).

| Scope | Emitted by |
| --- | --- |
| core | Activation and palette commands |
| webview | Samples view messages (save, export, stop, run requests) |
| compile | Selected build (normal / local), compile command, compile cache |
| runner | Run command, per-sample verdicts, checker, run-all summary |
| stress | Stress-test iterations and failing case |
| import | Sample import and starter-code clipboard copy |
| server | Local import HTTP server |
| submit | Submit bridge connection and submit results |

One sample produces one record. Expected/actual dumps appear as indented detail lines only when the sample does not pass.

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
