"use client";

import { useMemo } from "react";
import { INT_H, INT_W, paintHouseInterior } from "@/lib/game/art/house";
import type { FishRow } from "@/lib/game/fishing/state";
import { furnitureOf, type Placed } from "@/lib/game/housing/apartment";
import {
  canPlaceHouse, entryOf, houseEnter, houseErrText, houseGrid, housePickup, housePlace, houseSetSurface, houseSleep, LOT_COLS, LOT_TILE, onYard,
  roomsOf, type HouseLayout,
} from "@/lib/game/housing/house";
import type { MotelState } from "@/lib/game/housing/motel";
import type { Look } from "@/lib/game/types";
import InteriorStage, { type InteriorSpace } from "./InteriorStage";

/** The rooms I may furnish: a tenant their own; the owner every room without a tenant. */
export function allowedRooms(l: HouseLayout): number[] {
  if (l.myRoom !== null) return [l.myRoom];
  if (!l.canEdit) return [];
  const count = roomsOf(l.grid).count;
  const rented = new Set(l.rooms.filter((r) => r.tenantName !== null).map((r) => r.no));
  return Array.from({ length: count }, (_, i) => i + 1).filter((k) => !rented.has(k));
}

const roomOf = (l: HouseLayout, p: Placed): number => roomsOf(l.grid).cells[p.y * LOT_COLS + p.x] ?? 0;

/** A house as an interior (v19.3): the whole lot, walls and all. The owner furnishes the rooms that are not rented and
 *  sets the surfaces; a tenant furnishes and sleeps in their room; each moves only their own items. */
export function houseSpace(token: string, roomId: string, lot: number, owner: boolean, tenant: boolean): InteriorSpace<HouseLayout> {
  const mine = (l: HouseLayout, p: Placed) => l.items.find((i) => i.id === p.id)?.mine === true;
  return {
    key: `house:${lot}`, w: INT_W, h: INT_H,
    title: (l) => `🏡 Nhà lô ${l.lot} · ${l.ownerName}${l.myRoom !== null ? ` · phòng ${l.myRoom} của bạn` : ""}`,
    entry: (l) => entryOf(l.grid),
    grid: (l) => houseGrid(l.grid, l.items),
    paintShell: (c, l) => paintHouseInterior(c, l.grid, l.wall, l.floor),
    shellKey: (l) => `${l.grid}|${l.wall}|${l.floor}`,
    gridTop: 0,
    decorShade: (c, l) => {
      const ok = new Set(allowedRooms(l));
      const { cells } = roomsOf(l.grid);
      c.save(); c.globalAlpha = 0.35; c.fillStyle = "#000";
      cells.forEach((k, i) => { if (!ok.has(k)) c.fillRect((i % LOT_COLS) * LOT_TILE, Math.floor(i / LOT_COLS) * LOT_TILE, LOT_TILE, LOT_TILE); });
      c.restore();
    },
    canDecorate: (l) => l.canEdit || l.myRoom !== null,
    canPlace: (l, p) => canPlaceHouse(l.grid, l.items, p, allowedRooms(l)),
    mayPick: (l, p) => mine(l, p) && allowedRooms(l).includes(roomOf(l, p)),
    mayUse: (l, p) => {
      const kind = furnitureOf(p.item)?.kind;
      if (kind === "bed") return allowedRooms(l).includes(roomOf(l, p));
      if (kind === "fridge") return mine(l, p);
      return false;                                    // the TV plays in apartments only (v19.3)
    },
    atDoor: (l, pos) => onYard(l.grid, pos),
    errText: houseErrText,
    enter: () => houseEnter(token, roomId, lot),
    place: (id, x, y, rot) => housePlace(token, lot, id, x, y, rot),
    pickup: (id) => housePickup(token, lot, id),
    surface: owner ? (kind, item) => houseSetSurface(token, kind, item) : null,
    sleep: owner || tenant ? () => houseSleep(token, lot) : null,
    tvNo: null,
  };
}

interface HouseViewProps {
  token: string;
  roomId: string;
  me: { id: string; name: string; look: Look };
  layout: HouseLayout;
  storage: ReadonlyArray<{ id: number; item: string }>;
  bag: readonly FishRow[];
  speciesName: (id: string) => string;
  onStorageChanged: () => void;
  onBagChanged: () => void;
  onSlept: (s: MotelState) => void;
  onDuck: (on: boolean) => void;
  onLeave: (why?: string) => void;
}

/** 🏡 A walkable house (v19.3) on the shared interior stage. */
export default function HouseView(props: HouseViewProps) {
  const { token, roomId, layout } = props;
  const owner = layout.canEdit, tenant = layout.myRoom !== null;
  const space = useMemo(() => houseSpace(token, roomId, layout.lot, owner, tenant), [token, roomId, layout.lot, owner, tenant]);
  return (
    <InteriorStage space={space} token={token} roomId={roomId} me={props.me} layout={layout} storage={props.storage}
      bag={props.bag} speciesName={props.speciesName} onStorageChanged={props.onStorageChanged}
      onBagChanged={props.onBagChanged} onSlept={props.onSlept} onDuck={props.onDuck} onLeave={props.onLeave} />
  );
}
