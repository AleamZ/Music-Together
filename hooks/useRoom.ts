"use client";

import { useEffect, useState } from "react";
import { subscribeRoom, trackPresence, type RoomState } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { deriveRole, type RoleFlags } from "@/lib/roles";
import { loadIdentity, type StoredIdentity } from "@/lib/identity";

export interface RoomView {
  loading: boolean;
  state: RoomState;
  onlineIds: string[];
  identity: StoredIdentity | null;
  role: RoleFlags;
  /** true once we know the room exists and we have a stored identity whose member is gone (kicked). */
  kicked: boolean;
}

const EMPTY: RoomState = { room: null, members: [], queue: [] };

export function useRoom(code: string, joinNonce = 0): RoomView {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [state, setState] = useState<RoomState>(EMPTY);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolve identity from localStorage on mount and whenever joinNonce bumps
  // (so a fresh join in JoinGate advances the UI past the gate). Client only.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setIdentity(loadIdentity(code)); }, [code, joinNonce]);

  // Look up the room id by code (needed for subscriptions) then subscribe.
  useEffect(() => {
    let unsubRoom: (() => void) | undefined;
    let unsubPresence: (() => void) | undefined;
    let active = true;

    (async () => {
      const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!active) return;
      if (!data) { setLoading(false); return; }
      const roomId = data.id as string;
      unsubRoom = subscribeRoom(roomId, (s) => { setState(s); setLoading(false); });
      const id = loadIdentity(code);
      if (id) unsubPresence = trackPresence(roomId, { memberId: id.memberId, name: "" }, setOnlineIds);
    })();

    return () => { active = false; unsubRoom?.(); unsubPresence?.(); };
  }, [code, identity?.memberId]);

  const role = state.room
    ? deriveRole(state.room, identity?.memberId ?? null)
    : { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };

  const kicked =
    !!identity && !!state.room && state.members.length > 0 &&
    !state.members.some((m) => m.id === identity.memberId);

  return { loading, state, onlineIds, identity, role, kicked };
}
