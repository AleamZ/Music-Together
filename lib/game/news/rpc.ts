// v18.11 Báo Làng: the RPCs of 0032_news.sql. Posts and events are written only by the server and root.
import { supabase } from "@/lib/supabase";
import { parseFeed, parsePost, parsePosts, type NewsFeed, type NewsPost } from "./news";

export async function newsFeed(roomId: string, token: string): Promise<NewsFeed> {
  const { data, error } = await supabase.rpc("news_feed", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
  return parseFeed(data);
}

export async function newsMarkRead(roomId: string, token: string, kind: "posts" | "events" | "all"): Promise<void> {
  const { error } = await supabase.rpc("news_mark_read", { p_room_id: roomId, p_session_token: token, p_kind: kind });
  if (error) throw error;
}

export async function newsAdminList(token: string): Promise<NewsPost[]> {
  const { data, error } = await supabase.rpc("news_admin_list", { p_session_token: token });
  if (error) throw error;
  return parsePosts(data);
}

export interface NewsPostInput { id: string | null; title: string; emoji: string; body: string; pinned: boolean }

export async function newsPostUpsert(token: string, p: NewsPostInput): Promise<NewsPost | null> {
  const { data, error } = await supabase.rpc("news_post_upsert", {
    p_session_token: token, p_id: p.id, p_title: p.title, p_emoji: p.emoji, p_body: p.body, p_pinned: p.pinned,
  });
  if (error) throw error;
  return parsePost(data);
}

export async function newsPostDelete(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("news_post_delete", { p_session_token: token, p_id: id });
  if (error) throw error;
}
