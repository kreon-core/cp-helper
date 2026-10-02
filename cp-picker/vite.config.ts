import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      input: { index: "index.html", background: "src/background.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        codeSplitting: {
          groups: [
            {
              debugName: "sources",
              name: (id) => /\/src\/data\/sources\/([^/]+)\.json$/.exec(id)?.[1] ?? null,
            },
          ],
        },
      },
    },
  },
});
