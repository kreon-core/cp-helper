import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = join(repo, "package.json");
const MANIFEST_JSON = join(repo, "public", "manifest.json");

const VERSION_FIELD = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/u;

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

const current = readVersion(PACKAGE_JSON);
const version = nextVersion(current, process.argv[2] ?? "patch");
writeVersionField(PACKAGE_JSON, version);
writeVersionField(MANIFEST_JSON, version);
console.log(`${current} -> ${version} (cp-picker/package.json, cp-picker/public/manifest.json)`);
