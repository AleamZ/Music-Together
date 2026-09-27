import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewsModal from "@/components/game/NewsModal";
import { parseInline, parseMarkdown, safeHref } from "@/lib/game/news/markdown";
import { EMPTY_FEED, hasUnread, parseFeed, pickPopup, POPUP_WINDOW_MS, type NewsFeed, type NewsPost } from "@/lib/game/news/news";

afterEach(cleanup);

const NOW = Date.parse("2026-09-27T12:00:00Z");
const post = (id: string, agoMs: number, extra: Partial<NewsPost> = {}): NewsPost => {
  const at = new Date(NOW - agoMs).toISOString();
  return { id, title: `Bài ${id}`, emoji: "📢", body: "", pinned: false, createdAt: at, updatedAt: at, ...extra };
};
const H = 60 * 60 * 1000;

describe("the 24 h dev-blog popup", () => {
  it("pops up only posts younger than 24 h, oldest first", () => {
    const got = pickPopup([post("new", 1 * H), post("old", 25 * H), post("mid", 5 * H), post("edge", POPUP_WINDOW_MS)], { now: NOW });
    expect(got.map((p) => p.id)).toEqual(["mid", "new"]);
  });
  it("skips posts at or before the viewer's seen marker", () => {
    const got = pickPopup([post("a", 3 * H), post("b", 2 * H), post("c", 1 * H)], { now: NOW, seenAt: NOW - 2 * H });
    expect(got.map((p) => p.id)).toEqual(["c"]);
  });
  it("never shows a post twice in one visit, and ignores bad dates", () => {
    const got = pickPopup([post("a", H), post("b", H / 2), { ...post("x", 0), createdAt: "nope" }], { now: NOW, shown: new Set(["a"]) });
    expect(got.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("the feed", () => {
  it("parses the RPC answer defensively", () => {
    const f = parseFeed({
      posts: [{ id: "p1", title: "T", emoji: "", body: "b", pinned: true, created_at: "2026-09-27T00:00:00Z" }, { nope: 1 }],
      events: [{ id: 3, kind: "car", text: "🚗 xe", created_at: "2026-09-27T01:00:00Z" }, { id: 4, text: "" }],
      unread: { posts: 2, events: -1 }, popup: "bad", server_now: "2026-09-27T02:00:00Z",
    });
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]).toMatchObject({ emoji: "📢", pinned: true, updatedAt: "2026-09-27T00:00:00Z" });
    expect(f.events).toEqual([{ id: 3, kind: "car", text: "🚗 xe", createdAt: "2026-09-27T01:00:00Z" }]);
    expect(f.unread).toEqual({ posts: 2, events: 0 });
    expect(f.popup).toEqual([]);
    expect(hasUnread(f)).toBe(true);
    expect(hasUnread(EMPTY_FEED)).toBe(false);
  });
});

describe("the safe markdown", () => {
  it("parses headings, lists, bold and links into nodes", () => {
    const b = parseMarkdown("# Tin lớn\n\nChào **bà con**, xem [đây](https://example.com/a).\n- một\n- hai\n1. ba");
    expect(b[0]).toEqual({ t: "h", level: 1, content: [{ t: "text", v: "Tin lớn" }] });
    expect(b[1]).toEqual({ t: "p", content: [
      { t: "text", v: "Chào " }, { t: "bold", v: "bà con" }, { t: "text", v: ", xem " },
      { t: "link", v: "đây", href: "https://example.com/a" }, { t: "text", v: "." },
    ] });
    expect(b[2]).toEqual({ t: "ul", items: [[{ t: "text", v: "một" }], [{ t: "text", v: "hai" }]] });
    expect(b[3]).toEqual({ t: "ol", items: [[{ t: "text", v: "ba" }]] });
  });
  it("drops unsafe link targets and never produces HTML", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x)" }]);
    render(<NewsModal feed={{ ...EMPTY_FEED, posts: [post("p", H, { body: "<img src=x onerror=alert(1)> [bad](javascript:alert(1))" })] }} onClose={() => {}} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeTruthy();
  });
  it("is rendered without dangerouslySetInnerHTML", () => {
    const src = readFileSync(join(process.cwd(), "components/game/NewsModal.tsx"), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("NewsModal", () => {
  const feed: NewsFeed = {
    ...EMPTY_FEED,
    posts: [post("p1", H, { title: "Bản cập nhật", pinned: true })],
    events: [{ id: 1, kind: "car", text: "🚗 Làng có xe hơi mới!", createdAt: new Date(NOW).toISOString() }],
    unread: { posts: 0, events: 1 },
  };
  it("opens on the unread tab, marks each tab it shows and switches tabs", () => {
    const onRead = vi.fn();
    render(<NewsModal feed={feed} onRead={onRead} onClose={() => {}} />);
    expect(screen.getByText("🚗 Làng có xe hơi mới!")).toBeTruthy();
    expect(onRead).toHaveBeenLastCalledWith("events");
    fireEvent.click(screen.getByRole("tab", { name: /Thông báo/ }));
    expect(screen.getByText("Bản cập nhật")).toBeTruthy();
    expect(onRead).toHaveBeenLastCalledWith("posts");
  });
  it("shows the popup posts one by one with Tiếp →, then closes", () => {
    const onClose = vi.fn();
    const onRead = vi.fn();
    render(<NewsModal feed={feed} popup={[post("a", 2 * H, { title: "Một" }), post("b", H, { title: "Hai" })]} onRead={onRead} onClose={onClose} />);
    expect(screen.getByText("Một")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp →" }));
    expect(screen.getByText("Hai")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đã đọc" }));
    expect(onClose).toHaveBeenCalled();
    expect(onRead).not.toHaveBeenCalled();
  });
});
