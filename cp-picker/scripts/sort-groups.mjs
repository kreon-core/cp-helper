import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data");
const SOURCES = resolve(DATA, "sources");
const GROUPS = resolve(DATA, "groups.json");
const RESEARCH = resolve(DATA, "research.json");
const TAGS = resolve(DATA, "tags.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const files = (await readdir(SOURCES)).filter((f) => f.endsWith(".json")).sort();
  const sources = await Promise.all(files.map((f) => readJson(resolve(SOURCES, f))));
  const research = new Set(await readJson(RESEARCH));
  const groups = await readJson(GROUPS);
  const tags = await readJson(TAGS);

  const groupOf = new Map();
  for (const s of sources) {
    for (const t of s.types) {
      if (t.groupId && !research.has(t.id) && !groupOf.has(t.id)) groupOf.set(t.id, `${t.categoryId}/${t.groupId}`);
    }
  }
  const problems = new Map();
  for (const s of sources) {
    for (const p of s.problems) {
      const keys = problems.get(p.id) ?? new Set();
      for (const typeId of Object.keys(p.types)) if (groupOf.has(typeId)) keys.add(groupOf.get(typeId));
      problems.set(p.id, keys);
    }
  }
  for (const [id, typeIds] of Object.entries(tags)) {
    const keys = problems.get(id);
    if (keys) for (const typeId of typeIds) if (groupOf.has(typeId)) keys.add(groupOf.get(typeId));
  }
  const count = new Map();
  for (const keys of problems.values()) for (const key of keys) count.set(key, (count.get(key) ?? 0) + 1);

  const sorted = Object.fromEntries(
    Object.entries(groups).map(([categoryId, names]) => {
      const freq = (id) => count.get(`${categoryId}/${id}`) ?? 0;
      return [categoryId, Object.fromEntries(Object.entries(names).sort(([a], [b]) => freq(b) - freq(a)))];
    }),
  );
  await writeFile(GROUPS, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote ${GROUPS}`);
  for (const [categoryId, names] of Object.entries(sorted)) {
    const top = Object.keys(names)
      .slice(0, 3)
      .map((id) => `${id} (${count.get(`${categoryId}/${id}`) ?? 0})`);
    console.log(`  ${categoryId}: ${top.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
