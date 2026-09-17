# Changelog

All notable changes to CP Helper are documented in this file.

Versioning from 1.0.0 follows SemVer: MAJOR.MINOR.PATCH.

## [Unreleased]

### Changed
- The Samples view holds one group per problem and imports add to it. An OJ Sync import, the Load button, and the clipboard command all append the problem they carry and refresh one that is already in the list (matched on the problem URL, falling back to the label), instead of replacing everything on screen. A contest can be synced problem by problem without losing what is already imported.
- The run keybindings (`ctrl+'`, `ctrl+enter`, and their LOCAL twins) run one problem rather than sweeping every imported one, and which problem is decided by the source file in the editor. Running a problem binds it to the file that was compiled, so `a.cpp` keeps driving problem A wherever it sits in the list. A file bound to nothing claims the first unbound problem; with every problem taken it falls back to the first and rebinds it. The binding is stored with the group, so it survives a reload and a re-import of the same problem.
- The title above the list names the problem the keybindings would run, and that problem's header carries an accent rail, so switching source files visibly switches which problem the shortcuts hit.
- Running and submitting are per-problem actions and live in the problem headers. Run all, Run all LOCAL, and Submit are gone from the toolbar, which keeps only the import, Stop, Clear, and Export controls; the submit stage and verdict now show in the header of the problem they belong to.
- Every problem gets a header, including a single unnamed one, so its run, submit, add-case, and delete buttons are always in the same place. An import with no problem name reads as `Group N`.
- A problem header names the source it is bound to, using the same readout the toolbar carries for the run target - file icon, dimmed parent folder, file name. It is highlighted on the problem whose source is the file in the editor and muted on the rest, so the whole file-to-problem map is readable at a glance. It follows the binding rather than the last Run all, so running a single sample sets it too, and a muted header also drops its `n/m` green/red tint: a leftover `3/3` can no longer be read as the verdict for the file now open.
- `cp-helper.instantRunAllOnLocalImport` runs the problem that was just synced, wherever it landed in the list, instead of only firing when the import left exactly one group.
- Submits run per problem rather than one at a time. Sending A no longer greys out B's Submit button: only the problem already in flight refuses a second click, so a whole contest can be sent while the first verdicts are still being judged. OJ Sync backs this with a pool of submit tabs - a tab is reserved for the job replaying the form in it and handed back when the verdict settles, so a second job opens its own tab instead of navigating the first one away mid-submit. The tabs are still reused, so repeat submits do not pile them up.
- The submit chip shows the judge's own live status while a submission is being judged, so an AtCoder submit reads `WJ`, then `19/33`, then `AC` the way the judge's status page does, instead of sitting on `judging` until the verdict lands. Codeforces' wordier pending text is shortened the same way its verdicts are (`running #19`, `queued`), with the full text in the tooltip.
- Verdict polling is shared per contest instead of per submission. Both judges list every problem of a contest on one status page (`/contests/<c>/submissions/me`, `/contest/<id>/my`), so concurrent submits now follow a single reader that fetches that page once per cycle and hands each waiting problem its own row. Submitting six problems at once costs the same requests as submitting one, rather than six times as many to the same URL. Reads also back off from 2s to 5s once a submission has been judging for 20s.
- A submit can no longer park on a stage forever. Every call into the judge's tab is bounded, so a tab that stops answering - wedged on an interstitial, discarded, mid-navigation - fails the submit with a message naming the tab instead of leaving the status chip on `verifying` with the problem's Submit button disabled behind it. A tab that timed out is dropped from the pool rather than handed to the next submit, and rejoins it if it answers again.
- Resubmitting the same problem reuses its tab without re-navigating it. The reload was throwing away the anti-bot token the user had just cleared by hand, so following "clear it there, then submit again" put them back on a fresh widget. A different problem still navigates.

## [1.1.0] - 2026-09-15

### Added
- Submit to Codeforces and AtCoder from the Samples view. A Submit button sits beside Export, and one in each problem header for a multi-problem import; it sends the active C++ file and reports the judge's verdict back into the view and as a notification.
- Submitting runs through OJ Sync, over a token-authenticated WebSocket on the local import port (`/submit`). CP Helper never logs in to a judge: OJ Sync replays the judge's own submit form inside a tab that is already signed in, so Codeforces' captcha login never comes up and its `ftaa` / `bfaa` fields are reused exactly as the page issued them. The URL that carries the token is copied with the new **CP Helper: Copy Submit Bridge URL** command and pasted into the OJ Sync options page once per machine.
- `cp-helper.submitLanguageCodeforces`, `cp-helper.submitLanguageAtCoder` (substring matched against the judge's own language options), `cp-helper.submitConfirm` (default on - a submit is a real, rate-limited, publicly visible submission), and `cp-helper.submitPollTimeoutMs`.
- The verdict readout shows the judge's own wording in short form (`MLE #4`, `WA #3`), matching the sample chips, with the full text in the tooltip. It links to the submission on the judge when one is known.
- A submit replays the judge's real form: every field it carries is kept (including ones added since, such as an anti-bot token) and the body is encoded the way the form itself declares. Hand-building the request loses unknown fields, and a multipart form fed a urlencoded body parses as empty - which both judges report only as a bare "Error.".
- Language options are matched ignoring whitespace, so AtCoder's rename from `C++ 23 (gcc 12.2)` to `C++23 (GCC 15.2.0)` matches either spelling. The `cp-helper.submitLanguageAtCoder` default is now `C++23 (GCC`.
- The anti-bot widget on a submit form is waited out before the form is replayed, and its token is sent with the submission. If the widget asks for the user instead of clearing itself, its tab is brought to the front and the submit says so.
- OJ Sync sends the problem page `url` with the samples, and CP Helper stores it on the group. It is what resolves the submit target, and the only thing that tells a Codeforces `gym` contest from a regular one. Imports made before this fall back to parsing the problem label.

## [1.0.9] - 2026-09-02

### Added
- OJ Sync reads the problem's time limit from Codeforces and AtCoder statements and sends it with the samples as `timeLimitMs` (per problem for a multi-problem Codeforces import). The limit shows as a chip on the group header, and a NORMAL run judges TLE against it instead of the fixed `cp-helper.runTimeoutMs`. LOCAL runs keep `runTimeoutMs`, since a sanitizer build's timings say nothing about the judge. LeetCode publishes no time limit, so imports from there are unchanged.
- `cp-helper.useJudgeTimeLimit` (default on) and `cp-helper.timeLimitFactor` (default 2). A sample is killed at `limit * factor` so an overrun still shows how far over it went, while the verdict compares the program's own execution time against the judge limit. `runTimeoutMs` still governs compiles and any problem with no imported limit.

### Changed
- The toolbar's two readouts are legible at a glance: each carries a codicon (compiler, run target), the compiler and its standard sit either side of a divider instead of reading as one flag, the run target's parent folder is dimmed so the file name stands out, and a pill on hover marks them as the things whose tooltip spells out the commands.

## [1.0.8] - 2026-09-02

### Added
- Each run affordance is now a NORMAL / LOCAL pair: the toolbar, every problem group header, and every sample row carry a plain Run button (`compileCommand`) next to a LOCAL one (`localCompileCommand`). The single `-DLOCAL` toggle is gone, so a LOCAL run no longer changes what the next plain run compiles.
- Separate `cp-helper.localCompileCommand` (LOCAL build) and `cp-helper.debugCompileCommand` (DEBUG build) settings, so the judge-comparable build, the sanitizer build, and the debugger build no longer share one compile line. `cp-helper.compileCommand` now defaults to `-O2`.
- Group headers and sample headers stick to the top of the list while scrolling. A group's disclosure, passed count, and run buttons stay reachable through its whole list of samples, and a sample's number and buttons stay put through a long input or output.
- Verdict time now reads as two chips: the program's own execution time and, separately, the overhead outside it (process spawn and output drain). The default run command is spawned without `sh -c` when it needs no shell, keeping a shell fork out of both the timing and the kill tree.

### Changed
- Sample headers are distinguishable at a glance: an expand/collapse chevron like the group header's, the sample number as plain text, and a colour-coded 2px cap on the header itself (neutral grey until the sample runs, then green AC / red WA / blue TLE / amber RE). The cap travels with the header while it is stuck.
- Run and Debug are disabled, with an explanatory tooltip, until a C++ file has been opened, instead of failing with an error after the click.
- Run and Debug target the last C++ editor visited when the active tab is not C++ (a terminal, a settings tab, an `.in` file), so switching away from the source no longer changes or blocks the run target.
- The Debug button compiles without `-DLOCAL`.
- The runner hint tooltip lists both compile lines instead of whichever one the toggle had selected.
- The stress test runs the NORMAL build; it previously followed the `-DLOCAL` toggle.
- `npm run vsix:local:run` installs into the profile named by `CP_HELPER_PROFILE`, defaulting to "Problem Solving [ C++ ]".
- OJ Sync ships an extension icon.

### Fixed
- During Run all, the per-row spinner now marks the samples that are actually executing. Progress from the host is a completion count, which the view read as a row index, so the spinner sat on a sample that had already finished and could point at an unrelated row when samples ran concurrently.
- The import header's scrolled-state shading is wired once at startup. Its scroll listener sat inside a message handler branch, so it was only ever attached if a `cases` message arrived while the JSON paste box was open.

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
