import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Bundles the offscreen gallery page (scripts/chibi-gallery/main.ts) for render.mjs. OUT: the output folder.
const here = dirname(fileURLToPath(import.meta.url));
export default {
  root: here,
  base: "./",
  logLevel: "warn",
  resolve: { alias: { "@": resolve(here, "../..") } },
  build: { outDir: process.env.OUT ?? resolve(here, "dist"), emptyOutDir: true, minify: false },
};
