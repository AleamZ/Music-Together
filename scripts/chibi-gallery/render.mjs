// Renders the chibi outfit gallery sheets to PNGs (offscreen, no DB). Usage:
//   OUT=/tmp/gal npx vite build --config scripts/chibi-gallery/vite.config.mjs
//   node scripts/chibi-gallery/render.mjs /tmp/gal docs/superpowers/specs/chibi-outfits [sheet-name-filter]
// Uses the preinstalled Chromium in /opt/pw-browsers (never `playwright install`).
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { extname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");
const [dist, outDir, filter = ""] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  try {
    const p = join(dist, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error(m.text()); });
page.on("pageerror", (e) => console.error(e));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.ready === true);
const names = await page.evaluate((f) => window.sheetNames().filter((n) => n.includes(f)), filter);
for (const name of names) {
  const url = await page.evaluate((n) => window.renderNamed(n), name);
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", name);
}
if (!filter) writeFileSync(join(outDir, "coverage.md"), await page.evaluate(() => window.coverage()));
await browser.close();
server.close();
