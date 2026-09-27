// v18.11: the dev blog's simple markdown — headings, bold, lists, links — parsed into nodes that React renders as
// elements. No HTML is ever produced from the text, and a link keeps only an http(s) address.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "link"; v: string; href: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; content: Inline[] }
  | { t: "p"; content: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] };

/** A link target a reader may follow: an absolute http(s) URL, else null. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const push = (n: Inline) => {
    const last = out[out.length - 1];
    if (n.t === "text" && last?.t === "text") last.v += n.v;
    else if (n.t !== "text" || n.v !== "") out.push(n);
  };
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const i = m.index ?? 0;
    push({ t: "text", v: line.slice(at, i) });
    if (m[1] !== undefined) push({ t: "bold", v: m[1] });
    else {
      const href = safeHref(m[3] ?? "");
      push(href ? { t: "link", v: m[2] ?? "", href } : { t: "text", v: m[2] ?? "" });
    }
    at = i + m[0].length;
  }
  push({ t: "text", v: line.slice(at) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", content: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") { flushPara(); flushList(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, content: parseInline(h[2]) });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = ul ? null : /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.t !== kind) { flushList(); list = { t: kind, items: [] }; }
      list.items.push(parseInline((ul ?? ol)![1]));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
