import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { addCategories, addGroups } from "./names.mjs";

const SITE = "https://youkn0wwho.academy";
const PAGE = `${SITE}/topic-list`;
const CF_API = "https://codeforces.com/api/problemset.problems";
const AC_PROBLEMS = "https://kenkoooo.com/atcoder/resources/problems.json";
const AC_MODELS = "https://kenkoooo.com/atcoder/resources/problem-models.json";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/sources/youkn0wwho.json");
const MAX_CF_CONTEST = 100000;
const EXCLUDED_GROUPS = new Set([
  "basics/intro_to_programming",
  "basics/learn_a_language",
  "basics/intro_to_competitive_programming",
  "basics/complexity_analysis",
  "basics/standard_template_library_stl",
  "basics/basic_sorting_algorithms",
  "basics/very_basic_graphs",
]);

async function get(url, kind = "text") {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 cp-picker" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return kind === "json" ? res.json() : res.text();
}

function literalEnd(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("Unterminated literal");
}

function enclosingOpen(src, from) {
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    const c = src[i];
    if (c === "}" || c === "]") depth++;
    else if (c === "{" || c === "[") {
      if (depth === 0) return i;
      depth--;
    }
  }
  throw new Error("No enclosing literal");
}

function evaluate(src, start) {
  return vm.runInNewContext(`(${src.slice(start, literalEnd(src, start))})`, {}, { timeout: 10000 });
}

function findTopicList(chunks) {
  for (const src of chunks) {
    const at = src.indexOf("[{category_title:");
    if (at >= 0) return evaluate(src, at);
  }
  throw new Error("Topic list not found in any chunk");
}

function isProblemMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((p) => p && typeof p.problem_url === "string" && Array.isArray(p.topics));
}

function findProblems(chunks) {
  let best = null;
  for (const src of chunks) {
    const seen = new Set();
    for (const match of src.matchAll(/problem_url:"http/g)) {
      try {
        const start = enclosingOpen(src, enclosingOpen(src, match.index) - 1);
        if (seen.has(start)) continue;
        seen.add(start);
        const value = evaluate(src, start);
        if (isProblemMap(value) && Object.keys(value).length > Object.keys(best ?? {}).length) best = value;
      } catch {
        continue;
      }
    }
  }
  if (!best) throw new Error("Problem map not found in any chunk");
  return best;
}

function parseLink(url, acContestOf) {
  let m = /^https?:\/\/(?:www\.)?codeforces\.com\/(?:contest|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)\/?(?:[?#].*)?$/.exec(url);
  if (!m) {
    const v = /^https?:\/\/vjudge\.net\/problem\/CodeForces-(\d+)([A-Za-z]\d?)$/i.exec(url);
    if (v) m = v;
  }
  if (m) {
    const contest = Number(m[1]);
    if (contest >= MAX_CF_CONTEST) return null;
    const index = m[2].toUpperCase();
    return {
      id: `cf:${contest}${index}`,
      key: `${contest}${index}`,
      platform: "Codeforces",
      url: `https://codeforces.com/contest/${contest}/problem/${index}`,
    };
  }
  m =
    /^https?:\/\/cses\.fi\/problemset\/task\/(\d+)\/?(?:[?#].*)?$/.exec(url) ??
    /^https?:\/\/vjudge\.net\/problem\/CSES-(\d+)$/i.exec(url);
  if (m) {
    return { id: `cses:${m[1]}`, key: m[1], platform: "CSES", url: `https://cses.fi/problemset/task/${m[1]}` };
  }
  let task = null;
  let contest = null;
  m = /^https?:\/\/atcoder\.jp\/contests\/([\w-]+)\/tasks\/([\w-]+)\/?(?:[?#].*)?$/.exec(url);
  if (m) [, contest, task] = m;
  else {
    const v = /^https?:\/\/vjudge\.net\/problem\/AtCoder-([\w-]+)$/i.exec(url);
    if (v) {
      task = v[1];
      contest = acContestOf.get(task) ?? null;
    }
  }
  if (!task || !contest) return null;
  return {
    id: `ac:${task}`,
    key: task,
    platform: "AtCoder",
    url: `https://atcoder.jp/contests/${contest}/tasks/${task}`,
  };
}

function clipAtcoder(difficulty) {
  const d = difficulty >= 400 ? difficulty : 400 / Math.exp((400 - difficulty) / 400);
  return Math.round(d);
}

function asLevel(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 2;
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanCategoryName(name) {
  return name.replace(/\s*\([A-Z]+\)\s*$/, "").trim();
}

function stringify(catalog) {
  const lines = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(",\n");
  return [
    "{",
    `  "source": ${JSON.stringify(catalog.source)},`,
    `  "url": ${JSON.stringify(catalog.url)},`,
    `  "fetchedAt": ${JSON.stringify(catalog.fetchedAt)},`,
    `  "types": [\n${lines(catalog.types)}\n  ],`,
    `  "problems": [\n${lines(catalog.problems)}\n  ]`,
    "}",
    "",
  ].join("\n");
}

async function main() {
  console.log(`Fetching ${PAGE}`);
  const html = await get(PAGE);
  const scripts = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) ?? [])];
  const chunks = await Promise.all(scripts.map((path) => get(SITE + path)));
  const topicList = findTopicList(chunks);
  const rawProblems = Object.values(findProblems(chunks));
  console.log(`Found ${topicList.length} categories and ${rawProblems.length} problems`);

  console.log("Fetching Codeforces and AtCoder metadata");
  const [cf, acProblems, acModels] = await Promise.all([get(CF_API, "json"), get(AC_PROBLEMS, "json"), get(AC_MODELS, "json")]);
  if (cf.status !== "OK") throw new Error(`Codeforces API: ${cf.comment ?? cf.status}`);
  const cfInfo = new Map(cf.result.problems.map((p) => [`${p.contestId}${p.index}`, p]));
  const acInfo = new Map(acProblems.map((p) => [p.id, p]));
  const acContestOf = new Map(acProblems.map((p) => [p.id, p.contest_id]));

  const categories = new Map();
  const groups = new Map();
  const types = [];
  const typeIds = new Set();
  for (const cat of topicList) {
    categories.set(cat.category_id, cleanCategoryName(cat.category_title));
    for (const sub of cat.sub_categories ?? []) {
      const groupName = sub.sub_category_title.trim();
      const groupId = slug(groupName);
      const groupKey = `${cat.category_id}/${groupId}`;
      if (EXCLUDED_GROUPS.has(groupKey)) continue;
      if (!groups.has(groupKey)) groups.set(groupKey, [cat.category_id, groupId, groupName]);
      for (const topic of sub.topics ?? []) {
        if (typeIds.has(topic.topic_id)) continue;
        typeIds.add(topic.topic_id);
        types.push({
          id: topic.topic_id,
          name: topic.topic_title.trim(),
          categoryId: cat.category_id,
          groupId,
          importance: [1, 2, 3].includes(topic.importance) ? topic.importance : 2,
        });
      }
    }
  }

  const problems = new Map();
  let skipped = 0;
  for (const raw of rawProblems) {
    const link = typeof raw.problem_url === "string" ? parseLink(raw.problem_url.trim(), acContestOf) : null;
    const topics = (raw.topics ?? []).filter((t) => typeIds.has(t));
    if (!link || topics.length === 0) {
      skipped++;
      continue;
    }
    const existing = problems.get(link.id);
    const problem = existing ?? { id: link.id, url: link.url, title: "", platform: link.platform };
    if (!existing) {
      if (link.platform === "CSES") {
        problem.title = (raw.problem_title ?? "").trim();
      } else if (link.platform === "Codeforces") {
        const info = cfInfo.get(link.key);
        problem.title = (info?.name ?? raw.problem_title ?? "").trim();
        if (typeof info?.rating === "number") problem.rating = info.rating;
      } else {
        const info = acInfo.get(link.key);
        problem.title = (info?.name ?? raw.problem_title ?? "").trim();
        const model = acModels[link.key];
        if (typeof model?.difficulty === "number") problem.rating = clipAtcoder(model.difficulty);
      }
      if (!problem.title) problem.title = link.key;
      problem.types = {};
      problems.set(link.id, problem);
    }
    const perTopic = raw.topic_wise_difficulty ?? {};
    for (const t of topics) {
      const level = asLevel(perTopic[t] ?? raw.difficulty);
      problem.types[t] = Math.min(problem.types[t] ?? 4, level);
    }
  }

  const sorted = [...problems.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const catalog = {
    source: "youkn0wwho",
    url: PAGE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    types,
    problems: sorted,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, stringify(catalog));
  const newCategories = await addCategories(categories);
  const newGroups = await addGroups(groups.values());
  const withProblems = new Set(sorted.flatMap((p) => Object.keys(p.types)));
  console.log(
    `Wrote ${OUT}\n  ${categories.size} categories (${newCategories} new), ${groups.size} groups (${newGroups} new), ` +
      `${types.length} types (${withProblems.size} with problems), ` +
      `${sorted.length} problems (${sorted.filter((p) => p.platform === "Codeforces").length} Codeforces, ` +
      `${sorted.filter((p) => p.platform === "AtCoder").length} AtCoder, ` +
      `${sorted.filter((p) => p.platform === "CSES").length} CSES), ${skipped} skipped`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
