import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data");
const SOURCES = resolve(DATA, "sources");
const CATEGORIES = resolve(DATA, "categories.json");
const GROUPS = resolve(DATA, "groups.json");
const RESEARCH = resolve(DATA, "research.json");
const TAGS = resolve(DATA, "tags.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const files = (await readdir(SOURCES)).filter((f) => f.endsWith(".json")).sort();
  const sources = await Promise.all(files.map(async (f) => ({ file: f, data: await readJson(resolve(SOURCES, f)) })));
  const categories = await readJson(CATEGORIES);
  const groups = await readJson(GROUPS);
  const research = await readJson(RESEARCH);
  const tags = await readJson(TAGS);

  const errors = [];
  const typeIds = new Set();
  for (const { file, data } of sources) {
    for (const t of data.types) {
      typeIds.add(t.id);
      if (!(t.categoryId in categories)) errors.push(`${file}: type ${t.id} has unknown category ${t.categoryId}`);
      if (t.groupId && !(t.groupId in (groups[t.categoryId] ?? {}))) {
        errors.push(`${file}: type ${t.id} has unknown group ${t.categoryId}/${t.groupId}`);
      }
    }
  }
  for (const { file, data } of sources) {
    for (const p of data.problems) {
      for (const typeId of Object.keys(p.types)) {
        if (!typeIds.has(typeId)) errors.push(`${file}: problem ${p.id} has unknown type ${typeId}`);
      }
    }
  }
  for (const [id, list] of Object.entries(tags)) {
    for (const typeId of list) if (!typeIds.has(typeId)) errors.push(`tags.json: problem ${id} has unknown type ${typeId}`);
  }
  for (const typeId of research) if (!typeIds.has(typeId)) errors.push(`research.json: unknown type ${typeId}`);

  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`${errors.length} unknown id(s) found`);
    process.exit(1);
  }
  console.log(`Checked ${typeIds.size} types across ${files.length} sources`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
