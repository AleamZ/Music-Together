import { supabase, type QueueItem } from "@/lib/supabase";

export interface PlayHistoryItem {
  id: string;
  room_id: string;
  youtube_video_id: string;
  title: string;
  added_by_name: string;
  played_at: string;
}

export interface ContributorStat {
  name: string;
  playedCount: number;
  queuedCount: number;
  totalCount: number;
  percentage: number;
  badge?: {
    rank: number;
    title: string;
    icon: string;
  };
}

export interface TopTrackStat {
  videoId: string;
  title: string;
  playCount: number;
  lastAddedBy: string;
  lastPlayedAt: string;
}

export interface ShuffleLuckStat {
  name: string;
  pickedCount: number;
  percentage: number;
}

/** Fetch recent play history for a room from Supabase */
export async function fetchPlayHistory(roomId: string, limit = 60): Promise<PlayHistoryItem[]> {
  const { data, error } = await supabase
    .from("play_history")
    .select("*")
    .eq("room_id", roomId)
    .order("played_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as PlayHistoryItem[];
}

const BADGES = [
  { rank: 1, title: "Bá Chủ Âm Nhạc", icon: "👑" },
  { rank: 2, title: "Chiến Thần Đóng Góp", icon: "🥈" },
  { rank: 3, title: "Gout Đỉnh Chóp", icon: "🥉" },
];

/**
 * Compute ranking of contributors based on songs played + currently in queue
 */
export function computeContributorRanking(
  history: PlayHistoryItem[],
  queue: QueueItem[] = [],
  currentItem?: QueueItem | null,
): ContributorStat[] {
  const map = new Map<string, { played: number; queued: number }>();

  for (const item of history) {
    const name = item.added_by_name?.trim() || "Ẩn danh";
    const cur = map.get(name) || { played: 0, queued: 0 };
    cur.played += 1;
    map.set(name, cur);
  }

  // Count items currently in queue (waiting to be played)
  for (const item of queue) {
    if (item.status === "approved") {
      const name = item.added_by_name?.trim() || "Ẩn danh";
      const cur = map.get(name) || { played: 0, queued: 0 };
      cur.queued += 1;
      map.set(name, cur);
    }
  }

  if (currentItem && !queue.some((q) => q.id === currentItem.id)) {
    const name = currentItem.added_by_name?.trim() || "Ẩn danh";
    const cur = map.get(name) || { played: 0, queued: 0 };
    cur.queued += 1;
    map.set(name, cur);
  }

  const totalPlayed = history.length;
  const list: ContributorStat[] = [];

  for (const [name, counts] of map.entries()) {
    const totalCount = counts.played + counts.queued;
    const percentage = totalPlayed > 0 ? Math.round((counts.played / totalPlayed) * 100) : 0;
    list.push({
      name,
      playedCount: counts.played,
      queuedCount: counts.queued,
      totalCount,
      percentage,
    });
  }

  // Sort primarily by played songs, secondarily by total added
  list.sort((a, b) => b.playedCount - a.playedCount || b.totalCount - a.totalCount);

  // Assign podium badges to top 3
  return list.map((item, idx) => {
    if (idx < BADGES.length && item.playedCount > 0) {
      return { ...item, badge: BADGES[idx] };
    }
    return item;
  });
}

/**
 * Compute top songs replayed most in the room
 */
export function computeTopTracks(history: PlayHistoryItem[]): TopTrackStat[] {
  const map = new Map<string, { title: string; count: number; lastAddedBy: string; lastPlayedAt: string }>();

  for (const item of history) {
    const key = item.youtube_video_id;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        title: item.title,
        count: 1,
        lastAddedBy: item.added_by_name,
        lastPlayedAt: item.played_at,
      });
    } else {
      cur.count += 1;
      if (new Date(item.played_at) > new Date(cur.lastPlayedAt)) {
        cur.lastPlayedAt = item.played_at;
        cur.lastAddedBy = item.added_by_name;
      }
    }
  }

  const list: TopTrackStat[] = [];
  for (const [videoId, data] of map.entries()) {
    list.push({
      videoId,
      title: data.title,
      playCount: data.count,
      lastAddedBy: data.lastAddedBy,
      lastPlayedAt: data.lastPlayedAt,
    });
  }

  return list.sort((a, b) => b.playCount - a.playCount);
}

/**
 * Compute shuffle luck stats (percentage of random picks belonging to each user)
 */
export function computeShuffleLuck(history: PlayHistoryItem[]): ShuffleLuckStat[] {
  const map = new Map<string, number>();

  for (const item of history) {
    const name = item.added_by_name?.trim() || "Ẩn danh";
    map.set(name, (map.get(name) || 0) + 1);
  }

  const total = history.length;
  const list: ShuffleLuckStat[] = [];

  for (const [name, count] of map.entries()) {
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    list.push({
      name,
      pickedCount: count,
      percentage,
    });
  }

  return list.sort((a, b) => b.pickedCount - a.pickedCount);
}

/** Format relative time in Vietnamese (e.g. 5 phút trước, 2 giờ trước) */
export function formatRelativeTime(isoString: string): string {
  const time = new Date(isoString).getTime();
  const diffMs = Date.now() - time;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return "vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "hôm qua";
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return new Date(isoString).toLocaleDateString("vi-VN");
}
