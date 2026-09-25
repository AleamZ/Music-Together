const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("vi", { granularity: "grapheme" })
  : null;

/** User-perceived characters of NFC text: an emoji, or a letter with its accents, counts as one. */
export function graphemes(text: string): string[] {
  const s = text.normalize("NFC");
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
}

/** Word-wrap a chat message for a bubble: ≤ maxLines lines of ≤ maxChars characters (graphemes), "…" when cut. */
export function wrapBubble(text: string, maxChars = 28, maxLines = 2): string[] {
  const words = text.normalize("NFC").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const word of words) {
    let w = graphemes(word);
    while (w.length > maxChars) {
      if (cur.length > 0) {
        lines.push(cur);
        cur = [];
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (w.length === 0) continue;
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur = [...cur, " ", ...w];
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = [...(last.length >= maxChars ? last.slice(0, maxChars - 1) : last), "…"];
  }
  return lines.map((l) => l.join(""));
}
