"use client";

import { useEffect, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { parseMarkdown, type Inline } from "@/lib/game/news/markdown";
import { newsTime, type NewsFeed, type NewsPost } from "@/lib/game/news/news";
import { CHANGELOG_TITLE } from "@/lib/game/news/changelog";
import ChangelogModal from "@/components/game/news/ChangelogCarousel";

export type NewsTab = "posts" | "events";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.t === "bold" ? <strong key={i}>{n.v}</strong>
          : n.t === "link" ? (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-burgundy underline">{n.v}</a>
          ) : <span key={i}>{n.v}</span>,
      )}
    </>
  );
}

/** A post's body: the parsed markdown as elements (never HTML from the text). */
export function NewsBody({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {parseMarkdown(body).map((b, i) => {
        if (b.t === "h") {
          const cls = b.level === 1 ? "text-xl font-bold" : b.level === 2 ? "text-lg font-bold" : "font-bold";
          return <p key={i} role="heading" aria-level={b.level + 2} className={`font-playfair ${cls}`}><InlineNodes nodes={b.content} /></p>;
        }
        if (b.t === "ul" || b.t === "ol") {
          const items = b.items.map((it, j) => <li key={j}><InlineNodes nodes={it} /></li>);
          return b.t === "ul"
            ? <ul key={i} className="list-disc pl-5">{items}</ul>
            : <ol key={i} className="list-decimal pl-5">{items}</ol>;
        }
        return <p key={i}><InlineNodes nodes={b.content} /></p>;
      })}
    </div>
  );
}

function PostArticle({ post }: { post: NewsPost }) {
  return (
    <article className="border-b border-dashed border-ink/40 pb-3 last:border-b-0" data-testid="news-post">
      <h3 className="flex items-start gap-2 font-playfair text-xl font-bold leading-tight text-ink">
        <span aria-hidden="true">{post.emoji}</span>
        <span className="flex-1">{post.title}</span>
        {post.pinned && <span className="rounded-sm bg-burgundy px-1 text-xs font-normal text-parchment">📌 Ghim</span>}
      </h3>
      <p className="mb-1 text-xs opacity-70">
        {newsTime(post.createdAt)}{post.updatedAt && post.updatedAt !== post.createdAt ? ` · sửa ${newsTime(post.updatedAt)}` : ""}
      </p>
      <NewsBody body={post.body} />
    </article>
  );
}

/** Báo Làng (v18.11): the village paper. At the stand, two tabs — 📢 Thông báo (the dev blog) and 🗞️ Tin làng (the room's big
 *  events); as a popup, the fresh dev-blog posts one after another with "Tiếp →". */
export default function NewsModal({ feed, popup, onRead, onClose }: {
  feed: NewsFeed;
  /** Popup mode: these posts, oldest first. */
  popup?: readonly NewsPost[];
  /** A tab was shown (its unread marker moves to now). */
  onRead?: (tab: NewsTab) => void;
  onClose: () => void;
}) {
  const popupMode = popup !== undefined && popup.length > 0;
  const [tab, setTab] = useState<NewsTab>(() => (feed.unread.posts === 0 && feed.unread.events > 0 ? "events" : "posts"));
  const [at, setAt] = useState(0);
  const [bulletin, setBulletin] = useState(false);

  useEffect(() => {
    if (!popupMode) onRead?.(tab);
  }, [tab, popupMode, onRead]);

  const masthead = (
    <div className="mb-2 border-y-4 border-double border-ink/70 py-1 text-center">
      <p className="font-playfair text-3xl font-black tracking-wide text-ink">📰 BÁO LÀNG</p>
      <p className="text-xs uppercase tracking-widest opacity-70">Tin nhanh — chuẩn — của bà con trong làng</p>
    </div>
  );

  if (popupMode) {
    const post = popup[Math.min(at, popup.length - 1)];
    const last = at >= popup.length - 1;
    return (
      <ParchmentModal title="📢 Thông báo mới" onClose={onClose} className="sm:max-w-xl">
        <div className="flex flex-col gap-2 font-vt text-lg leading-snug" data-testid="news-popup">
          {masthead}
          <PostArticle post={post} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm opacity-70">{popup.length > 1 ? `${at + 1}/${popup.length}` : ""}</span>
            {last
              ? <button type="button" className="pch-btn" onClick={onClose}>Đã đọc</button>
              : <button type="button" className="pch-btn" onClick={() => setAt((i) => i + 1)}>Tiếp →</button>}
          </div>
        </div>
      </ParchmentModal>
    );
  }

  if (bulletin) return <ChangelogModal onClose={() => setBulletin(false)} />;

  const dot = (n: number) => (n > 0 ? <span className="ml-1 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" aria-label="chưa đọc" /> : null);
  return (
    <ParchmentModal title="📰 Báo Làng" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-snug">
        {masthead}
        <div role="tablist" className="flex gap-1">
          <button type="button" role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}
            className={`flex-1 rounded-sm border-2 px-2 py-0.5 ${tab === "posts" ? "border-ink bg-[#fff4d6]" : "border-ink/30"}`}>
            📢 Thông báo{tab !== "posts" && dot(feed.unread.posts)}
          </button>
          <button type="button" role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}
            className={`flex-1 rounded-sm border-2 px-2 py-0.5 ${tab === "events" ? "border-ink bg-[#fff4d6]" : "border-ink/30"}`}>
            🗞️ Tin làng{tab !== "events" && dot(feed.unread.events)}
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-ink/30 bg-[#f7ecd0] p-3" role="tabpanel">
          {tab === "posts" && (
            <button type="button" onClick={() => setBulletin(true)} data-testid="changelog-open"
              className="mb-3 flex w-full items-center gap-2 rounded-sm border-2 border-burgundy bg-[#fff4d6] px-2 py-1.5 text-left font-playfair text-lg font-bold text-ink hover:bg-[#ffeab0]">
              <span aria-hidden="true">📰</span>
              <span className="flex-1">{CHANGELOG_TITLE}</span>
              <span className="rounded-sm bg-burgundy px-1 text-xs font-normal text-parchment">📌 Ghim</span>
            </button>
          )}
          {tab === "posts" && (feed.posts.length === 0
            ? <p className="opacity-70">Chưa có thông báo nào.</p>
            : <div className="flex flex-col gap-3">{feed.posts.map((p) => <PostArticle key={p.id} post={p} />)}</div>)}
          {tab === "events" && (feed.events.length === 0
            ? <p className="opacity-70">Làng yên ả, chưa có tin gì lớn.</p>
            : (
              <ul className="flex flex-col gap-2" data-testid="news-events">
                {feed.events.map((e) => (
                  <li key={e.id} className="border-b border-dashed border-ink/30 pb-1.5 last:border-b-0">
                    <p className="text-xs opacity-70">{newsTime(e.createdAt)}</p>
                    <p>{e.text}</p>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </ParchmentModal>
  );
}
