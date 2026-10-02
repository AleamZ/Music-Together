import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import GroundbaitHud from "@/components/game/fishing/GroundbaitHud";
import { bubbleRing, rgba } from "@/lib/game/art/groundbait";
import { GROUNDBAIT_MINUTES, GROUNDBAIT_RADIUS_PX, GROUNDBAIT_WEIGHT } from "@/lib/game/fishing/gear";
import {
  GROUNDBAIT_CAP_MINUTES, GROUNDBAIT_MAX_STACKS, GROUNDBAIT_PLAYER_LIMIT, GROUNDBAIT_ROOM_LIMIT, leftText, liveSpots,
  parseGroundbaitSpots, spotAt, spotHudText, spotLabel, spotLabel3d, spotName, spotPoint, tintHex, tintOf, type GroundbaitSpotView,
} from "@/lib/game/fishing/groundbait-spots";
import { fetchGroundbaitSpots, fishingErrorMessage } from "@/lib/game/fishing/rpc";
import { liveFromFrame } from "@/lib/game/diorama/world/live-plan";
import { ZONES } from "@/lib/game/world/zones";

afterEach(cleanup);
beforeEach(() => h.rpc.mockReset());

// 0117_groundbait_spots.sql (ổ thính): every re-created function is its newest earlier body plus the lines marked
// "-- 0117" (the convention of anticheat-v2-part3.test.ts and fishing-v3.test.tsx), and the TS mirrors its numbers.
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0117_groundbait_spots.sql");
const EARLIER = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f.slice(0, 4) < "0117")
  .sort((a, b) => {
    const k = (f: string) => (f.slice(0, 4) === "0013" ? 14.5 : Number(f.slice(0, 4)));
    return k(a) - k(b) || a.localeCompare(b);
  });
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
const newest = (sig: string): [string, string] => {
  const f = [...EARLIER].reverse().find((x) => read(`supabase/migrations/${x}`).includes(`create or replace function public.${sig}`));
  expect(f, sig).toBeDefined();
  return [f!, body(read(`supabase/migrations/${f}`), sig)];
};
const unmarked = (b: string, tag: string) => {
  const out: string[] = [];
  let skip = false;
  for (const l of b.split("\n")) {
    if (l.includes(`-- ${tag} {`)) { skip = true; continue; }
    if (l.includes(`-- ${tag} }`)) { skip = false; continue; }
    if (skip) continue;
    const was = l.indexOf(`-- ${tag} was: `);
    if (was >= 0) out.push(`${l.match(/^\s*/)![0]}${l.slice(was + `-- ${tag} was: `.length)}`);
    else if (!l.includes(`-- ${tag}`)) out.push(l);
  }
  return out.join("\n");
};

describe("0117: the re-created functions are their newest bodies plus the 0117 lines", () => {
  const cases: Array<[string, string]> = [
    ["start_cast(", "0110_fishing_v3.sql"],
    ["start_river_cast(", "0110_fishing_v3.sql"],
    ["start_river_cast_w(", "0110_fishing_v3.sql"],
    ["net_haul(p_session_token text, p_throw_id uuid, p_press integer", "0110_fishing_v3.sql"],
    ["_fishing_state(", "0115_rod_builds.sql"],
  ];
  for (const [sig, from] of cases) {
    it(sig.slice(0, sig.indexOf("(")), () => {
      const [f, prev] = newest(sig);
      expect(f).toBe(from);
      expect(unmarked(body(SQL, sig), "0117")).toBe(prev);
      expect(body(SQL, sig)).toContain("-- 0117");
    });
  }
  it("every caller asks for the room's spot (the 5-argument _groundbait_at), none the 0110 per-account one", () => {
    for (const [sig] of cases.slice(0, 3)) expect(body(SQL, sig)).toMatch(/public\._groundbait_at\(v_account, '[a-z_]+', [^;]+, p_room_id\);/);
    expect(body(SQL, cases[3][0])).toContain("public._groundbait_at(v_account, 'pond', t.x, t.y, t.room_id);");
    expect(body(SQL, "_fishing_state(")).toContain("from public.groundbait_spots g where g.thrown_by = p_account");
  });
});

describe("0117: the rules, mirrored in TS", () => {
  it("radius, minutes, cap, stacks and limits", () => {
    const at = body(SQL, "_groundbait_at(p_account uuid, p_map text, p_x integer, p_y integer, p_room uuid)");
    expect(at).toContain(`<= ${GROUNDBAIT_RADIUS_PX} * ${GROUNDBAIT_RADIUS_PX}`);
    expect(at).toContain("where g.room_id = p_room and g.map = p_map and g.expires_at > now()");
    expect(at).not.toContain("account_id");                                   // anyone in the room
    const t = body(SQL, "throw_groundbait(");
    expect(t).toContain(`v_until := now() + interval '${GROUNDBAIT_MINUTES} minutes';`);
    expect(t).toContain(`least(now() + interval '${GROUNDBAIT_CAP_MINUTES} minutes', greatest(g.expires_at, now()) + interval '${GROUNDBAIT_MINUTES} minutes')`);
    expect(t).toContain(`stacks = least(${GROUNDBAIT_MAX_STACKS}, stacks + 1)`);
    expect(t).toContain(`and expires_at > now()) >= ${GROUNDBAIT_ROOM_LIMIT} then`);
    expect(t).toContain(`where thrown_by = v_account and expires_at > now()) >= ${GROUNDBAIT_PLAYER_LIMIT} then`);
    expect(t).toContain("limit 1 for update;");
    expect(t).toContain("public._pos_claim(v_account, p_map, v_x, v_y, 'throw_groundbait', p_room_id, 'too far')");
    // nothing spent before every refusal
    expect(t.indexOf("update public.inventory set qty = qty - 1")).toBeGreaterThan(t.indexOf("raise exception 'spot limit'"));
  });
  it("the table is private, the helper too, the read RPC guarded", () => {
    expect(SQL).toContain("revoke all on public.groundbait_spots from anon, authenticated;");
    expect(SQL).toContain("revoke all on function public._groundbait_at(uuid, text, integer, integer, uuid) from public, anon, authenticated;");
    expect(body(SQL, "groundbait_spots(")).toContain("public._ac_account(p_session_token)");
    expect(body(SQL, "groundbait_spots(")).toContain("perform public._auth(p_room_id, p_session_token, 'any');");
    expect(read("tests/sql/anticheat-guards.sql")).toContain("public.groundbait_spots(");
  });
});

const RAW = [
  { id: 7, item: "gb_cam", name: "Thính cám gạo", map: "pond", x: 300, y: 204, stacks: 2, until: "2026-10-01T10:10:00Z", left_ms: 432_000, by: "Lan", mine: false },
  { id: 8, item: "gb_tanh", name: "Thính tanh", map: "wild", x: 424, y: 1900, stacks: 1, until: "x", left_ms: 60_000, by: null, mine: true },
  { id: 9, item: "gb_tom", map: "moon", x: 1, y: 1, left_ms: 5000 },
  { id: 10, item: "gb_tom", name: "Thính tôm khô", map: "song_cai", x: 500, y: 200, stacks: 9, left_ms: 0 },
  null,
];
const NOW = 1_000_000;

describe("parsing and words", () => {
  it("keeps the good, live rows; time from the server's left_ms; stacks clamped", () => {
    const s = parseGroundbaitSpots(RAW, NOW);
    expect(s.map((x) => x.id)).toEqual([7, 8]);
    expect(s[0]).toEqual({ id: 7, item: "gb_cam", name: "Thính cám gạo", map: "pond", x: 300, y: 204, stacks: 2, untilMs: NOW + 432_000, by: "Lan", mine: false });
    expect(parseGroundbaitSpots("nope", NOW)).toEqual([]);
    expect(liveSpots(s, NOW + 61_000).map((x) => x.id)).toEqual([7]);
  });
  it("the label, the 3D label and the HUD line", () => {
    const [cam, tanh] = parseGroundbaitSpots(RAW, NOW);
    expect(leftText(432_000)).toBe("7:12");
    expect(leftText(-5)).toBe("0:00");
    expect(spotName("Thính cám gạo")).toBe("Ổ thính cám gạo");
    expect(spotLabel(cam, NOW)).toBe("Ổ thính cám gạo ×2 · còn 7:12 · của Lan");
    expect(spotLabel(tanh, NOW)).toBe("Ổ thính tanh · còn 1:00 · của bạn");
    expect(spotLabel3d(cam, NOW)).toBe("🌾 Ổ thính cám gạo · còn 8 phút · Lan");
    expect(spotHudText(cam, NOW + 1000)).toBe(`🌾 Đang câu trong ổ thính cám gạo · còn 7:11 (cá ưa thính này ×${GROUNDBAIT_WEIGHT} tỉ lệ)`);
    expect(tintOf("gb_tom")).toBe("#f08a5d");
    expect(tintHex("gb_tom")).toBe(0xf08a5d);
    expect(tintOf("unknown")).toBe("#e9d79a");
    expect(rgba("#f08a5d", 0.5)).toBe("rgba(240, 138, 93, 0.5)");
  });
  it("the refusals in Vietnamese", () => {
    expect(fishingErrorMessage({ message: "spot full" })).toContain(`${GROUNDBAIT_CAP_MINUTES} phút`);
    expect(fishingErrorMessage({ message: "too many spots" })).toContain(`${GROUNDBAIT_ROOM_LIMIT} ổ thính`);
    expect(fishingErrorMessage({ message: "spot limit" })).toContain(`${GROUNDBAIT_PLAYER_LIMIT} ổ thính`);
  });
  it("groundbait_spots is asked with the room and the token", async () => {
    h.rpc.mockResolvedValue({ data: RAW, error: null });
    const s = await fetchGroundbaitSpots("room", "tok");
    expect(h.rpc).toHaveBeenLastCalledWith("groundbait_spots", { p_room_id: "room", p_session_token: "tok" });
    expect(s.map((x) => x.id)).toEqual([7, 8]);
  });
});

describe("where a spot is drawn, and which one I stand in", () => {
  const [cam, tanh] = parseGroundbaitSpots(RAW, NOW);
  it("2D per map: only its own map, map px; the world: the zone's origin added, the wild as is (the 3D view's too)", () => {
    expect(spotPoint(cam, { world: false, mapId: "pond" })).toEqual({ x: 300, y: 204 });
    expect(spotPoint(cam, { world: false, mapId: "hall" })).toBeNull();
    expect(spotPoint(tanh, { world: false, mapId: "pond" })).toBeNull();
    expect(spotPoint(cam, { world: true, mapId: null })).toEqual({ x: ZONES.pond.ox + 300, y: ZONES.pond.oy + 204 });
    expect(spotPoint({ map: "song_cai", x: 500, y: 200 }, { world: true, mapId: null })).toEqual({ x: ZONES.song_cai.ox + 500, y: ZONES.song_cai.oy + 200 });
    expect(spotPoint(tanh, { world: true, mapId: null })).toEqual({ x: 424, y: 1900 });
  });
  it("the nearest within 48 px, a tie the newest; none outside or expired", () => {
    const other: GroundbaitSpotView = { ...cam, id: 11, item: "gb_tom", x: 316 };
    const placed = [cam, other].map((spot) => ({ spot, at: { x: spot.x, y: spot.y } }));
    expect(spotAt(placed, { x: 302, y: 204 }, NOW)?.spot.id).toBe(7);
    expect(spotAt(placed, { x: 314, y: 204 }, NOW)?.spot.id).toBe(11);
    expect(spotAt(placed, { x: 308, y: 204 }, NOW)?.spot.id).toBe(11);   // a tie: the newest
    expect(spotAt(placed, { x: 300 + 49, y: 204 + 40 }, NOW)).toBeNull();
    expect(spotAt(placed, { x: 300, y: 204 }, NOW + 10_000_000)).toBeNull();
    expect(spotAt(placed, null, NOW)).toBeNull();
  });
  it("the 3D frame carries the spots into the live model", () => {
    const g = [{ id: 7, x: 1260, y: 1244, color: 0xe9d79a, stacks: 2, label: "🌾 x" }];
    const live = liveFromFrame({ billboards: [], gameplay: { rats: [], dogs: [], leaps: [], gates: [], groundbait: g } });
    expect(live.groundbait).toEqual(g);
  });
  it("the bubbles stay inside the spot; more when topped up; still under reduced motion", () => {
    const one = bubbleRing(1, 1234, false), three = bubbleRing(3, 1234, false);
    expect(three.mid.length).toBeGreaterThan(one.mid.length);
    for (const p of [...one.ring, ...three.mid]) expect(Math.hypot(p.x, p.y / 0.8)).toBeLessThanOrEqual(GROUNDBAIT_RADIUS_PX + 4);
    expect(bubbleRing(2, 0, true)).toEqual(bubbleRing(2, 99_999, true));
  });
});

describe("the HUD", () => {
  it("hands the spots to the canvas and shows the line while I stand in one, gone at expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const [cam] = parseGroundbaitSpots(RAW, NOW);
    const short = { ...cam, untilMs: NOW + 2500 };
    let here: GroundbaitSpotView | null = short;
    const canvas = { setGroundbait: vi.fn(), groundbaitHere: () => here };
    render(<GroundbaitHud spots={[short]} canvas={() => canvas} />);
    expect(canvas.setGroundbait).toHaveBeenCalledWith([short]);
    expect(screen.getByTestId("groundbait-hud").textContent).toContain("Đang câu trong ổ thính cám gạo · còn 0:03");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("groundbait-hud").textContent).toContain("còn 0:02");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId("groundbait-hud")).toBeNull();
    here = null;
    vi.useRealTimers();
  });
});
