# OJ Sync (Chrome)

**Version 1.0.3** — aligned with **CP Helper 1.0.3**.

Chrome extension that reads **sample test cases** from **AtCoder**, **Codeforces**, and **LeetCode** problem pages and sends them to **CP Helper** in VS Code.

## Behavior

1. **Preferred:** `POST` JSON to CP Helper’s local server (**`http://127.0.0.1:<port>/import`** by default — port matches **`cp-helper.localImportPort`**, usually **17337**). No clipboard for samples; avoids Chrome **`vscode://`** prompts when this works. **LeetCode** bodies may include **`starterCode`**; CP Helper copies that to the **VS Code** clipboard after import (the extension tab cannot rely on the page’s clipboard from a toolbar click).
2. **Fallback (optional):** If POST fails and the option is enabled, open a **`vscode://from-cero.cp-helper/focusSamples`** tab so CP Helper is visible (samples are not in the URL; use manual paste if needed).

### LeetCode

On a problem page, the toolbar action:

- Parses **Example 1, 2, …** from the statement by walking **all** `span.example-io` nodes under the description (`Input:` / `Output:` labels via `strong` or row text), not only inside `div.example-block` (later examples are often siblings below). **Classic** inputs use `name = value` chunks (comma-aware); **stdin lines are values only**, ordered to match the **C++ method parameter list** from the editor starter when possible. **Design / interactive** inputs (JSON method list + args, no `=`) are passed through as **one stdin line per non-empty text line** inside the Input span. Example classic: `nums`, `p`, `queries` → three value lines when that is the parameter order in **C++** code.
- **Starter code:** scraped from the editor surface — **Monaco** `.view-line` (typical practice) or **CodeMirror 6** `.cm-line` (many contest tabs). Sent **verbatim** as **`starterCode`** in the POST JSON (same method names as on LeetCode); CP Helper copies it to the **VS Code** clipboard after import. The in-page copy remains best-effort only (often blocked without a gesture on the problem page).
- If no examples are found in the DOM, falls back to the **custom testcase** fields in the bottom console (`console-testcase-input`); expected output may be empty—fill it in CP Helper if needed.
- CP Helper **problem** label for LeetCode is **`leetcode/<number>` only** (from the title row, meta titles, or page JSON — including `__NEXT_DATA__`). **URL slugs are never used**; if no numeric id is found, samples import without a problem label.

## Source layout

| File | Role |
|------|------|
| `background.js` | Service worker: injects `lib/inpage/*.js`, then calls `__ojSyncExtractSamplesInPage`; POST / fallback. |
| `lib/inpage/inject-manifest.js` | **ES module** (SW only): ordered list of classic scripts to inject. |
| `lib/inpage/shared-dom.js` | Injected: `prePlainText` (AtCoder + Codeforces). |
| `lib/inpage/extract-atcoder.js` | Injected: AtCoder scrape. Remove + drop `dispatch.js` branch to disable. |
| `lib/inpage/extract-codeforces.js` | Injected: Codeforces scrape. Remove + drop `dispatch.js` branch to disable. |
| `lib/inpage/extract-leetcode.js` | Injected: LeetCode scrape + clipboard. Remove + drop `dispatch.js` branch to disable. |
| `lib/inpage/dispatch.js` | Injected: hostname → `extractAtcoder` / `extractCodeforces` / `extractLeetcode`. |
| `lib/build-import-payload.js` | Normalize scrape result → JSON string for CP Helper. |
| `lib/pair-samples.js` | Pair input/output `<pre>` blocks into sample objects. |
| `lib/contest-url.js` | Problem labels + supported-host check. |
| `lib/cp-helper-client.js` | `fetch` POST to localhost; optional `vscode://` tab. |
| `lib/settings.js` | `chrome.storage.sync` defaults for import/focus URIs. |
| `lib/constants.js` | Default URIs and badge glyph. |
| `lib/badge.js` | Toolbar badge flash success / error. |
| `options.js` / `options.html` | Options page (separate from the service worker). |

The manifest uses **`"type": "module"`** so the service worker can `import` ES modules under **`lib/`**. **Site scrapers** under **`lib/inpage/`** are plain classic scripts (no `import`); Chrome loads them in order via **`scripting.executeScript({ files })`** so each OJ stays in its own file.

## Load in Chrome

1. Open **Chrome** → **Extensions** → enable **Developer mode**.
2. **Load unpacked** → select this **`oj-sync`** folder (the one containing `manifest.json`).

## Options

Right-click the extension → **Options** (or open the options page from **Extensions**). Configure:

- Local import URL (must end with **`/import`** and match CP Helper’s port).
- Whether to use localhost POST and whether to fall back to the focus URL.

## Payload shape

The POST body is JSON understood by CP Helper (plain array of cases, or wrapped `{ problem, samples }` / `{ problems: [...] }` for multi-problem imports). Optional wrapper field **`source`** is set to **`oj-sync`** for debugging.

CP Helper’s **instant Run all** after import applies only when that payload resolves to **one** problem group (no extra HTTP headers required).

## Version

See **`manifest.json`** → **`version`**. Bump it whenever you change this extension (see repo rule **`oj-sync-release.mdc`**).
