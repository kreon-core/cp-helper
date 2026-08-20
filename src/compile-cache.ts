import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { constants as fsConstants } from "fs";
import { createHash, randomBytes } from "crypto";
import { BINARY_CACHE_MAX_ENTRIES } from "./constants";

let cacheDir: string | null = null;

/**
 * Set once on activation; binaries live in extension global storage so they survive a reload.
 * @param dir absolute directory path
 */
export function setBinaryCacheDir(dir: string): void {
  cacheDir = dir;
}

function binaryDir(): string {
  return cacheDir ?? path.join(os.tmpdir(), "cp-helper-bin");
}

const exeSuffix = process.platform === "win32" ? ".exe" : "";

/**
 * Cache key for a build: source *content* rather than mtime, so a save that changed nothing
 * (formatter, save-on-focus-change) reuses the binary instead of recompiling.
 * @param file absolute source path
 * @param compileCmd raw compile template
 * @param defineLocal whether `-DLOCAL` is injected
 */
export async function binaryPathForBuild(
  file: string,
  compileCmd: string,
  defineLocal: boolean,
): Promise<string> {
  const source = await fs.readFile(file);
  const key = createHash("sha256")
    .update(source)
    .update(" ")
    .update(compileCmd)
    .update(" ")
    .update(defineLocal ? "1" : "0")
    .update(" ")
    .update(process.platform)
    .digest("hex")
    .slice(0, 24);
  const base = path.basename(file).replace(/[^A-Za-z0-9._-]/gu, "_");
  return path.join(binaryDir(), `${base}-${key}${exeSuffix}`);
}

/**
 * @param binPath candidate cached binary
 * @returns true when it exists, is executable, and is non-empty
 */
export async function cachedBinaryUsable(binPath: string): Promise<boolean> {
  try {
    await fs.access(binPath, fsConstants.X_OK);
    const { size } = await fs.stat(binPath);
    return size > 0;
  } catch {
    return false;
  }
}

/**
 * Path the compiler writes to. A rename into place afterwards keeps a half-written binary from
 * ever being picked up as a cache hit (a compile killed by Stop leaves the staging file behind).
 * @param binPath final cached path
 */
export function stagingPathFor(binPath: string): string {
  return `${binPath}.${randomBytes(4).toString("hex")}.tmp`;
}

/**
 * @param stagingPath compiler output
 * @param binPath final cached path
 */
export async function commitBinary(
  stagingPath: string,
  binPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(binPath), { recursive: true });
  await fs.rename(stagingPath, binPath);
}

export async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(binaryDir(), { recursive: true }).catch(() => undefined);
}

/**
 * Keep the most recently used binaries, drop the rest. Also clears stale staging files.
 */
export async function pruneBinaryCache(): Promise<void> {
  const dir = binaryDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const stats = await Promise.all(
    names.map(async (n) => {
      const full = path.join(dir, n);
      try {
        const st = await fs.stat(full);
        return { full, atime: st.atimeMs, staging: n.endsWith(".tmp") };
      } catch {
        return null;
      }
    }),
  );
  const live = stats.filter((e): e is NonNullable<typeof e> => e !== null);
  const doomed = live.filter((e) => e.staging);
  const keep = live
    .filter((e) => !e.staging)
    .sort((a, b) => b.atime - a.atime);
  doomed.push(...keep.slice(BINARY_CACHE_MAX_ENTRIES));
  await Promise.all(
    doomed.map((e) => fs.unlink(e.full).catch(() => undefined)),
  );
}
