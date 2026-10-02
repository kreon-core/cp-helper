import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data");

async function update(file, add) {
  const path = resolve(DATA, file);
  const data = JSON.parse(await readFile(path, "utf8"));
  const added = add(data);
  if (added > 0) await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return added;
}

function addMissing(names, id, name) {
  if (id in names) return 0;
  names[id] = name;
  return 1;
}

export const addCategories = (entries) =>
  update("categories.json", (categories) => {
    let added = 0;
    for (const [id, name] of entries) added += addMissing(categories, id, name);
    return added;
  });

export const addGroups = (entries) =>
  update("groups.json", (groups) => {
    let added = 0;
    for (const [categoryId, id, name] of entries) added += addMissing((groups[categoryId] ??= {}), id, name);
    return added;
  });
