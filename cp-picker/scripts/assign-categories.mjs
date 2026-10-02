import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = resolve(ROOT, "src/data/sources");
const OUT = resolve(ROOT, "src/data/assignments.json");
const CATEGORIES = resolve(ROOT, "src/data/categories.json");
const RESEARCH = resolve(ROOT, "src/data/research.json");
const TAGS = resolve(ROOT, "src/data/tags.json");
const CACHE = resolve(ROOT, "scripts/.cache/statements");
const CF_API = "https://codeforces.com/api/problemset.problems";
const DELAY_MS = 400;

const KEYWORDS = {
  graph_theory: [
    "graph", "vertex", "vertices", "edge", "edges", "tree", "trees", "node", "nodes", "path", "paths", "cycle",
    "connected", "road", "roads", "city", "cities", "root", "rooted", "leaf", "leaves", "neighbor", "neighbors",
    "directed", "undirected", "shortest", "subtree", "parent", "ancestor", "flight", "flights",
  ],
  data_structures: [
    "query", "queries", "array", "segment", "range", "ranges", "interval", "intervals", "update", "updates",
    "subarray", "subarrays", "stack", "queue", "element", "elements", "sorted", "online", "change", "changes",
  ],
  number_theory: [
    "prime", "primes", "divisor", "divisors", "divisible", "divides", "gcd", "lcm", "modulo", "mod", "factor",
    "factors", "coprime", "multiple", "multiples", "remainder", "factorization", "totient",
  ],
  combinatorics: [
    "ways", "count", "counting", "permutation", "permutations", "choose", "combination", "combinations",
    "arrangement", "arrangements", "distinct", "configurations", "colorings", "binomial",
  ],
  math: [
    "sum", "expected", "probability", "polynomial", "equation", "equations", "matrix", "matrices", "formula",
    "fraction", "real", "function", "xor", "bitwise", "bits", "power", "powers", "exponent", "linear",
  ],
  strings: [
    "string", "strings", "substring", "substrings", "character", "characters", "letter", "letters", "palindrome",
    "palindromes", "palindromic", "prefix", "prefixes", "suffix", "suffixes", "word", "words", "lowercase",
    "alphabet", "pattern", "patterns",
  ],
  dynamic_programming: ["optimal", "minimum", "maximum", "maximize", "minimize", "cost", "subsequence", "subsequences"],
  game_theory: ["game", "games", "player", "players", "win", "wins", "winner", "alice", "bob", "turn", "turns", "optimally"],
  geometry: [
    "point", "points", "polygon", "polygons", "coordinate", "coordinates", "line", "lines", "circle", "circles",
    "plane", "area", "convex", "angle", "triangle", "triangles", "rectangle", "rectangles", "geometry", "distance",
  ],
  miscellaneous: [],
};

const CF_TAGS = {
  graphs: "graph_theory",
  trees: "graph_theory",
  "shortest paths": "graph_theory",
  "dfs and similar": "graph_theory",
  "graph matchings": "graph_theory",
  flows: "graph_theory",
  "2-sat": "graph_theory",
  dsu: "data_structures",
  "data structures": "data_structures",
  "number theory": "number_theory",
  "chinese remainder theorem": "number_theory",
  combinatorics: "combinatorics",
  probabilities: "combinatorics",
  math: "math",
  matrices: "math",
  fft: "math",
  bitmasks: "math",
  strings: "strings",
  "string suffix structures": "strings",
  hashing: "strings",
  dp: "dynamic_programming",
  games: "game_theory",
  geometry: "geometry",
  "two pointers": "miscellaneous",
  "binary search": "miscellaneous",
  greedy: "miscellaneous",
  "constructive algorithms": "miscellaneous",
  "divide and conquer": "miscellaneous",
  "meet-in-the-middle": "miscellaneous",
  interactive: "miscellaneous",
  "brute force": "miscellaneous",
  sortings: "miscellaneous",
  implementation: "miscellaneous",
  "ternary search": "miscellaneous",
};

const WEIGHTS = { statement: 1, tags: 1, types: 0.75 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\\[a-z]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function between(html, start, ends) {
  const from = html.indexOf(start);
  if (from < 0) return "";
  let to = html.length;
  for (const end of ends) {
    const at = html.indexOf(end, from + start.length);
    if (at >= 0 && at < to) to = at;
  }
  return html.slice(from + start.length, to);
}

function statementUrl(problem) {
  if (problem.platform === "AtCoder") return `${problem.url}?lang=en`;
  if (problem.platform === "CSES") return problem.url;
  return null;
}

function extractStatement(problem, html) {
  if (problem.platform === "AtCoder") {
    return htmlToText(between(html, '<span class="lang-en">', ["Sample Input 1", "</span>\n</span>"]));
  }
  return htmlToText(between(html, '<div class="md">', ['<h1 id="example', "<h1>Example", "Example"]));
}

async function statementFor(problem) {
  const url = statementUrl(problem);
  if (!url) return "";
  const file = resolve(CACHE, `${problem.id.replace(/[^\w-]/g, "_")}.txt`);
  try {
    return await readFile(file, "utf8");
  } catch {
    await sleep(DELAY_MS);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 cp-picker" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = extractStatement(problem, await res.text());
    await writeFile(file, text);
    return text;
  }
}

function keywordHits(text) {
  const counts = new Map();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  const hits = {};
  for (const [category, words] of Object.entries(KEYWORDS)) {
    hits[category] = words.reduce((sum, w) => sum + Math.min(3, counts.get(w) ?? 0), 0);
  }
  return hits;
}

function levelFromRating(rating) {
  if (rating === undefined) return 2;
  if (rating < 1400) return 1;
  if (rating < 1900) return 2;
  if (rating < 2400) return 3;
  return 4;
}

function shares(values, candidates) {
  const total = candidates.reduce((sum, c) => sum + (values[c] ?? 0), 0);
  return Object.fromEntries(candidates.map((c) => [c, total > 0 ? (values[c] ?? 0) / total : 0]));
}

async function main() {
  const files = (await readdir(SOURCES)).filter((f) => f.endsWith(".json")).sort();
  const sources = await Promise.all(files.map(async (f) => JSON.parse(await readFile(resolve(SOURCES, f), "utf8"))));
  sources.sort((a, b) => b.types.length - a.types.length);

  const categoryOrder = Object.keys(JSON.parse(await readFile(CATEGORIES, "utf8")));
  const research = new Set(JSON.parse(await readFile(RESEARCH, "utf8")));
  const typeCategory = new Map();
  for (const s of sources) {
    for (const t of s.types) if (!research.has(t.id) && !typeCategory.has(t.id)) typeCategory.set(t.id, t.categoryId);
  }

  const problems = new Map();
  for (const s of sources) {
    for (const p of s.problems) {
      const current = problems.get(p.id);
      problems.set(p.id, current ? { ...current, types: { ...current.types, ...p.types } } : { ...p, types: { ...p.types } });
    }
  }
  for (const [id, typeIds] of Object.entries(JSON.parse(await readFile(TAGS, "utf8")))) {
    const problem = problems.get(id);
    if (!problem) continue;
    const rating = problem.rating ?? sources.flatMap((s) => s.problems).find((p) => p.id === id && p.rating)?.rating;
    for (const typeId of typeIds) problem.types[typeId] ??= levelFromRating(rating);
  }

  const multi = [...problems.values()].filter((p) => {
    const categories = new Set(Object.keys(p.types).map((t) => typeCategory.get(t)).filter(Boolean));
    return categories.size > 1;
  });
  console.log(`${multi.length} of ${problems.size} problems are in more than one category`);

  console.log("Fetching Codeforces tags");
  const cf = await (await fetch(CF_API)).json();
  if (cf.status !== "OK") throw new Error(`Codeforces API: ${cf.comment ?? cf.status}`);
  const cfTags = new Map(cf.result.problems.map((p) => [`cf:${p.contestId}${p.index}`, p.tags ?? []]));

  await mkdir(CACHE, { recursive: true });
  const assignments = {};
  const tally = {};
  const evidence = { statement: 0, tags: 0 };
  let failed = 0;
  for (const problem of multi) {
    const candidates = categoryOrder.filter((c) =>
      Object.keys(problem.types).some((t) => typeCategory.get(t) === c),
    );

    let statement = "";
    try {
      statement = await statementFor(problem);
    } catch (err) {
      failed++;
      console.warn(`  ${problem.id}: ${err instanceof Error ? err.message : err}`);
    }
    const text = `${problem.title} ${statement}`;
    if (statement) evidence.statement++;

    const tagHits = {};
    for (const tag of cfTags.get(problem.id) ?? []) {
      const category = CF_TAGS[tag];
      if (category) tagHits[category] = (tagHits[category] ?? 0) + 1;
    }
    if (Object.keys(tagHits).length > 0) evidence.tags++;

    const typeWeight = {};
    for (const [typeId, level] of Object.entries(problem.types)) {
      const category = typeCategory.get(typeId);
      if (category) typeWeight[category] = (typeWeight[category] ?? 0) + (5 - level);
    }

    const kw = shares(keywordHits(text), candidates);
    const tg = shares(tagHits, candidates);
    const ty = shares(typeWeight, candidates);
    let best = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
      const score = WEIGHTS.statement * kw[c] + WEIGHTS.tags * tg[c] + WEIGHTS.types * ty[c];
      if (score > bestScore + 1e-9) {
        best = c;
        bestScore = score;
      }
    }
    assignments[problem.id] = best;
    tally[best] = (tally[best] ?? 0) + 1;
  }

  const sorted = Object.fromEntries(
    Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })),
  );
  const body = Object.entries(sorted)
    .map(([id, c]) => `  ${JSON.stringify(id)}: ${JSON.stringify(c)}`)
    .join(",\n");
  await writeFile(OUT, `{\n${body}\n}\n`);
  console.log(
    `Wrote ${OUT}\n  ${multi.length} problems assigned (${evidence.statement} with statements, ` +
      `${evidence.tags} with Codeforces tags, ${failed} statement fetches failed)`,
  );
  for (const c of categoryOrder) if (tally[c]) console.log(`  ${c}: ${tally[c]}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
