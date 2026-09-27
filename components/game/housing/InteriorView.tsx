"use client";

import { useMemo } from "react";
import { paintRoom, ROOM_H, ROOM_W } from "@/lib/game/art/furniture";
import type { FishRow } from "@/lib/game/fishing/state";
import {
  APT_ENTRY, APT_WALL_ROWS, aptEnter, aptSetSurface, canPlace, errText, furnitureOf, furniturePickup, furniturePlace, homeSleep, interiorGrid,
  onDoorMat, type AptList, type Layout,
} from "@/lib/game/housing/apartment";
import type { MotelState } from "@/lib/game/housing/motel";
import type { Look } from "@/lib/game/types";
import InteriorStage, { type InteriorSpace } from "./InteriorStage";

interface InteriorViewProps {
  token: string;
  roomId: string;
  me: { id: string; name: string; look: Look };
  layout: Layout;
  /** My furniture storage and the knocks on my door (the owner's apartment list). */
  apt: AptList | null;
  bag: readonly FishRow[];
  speciesName: (id: string) => string;
  /** Items moved between storage and the room, or a surface changed: reload the apartment list. */
  onStorageChanged: () => void;
  onBagChanged: () => void;
  onAdmit: (accountId: string, accept: boolean) => void;
  onSlept: (s: MotelState) => void;
  /** The room's music is ducked while the TV plays. */
  onDuck: (on: boolean) => void;
  onLeave: (why?: string) => void;
}

/** The apartment as an interior (v19.2): a 14 × 10 room with a wall, the owner decorates, sleeps and uses the fridge,
 *  everyone inside watches the TV. */
export function aptSpace(token: string, roomId: string, no: number): InteriorSpace<Layout> {
  return {
    key: `apt:${no}`, w: ROOM_W, h: ROOM_H,
    title: (l) => `🏠 Căn ${l.no} · ${l.ownerName}`,
    entry: () => APT_ENTRY,
    grid: (l) => interiorGrid(l.items),
    paintShell: (c, l) => paintRoom(c, l.wall, l.floor),
    shellKey: (l) => `${l.wall}|${l.floor}`,
    gridTop: APT_WALL_ROWS,
    canDecorate: (l) => l.canEdit,
    canPlace: (l, p) => canPlace(l.items, p),
    mayPick: (l) => l.canEdit,
    mayUse: (l, p) => furnitureOf(p.item)?.kind === "tv" || l.canEdit,
    atDoor: (_l, pos) => onDoorMat(pos),
    errText,
    enter: () => aptEnter(token, roomId, no),
    place: (id, x, y, rot) => furniturePlace(token, id, x, y, rot),
    pickup: (id) => furniturePickup(token, id),
    surface: (kind, item) => aptSetSurface(token, item, kind),
    sleep: () => homeSleep(token, no),
    tvNo: no,
  };
}

/** 🏠 A walkable apartment (v19.2, spec R1–R3) on the shared interior stage, with the knocks on the owner's door. */
export default function InteriorView(props: InteriorViewProps) {
  const { token, roomId, layout, apt } = props;
  const no = layout.no;
  const space = useMemo(() => aptSpace(token, roomId, no), [token, roomId, no]);
  const knocks = layout.canEdit ? apt?.knocks ?? [] : [];
  const banner = knocks.map((k) => (
    <div key={k.accountId} className="pch flex flex-wrap items-center gap-2 px-2 py-1 text-base" role="status">
      ✊ <b>{k.name}</b> đang gõ cửa
      <button type="button" className="pch-btn pch-btn-primary px-2 py-0.5" onClick={() => props.onAdmit(k.accountId, true)}>Mở cửa</button>
      <button type="button" className="pch-btn px-2 py-0.5" onClick={() => props.onAdmit(k.accountId, false)}>Từ chối</button>
    </div>
  ));
  return (
    <InteriorStage space={space} token={token} roomId={roomId} me={props.me} layout={layout} storage={apt?.storage ?? []}
      bag={props.bag} speciesName={props.speciesName} banner={banner} onStorageChanged={props.onStorageChanged}
      onBagChanged={props.onBagChanged} onSlept={props.onSlept} onDuck={props.onDuck} onLeave={props.onLeave} />
  );
}
