/** Return the balanced `{…}` JSON object starting at `start`, or null. String-aware. */
export function sliceBalancedJson(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/** Find the first marker present in `html` and parse the JSON object that follows it. null if none parses. */
export function extractEmbeddedJson(html: string, markers: string[]): unknown {
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i === -1) continue;
    const json = sliceBalancedJson(html, i + marker.length);
    if (!json) continue;
    try { return JSON.parse(json); } catch { /* try next marker */ }
  }
  return null;
}
