"use client";

import { useEffect, useState } from "react";
import { subscribeRoom, trackPresence, type RoomState } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { deriveRole, type RoleFlags } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";

export interface RoomView {
  loading: boolean; state: RoomState; onlineIds: string[];
  token: string; accountId: string; myMemberId: string | null;
  role: RoleFlags; kicked: boolean;
}
const EMPTY: RoomState = { room: null, members: [], queue: [] };

export function useRoom(code: string): RoomView {
  const { account, token, lobby } = useAuth();
  const [state, setState] = useState<RoomState>(EMPTY);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const accountId = account?.accountId ?? "";

  useEffect(() => {
    let unsubRoom: (() => void) | undefined;
    let unsubPresence: (() => void) | undefined;
    let active = true;
    (async () => {
      const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!active) return;
      if (!data) { setLoading(false); return; }
      const roomId = data.id as string;
      lobby?.setRoomId(roomId);
      unsubRoom = subscribeRoom(roomId, (s) => { setState(s); setLoading(false); });
      if (account) unsubPresence = trackPresence(roomId, { memberId: account.accountId, name: account.username }, setOnlineIds);
    })();
    return () => { active = false; unsubRoom?.(); unsubPresence?.(); lobby?.setRoomId(null); };
  }, [code, accountId, account, lobby]);

  const myMemberId = state.members.find((m) => m.account_id === accountId)?.id ?? null;
  const role = state.room ? deriveRole(state.room, myMemberId)
    : { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };
  const kicked = !!accountId && !!state.room && state.members.length > 0 && !state.members.some((m) => m.account_id === accountId);

  return { loading, state, onlineIds, token: token ?? "", accountId, myMemberId, role, kicked };
}
