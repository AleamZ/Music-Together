/** Word-wrap a chat message for a bubble: ≤ maxLines lines of ≤ maxChars, "…" when cut. */
export function wrapBubble(text: string, maxChars = 28, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const lastLine = kept[maxLines - 1];
  kept[maxLines - 1] = (lastLine.length >= maxChars ? lastLine.slice(0, maxChars - 1) : lastLine) + "…";
  return kept;
}
