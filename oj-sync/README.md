# OJ Sync (Chrome)

**Version 1.2.7** - aligned with **CP Helper 1.2.7**.

Chrome extension that reads **sample test cases** from **AtCoder**, **Codeforces**, and **LeetCode** problem pages and sends them to **CP Helper** in VS Code, and submits solutions to **Codeforces** and **AtCoder** on CP Helper's behalf.

## Behavior

1. **Preferred:** `POST` JSON to CP Helper's local server (**`http://127.0.0.1:<port>/import`** by default - port matches **`cp-helper.localImportPort`**, usually **17337**). No clipboard for samples; avoids Chrome **`vscode://`** prompts when this works. **LeetCode** bodies may include **`starterCode`**; CP Helper copies that to the **VS Code** clipboard after import (the extension tab cannot rely on the page's clipboard from a toolbar click).
2. **Fallback (optional):** If POST fails and the option is enabled, open a **`vscode://from-cero.cp-helper/focusSamples`** tab so CP Helper is visible (samples are not in the URL; use manual paste if needed).

### Codeforces contest list

On a contest landing page (**`/contest/<id>`** or **`/gym/<id>`**, which carries no statements), the
toolbar action reads the problem table instead of samples and sends CP Helper the argument line for
`contest.sh` in the problem repo: the contest id and the comma-joined labels in page order, split
subproblems included (**`2266 A,B,C1,C2,D,E`**). CP Helper puts it on the **VS Code** clipboard and
imports nothing. Use **`/contest/<id>/problems`** for the samples as before.

### AtCoder contest list

On a contest top page (**`/contests/<id>`**) or its task list (**`/contests/<id>/tasks`**), the
toolbar action sends the argument line for `contest.sh` the same way: the contest id and the task
labels in table order, `Ex` included (**`abc475 A,B,C,D,E,F,G`**). The top page carries no task
links, so the labels are read from a same-origin `fetch` of `/contests/<id>/tasks` inside the tab,
which uses your AtCoder session. Labels are passed through as the table prints them, so a round that
still labels its last task `H` arrives as `H` and `contest.sh` will reject it - rename it to `Ex`.

### LeetCode contest list

On a contest page (**`/contest/weekly-contest-520/`**, **`/contest/biweekly-contest-178/`**), the
toolbar action sends the `contest.sh` argument line. LeetCode has no per-problem letter, so the
labels are positional (**`lcwk520 A,B,C,D`** for a four-problem contest) and the contest name is the
one `contest.sh` expects: `weekly-contest-<n>` -> **`lcwk<n>`**, `biweekly-contest-<n>` ->
**`lcbw<n>`**. The problem table is rendered client side, so a tab that has not painted it falls back
to the contest's own `/contest/api/info/<slug>/` JSON. Any other contest slug is not mappable to a
`contest.sh` name and is reported as a failure.

### LeetCode problem page

On a problem page, the toolbar action:

- Parses **Example 1, 2, ...** from the statement by walking **all** `span.example-io` nodes under the description (`Input:` / `Output:` labels via `strong` or row text), not only inside `div.example-block` (later examples are often siblings below). **Classic** inputs use `name = value` chunks (comma-aware); **stdin lines are values only**, ordered to match the **C++ method parameter list** from the editor starter when possible. **Design / interactive** inputs (JSON method list + args, no `=`) are passed through as **one stdin line per non-empty text line** inside the Input span. Example classic: `nums`, `p`, `queries` -> three value lines when that is the parameter order in **C++** code.
- **Starter code:** scraped from the editor surface - **Monaco** `.view-line` (typical practice) or **CodeMirror 6** `.cm-line` (many contest tabs). Sent **verbatim** as **`starterCode`** in the POST JSON (same method names as on LeetCode); CP Helper copies it to the **VS Code** clipboard after import. The in-page copy remains best-effort only (often blocked without a gesture on the problem page).
- If no examples are found in the DOM, falls back to the **custom testcase** fields in the bottom console (`console-testcase-input`); expected output may be empty - fill it in CP Helper if needed.
- CP Helper **problem** label for LeetCode is **`leetcode/<number>` only** (from the title row, meta titles, or page JSON - including `__NEXT_DATA__`). **URL slugs are never used**; if no numeric id is found, samples import without a problem label.

## Submit bridge

CP Helper cannot call a service worker (MV3 has no inbound socket), so the worker keeps a
**WebSocket** open to CP Helper on `127.0.0.1` instead and waits for jobs. A job carries the
problem, the language to pick, and the source; OJ Sync parks a background tab on the judge's own
submit page, replays that page's form from inside the tab, then polls your submissions page until
the verdict settles and sends it back.

Everything that needs the judge session happens **in the tab**: an extension `fetch` counts as
cross-site for SameSite cookies, so it would submit as a logged-out user. Running in the page also
means the judge's own `csrf_token` (and on Codeforces `ftaa` / `bfaa`) is used exactly as issued -
no login, no captcha, and no judge password ever reaches this extension.

Codeforces guards its submit form with an anti-bot widget. Its token is only filled in a second or
two after the page loads, so the driver waits for it before replaying the form (a replay without it
comes back as *"Please complete the anti-bot verification"*). When the widget wants the user to act,
the tab is brought to the front and the submit is reported as needing that instead of failing
silently. A token is good for one submission and the widget goes on showing the spent one, so a tab
that has posted is reloaded before the next submit is replayed in it.

Pairing: in VS Code run **CP Helper: Copy Submit Bridge URL** and paste the result into the options
page. The URL carries a token; WebSocket connections are not subject to CORS, so that token is the
only thing keeping other pages and local programs off the socket. Treat it as a password.

Chrome suspends an idle service worker after ~30s. Traffic on the socket resets that timer (CP
Helper sends a `ping` every 20s), and an `alarms` keepalive wakes the worker once a minute to
reconnect after a suspend.

## Source layout

| File                               | Role                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `background.js`                    | Service worker: injects `lib/inpage/*.js`, then calls `__ojSyncExtractSamplesInPage`; POST / fallback. |
| `lib/inpage/inject-manifest.js`    | **ES module** (SW only): ordered list of classic scripts to inject.                                    |
| `lib/inpage/shared-dom.js`         | Injected: `prePlainText` (AtCoder + Codeforces).                                                       |
| `lib/inpage/extract-atcoder.js`    | Injected: AtCoder scrape + contest task labels. Remove + drop `dispatch.js` branch to disable.          |
| `lib/inpage/extract-codeforces.js` | Injected: Codeforces scrape + contest problem labels. Remove + drop `dispatch.js` branch to disable.   |
| `lib/inpage/extract-leetcode.js`   | Injected: LeetCode scrape + clipboard + contest labels. Remove + drop `dispatch.js` branch to disable.  |
| `lib/inpage/dispatch.js`           | Injected: hostname -> `extractAtcoder` / `extractCodeforces` / `extractLeetcode`.                      |
| `lib/inpage/submit-shared.js`      | Injected: language picking and same-origin page reads for the submit drivers.                          |
| `lib/inpage/submit-atcoder.js`     | Injected: AtCoder submit + verdict. Remove + drop `submit-dispatch.js` branch to disable.              |
| `lib/inpage/submit-codeforces.js`  | Injected: Codeforces submit + verdict. Remove + drop `submit-dispatch.js` branch to disable.           |
| `lib/inpage/submit-dispatch.js`    | Injected: judge -> `submitAtcoder` / `submitCodeforces` and their verdict readers.                     |
| `lib/bridge.js`                    | WebSocket client for CP Helper's submit bridge (reconnect + keepalive).                                |
| `lib/submit-runner.js`             | Runs one job: park a judge tab, call the in-page driver, poll for the verdict.                         |
| `lib/build-import-payload.js`      | Normalize scrape result -> JSON string for CP Helper.                                                  |
| `lib/pair-samples.js`              | Pair input/output `<pre>` blocks into sample objects.                                                  |
| `lib/contest-url.js`               | Problem labels + supported-host check.                                                                 |
| `lib/cp-helper-client.js`          | `fetch` POST to localhost; optional `vscode://` tab.                                                   |
| `lib/settings.js`                  | `chrome.storage.sync` defaults for import/focus URIs.                                                  |
| `lib/constants.js`                 | Default URIs and badge glyph.                                                                          |
| `lib/badge.js`                     | Toolbar badge flash success / error.                                                                   |
| `options.js` / `options.html`      | Options page (separate from the service worker).                                                       |
| `icons/icon-256.png`              | Master artwork: white outlined documents with a check badge inside a dashed sync ring, on a transparent background. `icons/icon-*.png` are downscaled from it and are what the manifest loads; 16 is the check badge alone, cropped out of the master, since the full drawing turns to mush at that size. |

The manifest uses **`"type": "module"`** so the service worker can `import` ES modules under **`lib/`**. **Site scrapers** under **`lib/inpage/`** are plain classic scripts (no `import`); Chrome loads them in order via **`scripting.executeScript({ files })`** so each OJ stays in its own file.

## Load in Chrome

1. Open **Chrome** -> **Extensions** -> enable **Developer mode**.
2. **Load unpacked** -> select this **`oj-sync`** folder (the one containing `manifest.json`).

## Options

Right-click the extension -> **Options** (or open the options page from **Extensions**). Configure:

- Local import URL (must end with **`/import`** and match CP Helper's port).
- Whether to use localhost POST and whether to fall back to the focus URL.
- **Submit bridge** URL from **CP Helper: Copy Submit Bridge URL**, and whether submitting through
  this browser is allowed at all.

## Payload shape

The POST body is JSON understood by CP Helper (plain array of cases, or wrapped `{ problem, samples }` / `{ problems: [...] }` for multi-problem imports). Optional wrapper field **`source`** is set to **`oj-sync`** for debugging.

A body with **`clipboardText`** and no cases is not an import: CP Helper writes that string to the
**VS Code** clipboard and stops. Codeforces, AtCoder and LeetCode contest list pages use it for the
`contest.sh` arguments.

Codeforces and AtCoder imports also carry the problem page **`url`**, which is what CP Helper turns
into a submit target (it is also the only thing that distinguishes a `gym` contest from a regular
one). Older imports fall back to parsing the `problem` label.

Codeforces and AtCoder statements also carry a time limit; when it is found it rides along as **`timeLimitMs`** next to `samples` (per entry for multi-problem imports) and CP Helper judges TLE against it. LeetCode publishes no time limit, so the field is absent there.

CP Helper's **instant Run all** after import applies only when that payload resolves to **one** problem group (no extra HTTP headers required).

## Version

See **`manifest.json`** -> **`version`**. Bump it whenever you change this extension (see repo rule **`oj-sync-release.mdc`**).

Run **`npm run bump`** in the repo root: it raises the patch version in **`package.json`**, **`oj-sync/manifest.json`** and the version line above, all to the same number. Pass **`minor`**, **`major`** or an explicit **`x.y.z`** to override (**`npm run bump -- minor`**).
