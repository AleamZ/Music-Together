"use client";

import { useMemo, useState } from "react";
import { assignDj, transferAdmin, kickMember, type Member, type Room } from "@/lib/supabase";

const AVATAR_PALETTES = [
  "from-amber-600 to-amber-800 text-amber-50",
  "from-emerald-700 to-teal-900 text-emerald-50",
  "from-burgundy to-rose-900 text-rose-50",
  "from-indigo-700 to-purple-900 text-indigo-50",
  "from-amber-700 to-orange-950 text-amber-50",
  "from-cyan-700 to-blue-900 text-cyan-50",
  "from-stone-600 to-stone-800 text-stone-50",
  "from-red-800 to-rose-950 text-rose-50",
];

function getAvatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

type FilterTab = "all" | "online";

export default function MemberList({
  members,
  room,
  onlineIds,
  isAdmin,
  token,
  myMemberId,
}: {
  members: Member[];
  room: Room;
  onlineIds: string[];
  isAdmin: boolean;
  token: string;
  myMemberId: string | null;
}) {
  const online = useMemo(() => new Set(onlineIds), [onlineIds]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const roomId = room.id;

  // Split and sort members: Online first, then offline
  const { onlineMembers, offlineMembers, totalOnline } = useMemo(() => {
    const onList: Member[] = [];
    const offList: Member[] = [];

    for (const m of members) {
      if (online.has(m.account_id)) {
        onList.push(m);
      } else {
        offList.push(m);
      }
    }

    const sortFn = (a: Member, b: Member) => {
      // Current user first
      if (a.id === myMemberId) return -1;
      if (b.id === myMemberId) return 1;

      // Admin / Host second
      if (room.admin_member_id === a.id) return -1;
      if (room.admin_member_id === b.id) return 1;

      // DJ third
      if (room.dj_member_id === a.id) return -1;
      if (room.dj_member_id === b.id) return 1;

      // Alphabetical by username
      return (a.username ?? "").localeCompare(b.username ?? "");
    };

    onList.sort(sortFn);
    offList.sort(sortFn);

    return {
      onlineMembers: onList,
      offlineMembers: offList,
      totalOnline: onList.length,
    };
  }, [members, online, myMemberId, room.admin_member_id, room.dj_member_id]);

  // Filter by search query
  const filterByQuery = (list: Member[]) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => (m.username ?? "").toLowerCase().includes(q));
  };

  const filteredOnline = filterByQuery(onlineMembers);
  const filteredOffline = filterByQuery(offlineMembers);

  const displayedList =
    activeTab === "online"
      ? filteredOnline
      : [...filteredOnline, ...filteredOffline];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header bar: Title & Online counter */}
      <div className="shrink-0 flex items-center justify-between gap-2 pb-2.5 pt-0.5 border-b border-gold-200/70">
        <div className="flex items-center gap-1.5">
          <span className="text-base text-burgundy">👥</span>
          <h3 className="font-playfair text-sm sm:text-base font-bold text-burgundy tracking-tight">
            Thành viên
          </h3>
        </div>

        {/* Live Online Badge */}
        <div
          className="flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50/90 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 shadow-2xs"
          title={`${totalOnline} thành viên đang trực tuyến trong tổng số ${members.length}`}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
          </span>
          <span>
            <b>{totalOnline}</b>
            <span className="text-emerald-700/60 font-normal"> / {members.length} online</span>
          </span>
        </div>
      </div>

      {/* Toolbar: Filter Tabs & Quick Search */}
      <div className="shrink-0 pt-2 pb-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5">
          {/* Tab buttons */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-gold-200/30 border border-gold-200/50 text-[11px]">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`rounded-md px-2 py-0.5 font-medium transition-all ${
                activeTab === "all"
                  ? "bg-burgundy text-cream shadow-2xs font-semibold"
                  : "text-ink/70 hover:text-burgundy hover:bg-cream/60"
              }`}
            >
              Tất cả ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("online")}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-all ${
                activeTab === "online"
                  ? "bg-burgundy text-cream shadow-2xs font-semibold"
                  : "text-ink/70 hover:text-burgundy hover:bg-cream/60"
              }`}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Online ({totalOnline})</span>
            </button>
          </div>
        </div>

        {/* Search input (when there are multiple members) */}
        {members.length >= 6 && (
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink/40">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên..."
              className="w-full rounded-lg border border-gold-200/70 bg-cream/70 pl-7 pr-6 py-1 text-xs text-ink placeholder:text-ink/40 outline-none transition-all focus:border-burgundy focus:bg-cream focus:ring-1 focus:ring-burgundy/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink/40 hover:text-burgundy"
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Member Cards List */}
      <ul className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-1 divide-y divide-gold-200/30">
        {displayedList.length === 0 ? (
          <li className="pt-8 pb-4 text-center text-xs text-ink/50 flex flex-col items-center gap-1.5">
            <span className="text-xl">👤</span>
            <p>Không tìm thấy thành viên nào</p>
          </li>
        ) : (
          displayedList.map((m) => {
            const isOnline = online.has(m.account_id);
            const isDj = room.dj_member_id === m.id;
            const isAdminMember = room.admin_member_id === m.id;
            const isMe = m.id === myMemberId;
            const canManage = isAdmin && !isMe;
            const username = m.username ?? "Khách";
            const palette = getAvatarPalette(username);

            return (
              <li
                key={m.id}
                className={`group relative flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-all duration-150 ${
                  isMe
                    ? "bg-gold-200/25 border border-gold-300/60 shadow-2xs"
                    : isOnline
                    ? "hover:bg-cream/90 hover:shadow-2xs border border-transparent hover:border-gold-200/60"
                    : "opacity-65 hover:opacity-100 hover:bg-cream/60 border border-transparent"
                }`}
              >
                {/* Avatar with Status indicator */}
                <div className="relative shrink-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-2xs bg-gradient-to-br ${palette} ${
                      isAdminMember
                        ? "ring-2 ring-gold"
                        : isDj
                        ? "ring-2 ring-emerald-500/80"
                        : ""
                    }`}
                    title={username}
                  >
                    {username ? username.charAt(0).toUpperCase() : "?"}
                  </div>

                  {/* Status Dot */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-cream ${
                      isOnline
                        ? "h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                        : "h-2 w-2 bg-gold-400/80"
                    }`}
                    title={isOnline ? "Trực tuyến" : "Ngoại tuyến"}
                  />
                </div>

                {/* Name, Badges & Subtitle */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`truncate text-xs font-semibold ${
                        isMe ? "text-burgundy font-bold" : "text-ink"
                      }`}
                      title={username}
                    >
                      {username}
                    </span>

                    {/* Self badge */}
                    {isMe && (
                      <span className="shrink-0 rounded bg-burgundy/15 px-1 py-0.2 text-[9px] font-bold text-burgundy">
                        Bạn
                      </span>
                    )}

                    {/* Admin / Host Badge */}
                    {isAdminMember && (
                      <span
                        className="shrink-0 flex items-center gap-0.5 rounded-md bg-burgundy px-1.5 py-0.2 text-[9px] font-bold text-cream shadow-2xs"
                        title="Chủ phòng (Admin)"
                      >
                        👑 Host
                      </span>
                    )}

                    {/* DJ Badge */}
                    {isDj && (
                      <span
                        className="shrink-0 flex items-center gap-0.5 rounded-md bg-emerald-700 px-1.5 py-0.2 text-[9px] font-bold text-cream shadow-2xs"
                        title="DJ phòng"
                      >
                        🎧 DJ
                      </span>
                    )}
                  </div>

                  {/* Subtitle status */}
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-tight">
                    {isOnline ? (
                      <span className="text-emerald-700 font-medium">Trực tuyến</span>
                    ) : (
                      <span className="text-ink/40">Ngoại tuyến</span>
                    )}
                  </div>
                </div>

                {/* Admin Management Menu */}
                {canManage && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      aria-label={`Quản lý ${username}`}
                      title="Quản lý thành viên"
                      onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-ink/50 transition-all hover:border-gold-200 hover:bg-cream hover:text-burgundy active:scale-95 group-hover:border-gold-200/60"
                    >
                      ⋯
                    </button>

                    {openId === m.id && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setOpenId(null)}
                        />
                        <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-xl border border-gold bg-cream/95 text-xs shadow-xl backdrop-blur-md divide-y divide-gold-200/40 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              assignDj(roomId, token, isDj ? null : m.id).catch(() => {});
                              setOpenId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-burgundy transition-colors hover:bg-gold-200/40"
                          >
                            <span>🎧</span>
                            <span>{isDj ? "Thu lại DJ" : "Giao quyền DJ"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Trao quyền Chủ phòng cho ${username}?`)) {
                                transferAdmin(roomId, token, m.id).catch(() => {});
                              }
                              setOpenId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-burgundy transition-colors hover:bg-gold-200/40"
                          >
                            <span>👑</span>
                            <span>Trao Chủ phòng</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Mời ${username} rời khỏi phòng?`)) {
                                kickMember(roomId, token, m.id).catch(() => {});
                              }
                              setOpenId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-burgundy-accent transition-colors hover:bg-red-50"
                          >
                            <span>🚫</span>
                            <span>Mời rời phòng</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
