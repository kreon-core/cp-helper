# CP Picker

Chrome extension (Manifest V3) that picks one competitive programming topic to practice each day.

- One topic per local calendar day; reopening the popup shows the same topic.
- `Shuffle` replaces today's pick with a different eligible topic.
- Skips topics practiced within the last N days (default 7). If every matching topic is recent, it picks from all of them.
- Filters by category, difficulty, status and tags.
- Topic list with add / edit / delete, JSON import and export.
- History of daily picks; entries can be deleted.
- All data lives in `chrome.storage.local`. No backend, no network access.

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

## Import format

Either a JSON array of topics or `{ "topics": [...] }`, the same shape that Export produces:

```json
[
  {
    "name": "Max Flow",
    "category": "Graph",
    "difficulty": "Hard",
    "tags": ["flow", "dinic"],
    "note": "Dinic; min-cut duality.",
    "status": "Practicing"
  }
]
```

`name`, `category` and `difficulty` (`Easy` / `Medium` / `Hard`) are required. `status` defaults to `Not practiced`, `id` is generated when missing. Imported topics with the same id or name (case-insensitive) update the existing entry; others are appended. If any item is invalid, nothing is imported and the errors are listed by item number.

## Layout

```
public/manifest.json        extension manifest, copied to dist/
public/icons/               toolbar icons
src/types.ts                data model and defaults
src/lib/picker.ts           filtering, recent-window, uniform random pick (pure)
src/lib/daily.ts            today's topic and shuffle logic (pure)
src/lib/topics.ts           JSON import validation, merge, export
src/lib/storage.ts          chrome.storage.local wrapper, validation, seeding
src/lib/date.ts             local YYYY-MM-DD dates and day differences
src/data/topics.json        30 seed topics loaded on first run
src/useAppData.ts           React state + persistence hook
src/components/             Today, Topics, History, Settings views and small UI pieces
```
