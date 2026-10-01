# CP Picker

Chrome extension (Manifest V3) that picks one Codeforces, AtCoder or CSES problem to practice each day.

Problems are organized as **category** (Graph Theory, Number Theory, Strings, ...) -> **problem type** (Dijkstra, Sieve, KMP, ...) -> **problems**, ordered from easy to hard.

- One pick per local calendar day; reopening the popup shows the same pick.
- A pick chooses a random category, then a random problem type in it, then the easiest unsolved problem of that type.
- `Shuffle` replaces today's pick with a different problem type. `Next problem` moves to the next unsolved problem of the same type.
- Skips problem types picked within the last N days (default 7). If every matching type is recent, it picks from all of them.
- Connect a Codeforces handle in Settings: problems you solved on Codeforces are marked solved automatically (synced when the popup opens, at most every 10 minutes), and the rating range can follow your rating (+100 to +500).
- Filters by rating range (default 1600 to 3500, roughly Div. 2 D and up), category and platform. Picks, `Next problem`, Browse counts and progress all stay inside the range.
- Browse tab lists every type with its problems easy to hard; tick problems as solved there or from the Today card.
- Add tab takes many problem links at once and files them under a category and problem type (existing or new).
- History of daily picks; entries can be deleted.
- Backup export / import of your added problems, solved list and history.

## Problem data

Two sources are bundled. Refresh both with `npm run fetch:sources`, then `npm run build`.

### YouKn0wWho

The technique types come from [YouKn0wWho's topic list](https://youkn0wwho.academy/topic-list), filtered to Codeforces contest problems (no gym / group / edu), AtCoder tasks and CSES tasks, including the ones the site links through vjudge. The beginner `Basics` category is left out. Order inside a type is the Codeforces rating or the AtCoder Problems difficulty estimate, then the site's per-topic level (Easy, Medium, Hard, Very Hard). Problems without a rating are placed at 1200 / 1700 / 2200 / 2700 by level.

`npm run fetch:youkn0wwho` rewrites `src/data/sources/youkn0wwho.json`.

### CSES

Every [CSES problem set](https://cses.fi/problemset/) section except Introductory Problems becomes a problem type named `CSES: <section>` inside the matching category (for example `CSES: Range Queries` under Data Structures). CSES has no ratings, so each problem gets an estimate from its solver count on a log scale (the most solved problem is about 800, a problem with about 200 solvers is about 2600), shown as `~1850`. CSES problems that YouKn0wWho tags also appear under those technique types.

`npm run fetch:cses` rewrites `src/data/sources/cses.json`.

### Adding a source

Every `src/data/sources/*.json` file is bundled and merged, so another source can be added as its own file with the same shape:

```json
{
  "source": "name",
  "url": "https://...",
  "fetchedAt": "2026-10-01",
  "categories": [{ "id": "graph_theory", "name": "Graph Theory" }],
  "types": [{ "id": "dijkstras_algorithm", "name": "Dijkstra's Algorithm", "categoryId": "graph_theory", "group": "Shortest Paths" }],
  "problems": [
    {
      "id": "cf:20C",
      "url": "https://codeforces.com/contest/20/problem/C",
      "title": "Dijkstra?",
      "platform": "Codeforces",
      "rating": 1900,
      "types": { "dijkstras_algorithm": 1 }
    }
  ]
}
```

`types` maps a problem type id to a level from 1 (Easy) to 4 (Very Hard); `"ratingEstimated": true` marks a rating that is not official. Problems with the same id across sources are merged, and the source with the most categories sets the category order.

## Adding links

Supported links, one per line (spaces and commas also separate):

- `https://codeforces.com/contest/<contest>/problem/<index>`
- `https://codeforces.com/problemset/problem/<contest>/<index>`
- `https://atcoder.jp/contests/<contest>/tasks/<task>`
- `https://cses.fi/problemset/task/<id>`

Pick a category and problem type from the suggestions or type a new name to create one. Titles and ratings are looked up from the Codeforces API and AtCoder Problems (CSES titles and estimates come from the bundled catalog); with difficulty set to `Auto`, the level comes from the rating (below 1400 Easy, below 1900 Medium, below 2400 Hard, otherwise Very Hard). Problems you added can be removed from a type in the Browse tab.

## Build

Requires Node 20+.

```sh
npm install
npm run build      # typecheck + bundle into dist/
```

`npm run dev` serves the popup at http://localhost:5173 for UI work; outside the extension it falls back to `localStorage`.

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `cp-picker/dist` folder.
5. Pin **CP Picker** from the extensions menu.

After rebuilding, press the reload icon on the extension card.

The arrow button in the popup header opens the app in a full tab. Use it for importing files, since on some platforms the popup closes when the file picker opens.

## Layout

```
public/manifest.json          extension manifest, copied to dist/
public/icons/                 toolbar icons
scripts/fetch-youkn0wwho.mjs  scrapes youkn0wwho.academy into src/data/sources/
scripts/fetch-cses.mjs        scrapes the CSES problem set into src/data/sources/
src/types.ts                  data model and defaults
src/data/sources/             bundled problem catalogs
src/lib/library.ts            merges catalogs, orders problems by rating
src/lib/picker.ts             category -> type -> problem selection (pure)
src/lib/daily.ts              today's pick, shuffle and next-problem logic (pure)
src/lib/links.ts              Codeforces / AtCoder link parsing
src/lib/lookup.ts             title and rating lookup for added links
src/lib/codeforces.ts         Codeforces handle sync and rating-based range
src/lib/custom.ts             adding and removing user problems
src/lib/storage.ts            chrome.storage.local wrapper, validation, backup
src/useAppData.ts             React state + persistence hook
src/components/               Today, Browse, Add, History, Settings views and small UI pieces
```
