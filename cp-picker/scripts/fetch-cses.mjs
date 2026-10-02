import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = "https://cses.fi/problemset/";
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data");
const OUT = resolve(DATA, "sources/cses.json");

const EXCLUDED_SECTIONS = new Set(["Introductory Problems"]);

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

function estimateRating(solvers) {
  const rating = 800 + (Math.log10(TOP_SOLVERS) - Math.log10(Math.max(1, solvers))) * RATING_PER_DECADE;
  return Math.max(800, Math.min(3500, Math.round(rating / 10) * 10));
}

function stringify(catalog) {
  const lines = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(",\n");
  return [
    "{",
    `  "source": ${JSON.stringify(catalog.source)},`,
    `  "url": ${JSON.stringify(catalog.url)},`,
    `  "fetchedAt": ${JSON.stringify(catalog.fetchedAt)},`,
    `  "types": [],`,
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

  const problems = [];
  for (const section of html.split("<h2>").slice(1)) {
    const name = decode(section.slice(0, section.indexOf("</h2>")));
    if (EXCLUDED_SECTIONS.has(name)) continue;
    for (const [, id, title, solvers] of section.matchAll(
      /<li class="task"><a href="\/problemset\/task\/(\d+)\/?">(.*?)<\/a><span class="detail">(\d+) \/ (\d+)<\/span>/g,
    )) {
      problems.push({
        id: `cses:${id}`,
        url: `https://cses.fi/problemset/task/${id}`,
        title: decode(title),
        platform: "CSES",
        rating: estimateRating(Number(solvers)),
        ratingEstimated: true,
        types: {},
      });
    }
  }
  if (problems.length === 0) throw new Error("No problems found; the page layout may have changed");

  const catalog = {
    source: "cses",
    url: PAGE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    problems,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, stringify(catalog));

  const tagged = new Set(Object.keys(JSON.parse(await readFile(resolve(DATA, "tags.json"), "utf8"))));
  const others = (await readdir(resolve(DATA, "sources"))).filter((f) => f.endsWith(".json") && f !== "cses.json");
  for (const file of others) {
    const source = JSON.parse(await readFile(resolve(DATA, "sources", file), "utf8"));
    for (const p of source.problems) tagged.add(p.id);
  }
  const untagged = problems.filter((p) => !tagged.has(p.id));
  console.log(`Wrote ${OUT}\n  ${problems.length} problems, ${untagged.length} without types`);
  for (const p of untagged) console.log(`  ${p.id} ${p.title}: add its types to src/data/tags.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
