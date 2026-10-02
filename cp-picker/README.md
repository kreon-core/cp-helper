# CP Picker

Chrome extension (Manifest V3) that picks one Codeforces, AtCoder or CSES problem to practice each day.

Problems are organized as **category** (Graph Theory, Number Theory, Strings, ...) -> **problem type** (Dijkstra, Sieve, KMP, ...) -> **problems**, ordered from easy to hard.

- One pick per local calendar day; reopening the popup shows the same pick.
- A pick chooses a random category, then a problem type in it weighted by how important the type is in CP, then the easiest unsolved problem of that type.
- Importance comes from YouKn0wWho's star rating: Core (3 stars) is picked 9 times as often as Rare (1 star), Useful (2 stars) 3 times as often. Your own types default to Useful. Change any type's importance in Browse, including `Never pick` to drop it.
- `Shuffle` replaces today's pick with a different problem type. A type always serves its lowest unsolved problem, so a harder one only comes up after the easier ones are solved.
- Skips problem types picked within the last N days (default 7). If every matching type is recent, it picks from all of them.
- Connect a Codeforces handle in Settings: problems you solved on Codeforces are marked solved automatically (synced when the popup opens, at most every 10 minutes), and the rating range can follow your rating (+100 to +500).
- Filters by rating range (default 1600 to 3500, roughly Div. 2 D and up), category and platform. Picks, Browse counts and progress all stay inside the range.
- Browse tab lists every type with its problems easy to hard; tick problems as solved there or from the Today card.
- Add tab takes many problem links at once and files them under a category and problem type (existing or new).
- History of daily picks; entries can be deleted.
- Backup export / import of your added problems, solved list, history and type importance.

## Problem data

Three sources are bundled as JSON in `src/data/sources/`. They are maintained by hand (or by asking Claude), not by fetch scripts; after editing the data, run `npm run sort:groups` and `npm run build`.

### YouKn0wWho

The technique types come from [YouKn0wWho's topic list](https://youkn0wwho.academy/topic-list), filtered to Codeforces contest problems (no gym / group / edu), AtCoder tasks and CSES tasks, including the ones the site links through vjudge. From the `Basics` category only the technique groups are kept (binary search and two pointers, prefix sums, greedy and constructive, bit manipulation, basic counting, ...); the language, STL, complexity, sorting-algorithm and graph-representation lessons are left out. The types listed in `src/data/research.json` (advanced or non-contest topics such as Top Tree, Pell's Equation or A*) are moved into a separate `Research` category for later study. Research types keep their group, are never picked unless the Research category is selected in the filters, and a problem that also has a contest type stays in the contest category. Order inside a type is the Codeforces rating or the AtCoder Problems difficulty estimate, then the site's per-topic level (Easy, Medium, Hard, Very Hard). Problems without a rating are placed at 1200 / 1700 / 2200 / 2700 by level.

### CSES

Every [CSES problem set](https://cses.fi/problemset/) problem outside Introductory Problems is listed under the same technique types as everything else, never under its CSES section. YouKn0wWho already tags about half of them; the rest are tagged by hand in `src/data/tags.json`, which maps a problem id to extra type ids for any source (the level comes from the rating). CSES has no ratings, so each problem gets an estimate from its solver count on a log scale (the most solved problem is about 800, a problem with about 200 solvers is about 2600), shown as `~1850`.

### AtCoder Tags

AtCoder problems tagged by vote on [AtCoder Tags](https://atcoder-tags.herokuapp.com/explain) are listed under the same technique types. Each sub-tag maps to the closest existing type (`Graph / Shortest-Path` -> Dijkstra's Algorithm, `Technique / imos` -> Difference Array, ...), and the tags with no matching type get their own: Brute Force, Bitmask Brute Force, Sorting, Integer Properties, Counting, String Processing, Basic DP, Interval DP, Stack and Queue, Set and Map, Priority Queue, Minimax, Game Observations and Ad Hoc. The `Easy`, `April-Fool`, `Marathon` and `Other` categories, every `Other` sub-tag and problems tagged with a category but no sub-tag are left out. Ratings are the clipped AtCoder Problems difficulty. Problems without one get an estimate from the AtCoder Tags solver count on a log scale fitted to the rated problems, shown as `~`. Problems from unrated contests (PAST, KUPC, ...) have fewer solvers, so their estimates tend to be high.

### English statements only

AtCoder tasks without an English statement (most JOI, Typical 90, old ABC and many university contests) are removed from every source. A task is kept when its page has an English (`lang-en`) statement; Codeforces and CSES are always in English.

### One category per problem

A problem can be tagged with types from several categories (for example a problem that is in both `Grundy Number` and `Bitmask DP`). It is kept in exactly one category, and only its types in that category are used.

`npm run assign:categories` picks that category for every such problem and writes `src/data/assignments.json`. For each candidate category it adds up three shares:

- statement keywords: AtCoder and CSES statements are downloaded (cached in `scripts/.cache/`) and matched against a keyword list per category, such as graph / vertex / edge / tree for Graph Theory or prime / gcd / divisor for Number Theory. Codeforces problem pages are behind a browser check, so for Codeforces only the title is matched;
- Codeforces tags from the API, mapped to categories (`graphs` -> Graph Theory, `number theory` -> Number Theory, ...);
- the problem's own types in that category, weighted so an Easy (direct) application counts more than a Very Hard one, at 0.75 weight.

The category with the highest total wins; ties go to the earlier category. Problems missing from the file (new data before the script is rerun) fall back to the type weights alone. Filing a problem under a category in the Add tab overrides all of this and moves it there; removing that filing in Browse moves it back.

### Adding a source

Every `src/data/sources/*.json` file is bundled and merged, so another source can be added as its own file with the same shape:

```json
{
  "source": "name",
  "url": "https://...",
  "fetchedAt": "2026-10-01",
  "types": [
    {
      "id": "dijkstras_algorithm",
      "name": "Dijkstra's Algorithm",
      "categoryId": "graph_theory",
      "groupId": "shortest_paths"
    }
  ],
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

A type's `categoryId` is looked up in `src/data/categories.json`, a map from id to display name, and its `groupId` in `src/data/groups.json`, which maps each category id to its own map of group id to display name, so every category has its own groups. Groups name a specific topic; there are no catch-all Miscellaneous or Techniques groups. Both files are shared by all sources; edit a name there to rename it everywhere. The order of `categories.json` is the category order, and the order inside each category of `groups.json` is the group order in Browse. `npm run sort:groups` sorts the groups of each category by how many problems they have, most first. Types inside a group are always shown by problem count, most first. A type may set `"importance"` from 1 (Rare) to 3 (Core). `types` on a problem maps a problem type id to a level from 1 (Easy) to 4 (Very Hard); `"ratingEstimated": true` marks a rating that is not official. Problems with the same id across sources are merged, and the source with the most types takes precedence.

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
scripts/assign-categories.mjs picks one category per problem into src/data/assignments.json
scripts/sort-groups.mjs       sorts each category's groups in src/data/groups.json by problem count
src/types.ts                  data model and defaults
src/data/sources/             bundled problem catalogs
src/data/assignments.json     category chosen for problems tagged in several categories
src/data/categories.json      category id -> name, in display order
src/data/groups.json          category id -> group id -> name
src/data/research.json        type ids moved to the Research category
src/data/tags.json            extra type ids per problem (hand-tagged CSES problems)
src/lib/library.ts            merges catalogs, one category per problem, orders problems by rating
src/lib/picker.ts             category -> weighted type -> problem selection (pure)
src/lib/importance.ts         type importance, pick weights and star labels
src/lib/daily.ts              today's pick and shuffle logic (pure)
src/lib/links.ts              Codeforces / AtCoder link parsing
src/lib/lookup.ts             title and rating lookup for added links
src/lib/codeforces.ts         Codeforces handle sync and rating-based range
src/lib/custom.ts             adding and removing user problems
src/lib/storage.ts            chrome.storage.local wrapper, validation, backup
src/useAppData.ts             React state + persistence hook
src/components/               Today, Browse, Add, History, Settings views and small UI pieces
```
