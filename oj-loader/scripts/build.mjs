import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  target: "chrome120",
  outdir: dist,
  logLevel: "info",
};

const builds = [
  { ...common, format: "esm", entryPoints: { background: "src/background.ts" } },
  {
    ...common,
    format: "iife",
    entryPoints: {
      options: "src/options.ts",
      "tab-title": "src/tab-title.ts",
      "inpage/extract": "src/inpage/dispatch.ts",
      "inpage/submit": "src/inpage/submit-dispatch.ts",
    },
  },
];

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, "public"), dist, { recursive: true });

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context({ ...options, absWorkingDir: root });
    await ctx.watch();
  }
} else {
  await Promise.all(
    builds.map((options) => esbuild.build({ ...options, absWorkingDir: root })),
  );
}
