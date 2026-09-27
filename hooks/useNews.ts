"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EMPTY_FEED, hasUnread, pickPopup, type NewsFeed, type NewsPost } from "@/lib/game/news/news";
import { newsFeed, newsMarkRead } from "@/lib/game/news/rpc";

/** How often the stand's feed is fetched again while the game is open. */
const POLL_MS = 60_000;

export interface NewsController {
  feed: NewsFeed;
  unread: boolean;
  /** Fresh dev-blog posts to pop up (the last 24 h, unseen, not popped up in this visit), oldest first. */
  popup: NewsPost[];
  refresh: () => void;
  /** A tab was read: its marker moves to now and its count drops at once. */
  markRead: (kind: "posts" | "events") => void;
  /** The popup was seen or closed: it does not come back, and the dev blog is marked read. */
  dismissPopup: () => void;
}

/** v18.11 Báo Làng: the feed of the room's news stand, its unread counts and the 24 h dev-blog popup. */
export function useNews(roomId: string, token: string | null): NewsController {
  const [feed, setFeed] = useState<NewsFeed>(EMPTY_FEED);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(() => {
    if (!token) return;
    newsFeed(roomId, token).then(setFeed).catch(() => {});
  }, [roomId, token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => {
      newsFeed(roomId, token).then((f) => { if (alive) setFeed(f); }).catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [roomId, token]);

  const markRead = useCallback((kind: "posts" | "events") => {
    if (!token) return;
    setFeed((f) => ({ ...f, unread: { ...f.unread, [kind]: 0 } }));
    newsMarkRead(roomId, token, kind).catch(() => {});
  }, [roomId, token]);

  const popup = useMemo(() => {
    const now = Date.parse(feed.serverNow);
    // the server's clock: no answer yet, nothing to pop up
    return Number.isFinite(now) ? pickPopup(feed.popup, { now, shown }) : [];
  }, [feed.popup, feed.serverNow, shown]);

  const dismissPopup = useCallback(() => {
    setShown((s) => new Set([...s, ...feed.popup.map((p) => p.id)]));
    markRead("posts");
  }, [feed.popup, markRead]);

  return { feed, unread: hasUnread(feed), popup, refresh, markRead, dismissPopup };
}
