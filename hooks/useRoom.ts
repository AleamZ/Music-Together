"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapId } from "@/lib/game/maps/types";
import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";
import type { PresenceDog, PresenceEntry, PresenceMode } from "@/lib/presence-modes";
import { supabase } from "@/lib/supabase";
import { deriveRole, type RoleFlags } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";
import { readStoredMode } from "@/hooks/useViewMode";

export interface RoomView {
  loading: boolean; state: RoomState; onlineIds: string[];
  presence: PresenceEntry[]; setPresenceMode: (m: PresenceMode) => void;
  /** The game map I am on (published with the mode; shared presence budget). */
  setPresenceMap: (m: MapId) => void;
  /** My dog (v17 §7.3; published with the mode and the map, in game mode only; shared presence budget). */
  setPresenceDog: (d: PresenceDog | null) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
  role: RoleFlags; kicked: boolean;
}
const EMPTY: RoomState = { room: null, members: [], queue: [] };

export function useRoom(code: string): RoomView {
  const { account, token, lobby } = useAuth();
  const [state, setState] = useState<RoomState>(EMPTY);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const presenceRef = useRef<PresenceHandle | null>(null);
  const modeRef = useRef<PresenceMode | null>(null);
  const setPresenceMode = useCallback((m: PresenceMode) => {
    modeRef.current = m;
    presenceRef.current?.setMode(m);
  }, []);
  const mapRef = useRef<MapId>("hall");
  const setPresenceMap = useCallback((m: MapId) => {
    mapRef.current = m;
    presenceRef.current?.setMap(m);
  }, []);
  const dogRef = useRef<PresenceDog | null>(null);
  const setPresenceDog = useCallback((d: PresenceDog | null) => {
    dogRef.current = d;
    presenceRef.current?.setDog(d);
  }, []);
  const [loading, setLoading] = useState(true);
  // Latches true once we've ever been a member of THIS room, so a brand-new
  // visitor (not yet a member) is NOT shown the "kicked" screen.
  const [wasMember, setWasMember] = useState(false);
  const accountId = account?.accountId ?? "";

  // Reset the membership latch when switching to a different room.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setWasMember(false); }, [code]);

  useEffect(() => {
    let unsubRoom: (() => void) | undefined;
    let presenceHandle: PresenceHandle | undefined;
    let active = true;
    let enteredRoomId: string | null = null;
    (async () => {
      const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!active) return;
      if (!data) { setLoading(false); return; }
      const roomId = data.id as string;
      enteredRoomId = roomId;
      lobby?.setRoomId(roomId);
      unsubRoom = subscribeRoom(roomId, (s) => {
        setState(s);
        setLoading(false);
        // Latch membership in the (async) subscription callback — never during render.
        if (accountId && s.members.some((m) => m.account_id === accountId)) setWasMember(true);
      });
      if (account) {
        presenceHandle = trackPresence(roomId, {
          memberId: account.accountId, name: account.username, mode: modeRef.current ?? readStoredMode(), map: mapRef.current,
          dog: dogRef.current,
        }, setPresence);
        presenceRef.current = presenceHandle;
      }
    })();
    return () => {
      active = false;
      unsubRoom?.();
      presenceHandle?.unsubscribe();
      if (presenceRef.current === presenceHandle) presenceRef.current = null;
      // Only clear our lobby presence if this cleanup ran AFTER we actually
      // entered the room. A StrictMode/re-run cleanup that fires before the
      // async fetch resolved must NOT push room_id=null (that would clobber the
      // value the surviving effect run is about to set, hiding us from the lobby).
      if (enteredRoomId) lobby?.setRoomId(null);
    };
  }, [code, accountId, account, lobby]);

  const myMemberId = state.members.find((m) => m.account_id === accountId)?.id ?? null;
  const role = state.room ? deriveRole(state.room, myMemberId)
    : { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };
  // kicked only if we WERE a member and now aren't (never-joined users fall through to JoinGate).
  const kicked = wasMember && !!state.room && !myMemberId;

  const onlineIds = presence.map((p) => p.accountId);
  return {
    loading, state, onlineIds, presence, setPresenceMode, setPresenceMap, setPresenceDog, token: token ?? "", accountId,
    username: account?.username ?? "", myMemberId, role, kicked,
  };
}
