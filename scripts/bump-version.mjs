import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = join(repo, "package.json");
const MANIFEST_JSON = join(repo, "oj-sync", "manifest.json");
const OJ_SYNC_README = join(repo, "oj-sync", "README.md");

const VERSION_FIELD = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/u;
const README_LINE =
  /^\*\*Version \d+\.\d+\.\d+\*\* - aligned with \*\*CP Helper \d+\.\d+\.\d+\*\*\./mu;

function readVersion(file) {
  const m = readFileSync(file, "utf8").match(VERSION_FIELD);
  if (!m) {
    throw new Error(`No "version" field in ${file}`);
  }
  return m[2];
}

function nextVersion(current, spec) {
  if (/^\d+\.\d+\.\d+$/u.test(spec)) {
    return spec;
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (spec === "major") return `${major + 1}.0.0`;
  if (spec === "minor") return `${major}.${minor + 1}.0`;
  if (spec === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Usage: bump-version.mjs [patch|minor|major|x.y.z]`);
}

function writeVersionField(file, version) {
  const text = readFileSync(file, "utf8");
  if (!VERSION_FIELD.test(text)) {
    throw new Error(`No "version" field in ${file}`);
  }
  writeFileSync(file, text.replace(VERSION_FIELD, `$1${version}$3`));
}

function writeReadmeLine(file, version) {
  const text = readFileSync(file, "utf8");
  if (!README_LINE.test(text)) {
    throw new Error(`No version line in ${file}`);
  }
  writeFileSync(
    file,
    text.replace(
      README_LINE,
      `**Version ${version}** - aligned with **CP Helper ${version}**.`,
    ),
  );
}

const current = readVersion(PACKAGE_JSON);
const version = nextVersion(current, process.argv[2] ?? "patch");
writeVersionField(PACKAGE_JSON, version);
writeVersionField(MANIFEST_JSON, version);
writeReadmeLine(OJ_SYNC_README, version);
console.log(`${current} -> ${version} (package.json, oj-sync/manifest.json, oj-sync/README.md)`);
