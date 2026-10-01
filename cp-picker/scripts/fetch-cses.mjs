import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = "https://cses.fi/problemset/";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/sources/cses.json");

const CATEGORIES = [
  { id: "data_structures", name: "Data Structures" },
  { id: "graph_theory", name: "Graph Theory" },
  { id: "combinatorics", name: "Combinatorics" },
  { id: "math", name: "Math" },
  { id: "strings", name: "Strings" },
  { id: "dynamic_programming", name: "Dynamic Programming" },
  { id: "geometry", name: "Geometry" },
  { id: "miscellaneous", name: "Miscellaneous" },
];

const SECTION_CATEGORY = {
  "Sorting and Searching": "miscellaneous",
  "Dynamic Programming": "dynamic_programming",
  "Graph Algorithms": "graph_theory",
  "Range Queries": "data_structures",
  "Tree Algorithms": "graph_theory",
  Mathematics: "math",
  "String Algorithms": "strings",
  Geometry: "geometry",
  "Advanced Techniques": "miscellaneous",
  "Sliding Window Problems": "data_structures",
  "Interactive Problems": "miscellaneous",
  "Bitwise Operations": "math",
  "Construction Problems": "miscellaneous",
  "Advanced Graph Problems": "graph_theory",
  "Counting Problems": "combinatorics",
  "Additional Problems I": "miscellaneous",
  "Additional Problems II": "miscellaneous",
};

net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

const TOP_SOLVERS = 180000;
const RATING_PER_DECADE = 610;

function decode(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function estimateRating(solvers) {
  const rating = 800 + (Math.log10(TOP_SOLVERS) - Math.log10(Math.max(1, solvers))) * RATING_PER_DECADE;
  return Math.max(800, Math.min(3500, Math.round(rating / 10) * 10));
}

function levelFromRating(rating) {
  if (rating < 1400) return 1;
  if (rating < 1900) return 2;
  if (rating < 2400) return 3;
  return 4;
}

function stringify(catalog) {
  const lines = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(",\n");
  return [
    "{",
    `  "source": ${JSON.stringify(catalog.source)},`,
    `  "url": ${JSON.stringify(catalog.url)},`,
    `  "fetchedAt": ${JSON.stringify(catalog.fetchedAt)},`,
    `  "categories": [\n${lines(catalog.categories)}\n  ],`,
    `  "types": [\n${lines(catalog.types)}\n  ],`,
    `  "problems": [\n${lines(catalog.problems)}\n  ]`,
    "}",
    "",
  ].join("\n");
}

async function main() {
  console.log(`Fetching ${PAGE}`);
  const res = await fetch(PAGE, { headers: { "User-Agent": "Mozilla/5.0 cp-picker" } });
  if (!res.ok) throw new Error(`${PAGE}: HTTP ${res.status}`);
  const html = await res.text();

  const types = [];
  const problems = [];
  const unknownSections = [];
  for (const section of html.split("<h2>").slice(1)) {
    const name = decode(section.slice(0, section.indexOf("</h2>")));
    const tasks = [
      ...section.matchAll(
        /<li class="task"><a href="\/problemset\/task\/(\d+)\/?">(.*?)<\/a><span class="detail">(\d+) \/ (\d+)<\/span>/g,
      ),
    ];
    if (tasks.length === 0) continue;
    const categoryId = SECTION_CATEGORY[name];
    if (!categoryId) {
      unknownSections.push(name);
      continue;
    }
    const typeId = `cses_${slug(name)}`;
    types.push({ id: typeId, name: `CSES: ${name}`, categoryId, group: "CSES Problem Set" });
    for (const [, id, title, solvers] of tasks) {
      const rating = estimateRating(Number(solvers));
      problems.push({
        id: `cses:${id}`,
        url: `https://cses.fi/problemset/task/${id}`,
        title: decode(title),
        platform: "CSES",
        rating,
        ratingEstimated: true,
        types: { [typeId]: levelFromRating(rating) },
      });
    }
  }
  if (problems.length === 0) throw new Error("No problems found; the page layout may have changed");

  const usedCategories = new Set(types.map((t) => t.categoryId));
  const catalog = {
    source: "cses",
    url: PAGE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    categories: CATEGORIES.filter((c) => usedCategories.has(c.id)),
    types,
    problems,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, stringify(catalog));
  console.log(`Wrote ${OUT}\n  ${types.length} types, ${problems.length} problems`);
  if (unknownSections.length > 0) console.log(`  Skipped sections: ${unknownSections.join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
