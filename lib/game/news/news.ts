// v18.11 Báo Làng: the dev blog and the village news of 0032_news.sql. Pure: types, parsing and the popup choice.

export interface NewsPost {
  id: string;
  title: string;
  emoji: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewsEvent {
  id: number;
  kind: string;
  text: string;
  createdAt: string;
}

export interface NewsFeed {
  posts: NewsPost[];
  events: NewsEvent[];
  unread: { posts: number; events: number };
  /** Posts of the last 24 h this viewer has not seen, oldest first (the server's choice). */
  popup: NewsPost[];
  serverNow: string;
}

export const EMPTY_FEED: NewsFeed = { posts: [], events: [], unread: { posts: 0, events: 0 }, popup: [], serverNow: "" };

/** A dev-blog post pops up for this long after it is published; after that it waits at the stand. */
export const POPUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function parsePost(v: unknown): NewsPost | null {
  const r = obj(v);
  const id = str(r.id);
  if (!id) return null;
  return {
    id, title: str(r.title), emoji: str(r.emoji) || "📢", body: str(r.body), pinned: r.pinned === true,
    createdAt: str(r.created_at), updatedAt: str(r.updated_at) || str(r.created_at),
  };
}

export function parsePosts(v: unknown): NewsPost[] {
  return Array.isArray(v) ? v.map(parsePost).filter((p): p is NewsPost => p !== null) : [];
}

export function parseFeed(v: unknown): NewsFeed {
  const r = obj(v);
  const u = obj(r.unread);
  const events = Array.isArray(r.events)
    ? r.events.map((e) => {
        const x = obj(e);
        return { id: Number(x.id ?? 0), kind: str(x.kind), text: str(x.text), createdAt: str(x.created_at) };
      }).filter((e) => e.text !== "")
    : [];
  return {
    posts: parsePosts(r.posts), events,
    unread: { posts: Math.max(0, Number(u.posts ?? 0) || 0), events: Math.max(0, Number(u.events ?? 0) || 0) },
    popup: parsePosts(r.popup), serverNow: str(r.server_now),
  };
}

/** The posts to pop up now: published within the last 24 h, after the viewer's marker (null: never marked), and not
 *  already popped up in this visit; oldest first. The server applies the same window and marker; the client keeps the
 *  per-visit list so a closed popup never comes back before the mark reaches the server. */
export function pickPopup(posts: readonly NewsPost[], opts: { now: number; seenAt?: number | null; shown?: ReadonlySet<string> }): NewsPost[] {
  const { now, seenAt = null, shown } = opts;
  return posts
    .filter((p) => {
      const t = Date.parse(p.createdAt);
      if (!Number.isFinite(t)) return false;
      if (t <= now - POPUP_WINDOW_MS) return false;
      if (seenAt !== null && t <= seenAt) return false;
      return !shown?.has(p.id);
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** The dot on the stand and the HUD. */
export const hasUnread = (f: NewsFeed): boolean => f.unread.posts > 0 || f.unread.events > 0;

/** "27/09 14:05" in Vietnam time. */
export function newsTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(t));
}

export function newsErrorMessage(msg: string): string {
  if (msg.includes("root role required")) return "Chỉ quản trị viên mới đăng bài được.";
  if (msg.includes("invalid title")) return "Tiêu đề cần từ 1 đến 120 ký tự.";
  if (msg.includes("invalid emoji")) return "Biểu tượng quá dài.";
  if (msg.includes("body too long")) return "Nội dung quá dài (tối đa 8000 ký tự).";
  if (msg.includes("post not found")) return "Bài viết không còn nữa.";
  return "Không lưu được, thử lại nhé.";
}
