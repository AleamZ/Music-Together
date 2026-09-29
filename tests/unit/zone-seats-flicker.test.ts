import { describe, expect, it } from "vitest";
import { separateCoplanar } from "@/lib/game/diorama/zones/coplanar";
import { hallLayout } from "@/lib/game/diorama/zones/hall";
import { khuNhaLayout } from "@/lib/game/diorama/zones/khu_nha";
import { COPLANAR_SEP, type Box, type ZoneLayout } from "@/lib/game/diorama/zones/kit";
import { marketLayout } from "@/lib/game/diorama/zones/market";
import { CARD_MAX, CARD_TABLES, cardSeatMap, HAMMOCK_SEAT, hallSeat, SEAT_REACH, seatAnchors, seatLift, seatPeople } from "@/lib/game/diorama/zones/seats";
import { packAtlas, rasterSign, signSize } from "@/lib/game/diorama/zones/signart";
import type { Billboard } from "@/lib/game/diorama/types";
import type { CardGame } from "@/lib/game/cards/deck";
import { HALL_SEATS } from "@/lib/game/maps/hall";
import { getMap } from "@/lib/game/maps/registry";
import { zoneRect } from "@/lib/game/world/zones";

const LOOK = {} as Billboard["look"];
const person = (id: string, x: number, y: number, extra: Partial<Billboard> = {}): Billboard => ({ id, look: LOOK, x, y, facing: "down", frame: 0, name: id, ...extra });

describe("coplanar faces are pushed apart (no z-fighting)", () => {
  it("a trim strip flush with a wall moves out past it", () => {
    const wall = { x: 0, y: 0, z: 0, w: 100, d: 20, h: 50 };
    const trim = { x: 0, y: 18, z: 40, w: 100, d: 2, h: 3 };              // flush south, flush east and west
    expect(separateCoplanar([wall, trim], 0.35, 32)).toBeGreaterThan(0);
    expect(trim.y + trim.d).toBeCloseTo(20.35);
    expect(trim.x).toBeCloseTo(-0.35);
    expect(trim.x + trim.w).toBeCloseTo(100.35);
    expect(wall).toEqual({ x: 0, y: 0, z: 0, w: 100, d: 20, h: 50 });
  });

  it("a plank line lying on a deck gets a real gap; boxes merely touching are left alone", () => {
    const deck = { x: 0, y: 0, z: 0, w: 50, d: 50, h: 3 };
    const plank = { x: 0, y: 10, z: 3, w: 50, d: 0.5, h: 0.2 };
    separateCoplanar([deck, plank], 0.35, 32);
    expect(plank.z + plank.h - 3).toBeGreaterThanOrEqual(0.35 - 1e-9);
    const a = { x: 0, y: 0, z: 0, w: 10, d: 10, h: 10 }, b = { x: 10, y: 0, z: 0, w: 10, d: 10, h: 10 };
    expect(separateCoplanar([a, b], 0.35, 32)).toBe(0);
  });

  const same = (a: Box, b: Box, axis: "x" | "y" | "z", side: 0 | 1) => {
    const lo = (q: Box) => (axis === "x" ? q.x : axis === "y" ? q.y : q.z0), ln = (q: Box) => (axis === "x" ? q.w : axis === "y" ? q.d : q.h);
    return Math.abs((side ? lo(a) + ln(a) : lo(a)) - (side ? lo(b) + ln(b) : lo(b))) < COPLANAR_SEP - 1e-6;
  };
  const overlap = (a: Box, b: Box, axis: "x" | "y" | "z") => {
    const r = (q: Box) => ({ x: [q.x, q.x + q.w], y: [q.y, q.y + q.d], z: [q.z0, q.z0 + q.h] });
    const A = r(a), B = r(b);
    return (["x", "y", "z"] as const).filter((o) => o !== axis).every((o) => Math.min(A[o][1], B[o][1]) - Math.max(A[o][0], B[o][0]) > 1e-6);
  };
  it.each([["hall", hallLayout], ["market", marketLayout], ["khu_nha", khuNhaLayout]] as const)("%s: no two overlapping box faces share a plane", (id, layout) => {
    const L: ZoneLayout = layout(getMap(id));
    const bad: string[] = [];
    const B = L.boxes;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (a.x > b.x + b.w + 1 || b.x > a.x + a.w + 1 || a.y > b.y + b.d + 1 || b.y > a.y + a.d + 1) continue;
      for (const axis of ["x", "y", "z"] as const) for (const side of [0, 1] as const) if (overlap(a, b, axis) && same(a, b, axis, side)) bad.push(`${axis}${side} ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe("painted signs", () => {
  it("rasterise Vietnamese capitals with their marks and pack into one atlas", () => {
    const a = rasterSign({ lines: ["QUẦY NƯỚC"], icon: "cup", bg: 0xeadcb8, fg: 0x9a2a2a });
    expect(a.w).toBe(signSize({ lines: ["QUẦY NƯỚC"], icon: "cup", bg: 0, fg: 0 }).w);
    const ink = (r: typeof a) => { let n = 0; for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i] === 0x9a && r.rgba[i + 1] === 0x2a) n++; return n; };
    const plain = rasterSign({ lines: ["QUAY NUOC"], icon: "cup", bg: 0xeadcb8, fg: 0x9a2a2a });
    expect(ink(a)).toBeGreaterThan(ink(plain));                           // the circumflex, the acute, the horns
    const atlas = packAtlas([a, plain, a]);
    expect(atlas.uv).toHaveLength(3);
    expect(atlas.data.length).toBe(atlas.width * atlas.height * 4);
    for (const u of atlas.uv) { expect(u.u1).toBeGreaterThan(u.u0); expect(u.v1).toBeGreaterThan(u.v0); expect(u.v1).toBeLessThanOrEqual(1); }
  });

  it("every zone paints named signs (not blank slabs)", () => {
    for (const [id, layout] of [["hall", hallLayout], ["market", marketLayout], ["khu_nha", khuNhaLayout]] as const) {
      const L = layout(getMap(id));
      expect(L.signs.length).toBeGreaterThan(3);
      expect(L.signs.filter((s) => s.art.lines.join("").length > 0).length).toBeGreaterThan(2);
    }
    const hall = hallLayout(getMap("hall"));
    const words = hall.signs.flatMap((s) => s.art.lines).join("|");
    for (const w of ["RA ĐỒNG", "CHỢ LỚN", "BẢN ĐỒ", "BÁO LÀNG", "QUẦY NƯỚC", "DJ"]) expect(words).toContain(w);
  });
});

describe("real seats", () => {
  const anchors = seatAnchors("hall");

  it("one seat per place at every card table, facing the table", () => {
    for (const g of Object.keys(CARD_MAX) as CardGame[]) {
      const seats = anchors.filter((a) => a.key.startsWith(`cards_${g}:`));
      expect(seats).toHaveLength(CARD_MAX[g]);
      expect(seats.map((s) => s.key)).toEqual(Array.from({ length: CARD_MAX[g] }, (_, i) => `cards_${g}:${i + 1}`));
      const t = CARD_TABLES[g];
      for (const s of seats) {
        const toTable = Math.atan2(t.x - s.x, t.y - s.y);
        expect(Math.abs(Math.atan2(Math.sin(s.yaw - toTable), Math.cos(s.yaw - toTable)))).toBeLessThan(1e-9);
        expect(seatLift(s)).toBeGreaterThan(-0.2);
        expect(seatLift(s)).toBeLessThan(0.4);
      }
    }
    expect(anchors.filter((a) => a.key.startsWith("cafe:"))).toHaveLength(HALL_SEATS.length);
  });

  it("the hall builds a chair/stool/cushion under every anchor", () => {
    const L = hallLayout(getMap("hall"));
    expect(L.seats.map((s) => s.key).sort()).toEqual(anchors.map((a) => a.key).sort());
    for (const s of L.seats) {
      if (s.kind === "hammock") continue;
      const under = [...L.cyls.map((c) => ({ x: c.x, y: c.y, top: c.z0 + c.h })), ...L.boxes.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.d / 2, top: b.z0 + b.h }))]
        .filter((p) => Math.hypot(p.x - s.x, p.y - s.y) < 1.5 && Math.abs(p.top - s.top) < 0.6);
      expect(under.length, s.key).toBeGreaterThan(0);
    }
  });

  it("card players snap to their seat with the sit pose (me and the others); walking away stands them up", () => {
    const cards = cardSeatMap([{ game: "poker", seat: 3, id: "me" }, { game: "tienlen", seat: 1, id: "ann" }, { game: "xidach", seat: 8, id: "far" }, { game: "cao", seat: 99, id: "bad" }]);
    expect(cards.has("bad")).toBe(false);
    const p3 = hallSeat("cards_poker:3")!, t1 = hallSeat("cards_tienlen:1")!, x8 = hallSeat("cards_xidach:8")!;
    const out = seatPeople([
      person("me", p3.x + 20, p3.y - 10, { me: true }), person("ann", t1.x, t1.y + 30), person("far", x8.x + SEAT_REACH + 50, x8.y), person("bob", 400, 250),
    ], { cards, hammock: new Set(), origin: { x: 0, y: 0 } });
    expect(out[0]).toMatchObject({ x: p3.x, y: p3.y, act: "sit", yaw: p3.yaw, lift: seatLift(p3) });
    expect(out[1]).toMatchObject({ x: t1.x, y: t1.y, act: "sit" });
    expect(out[2].act).toBeUndefined();                                // walked off: drawn walking where they are
    expect(out[3]).toEqual(person("bob", 400, 250));
  });

  it("works in world px (the hall zone's corner) and seats the hammock and the café chairs", () => {
    const o = zoneRect("hall")!;
    const cafe = hallSeat("cafe:2")!;
    const out = seatPeople([person("h", o.ox + 128, o.oy + 212, { act: "sit" }), person("c", o.ox + cafe.x, o.oy + cafe.y, { act: "sit" })],
      { cards: new Map(), hammock: new Set(["h"]), origin: { x: o.ox, y: o.oy } });
    expect(out[0]).toMatchObject({ x: o.ox + HAMMOCK_SEAT.x, y: o.oy + HAMMOCK_SEAT.y, act: "sit", lift: seatLift(HAMMOCK_SEAT) });
    expect(out[1]).toMatchObject({ x: o.ox + cafe.x, y: o.oy + cafe.y, yaw: 0, lift: seatLift(cafe) });
  });
});
