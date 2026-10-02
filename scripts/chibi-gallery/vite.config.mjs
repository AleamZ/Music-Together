import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Bundles the offscreen gallery page (scripts/chibi-gallery/main.ts) for render.mjs. OUT: the output folder.
const here = dirname(fileURLToPath(import.meta.url));
export default {
  root: here,
  base: "./",
  logLevel: "warn",
  resolve: { alias: { "@": resolve(here, "../..") } },
  // the furniture catalogue's module also holds its RPCs (a supabase client): placeholders, the gallery never calls them
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("http://localhost:1"), "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("gallery") },
  build: { outDir: process.env.OUT ?? resolve(here, "dist"), emptyOutDir: true, minify: false },
};
