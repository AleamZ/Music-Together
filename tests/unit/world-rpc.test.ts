// v21 "world" (0075): world_state's parser keeps what it knows and drops the rest.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
import { parseWorld, worldErrorText } from "@/lib/game/realm/rpc";

describe("parseWorld", () => {
  it("reads a full answer", () => {
    const s = parseWorld({
      server_now_ms: 1000, night: true, snow_until_ms: 5000,
      wild: { animals: [{ id: 1, species: "wolf", hx: 10, hy: 20, seed: 7, born_ms: 1, expires_ms: 9, photographed: true },
                        { id: 2, species: "dragon" }], bag: { da_soi: 2, nope: 5 }, album: { wolf: 1 }, kills_today: 3 },
      bosses: { fights: [{ id: 4, boss: "trau_tinh", name: "Trâu Tinh", kind: "world", map: "bai_dat", arena: { x: 1, y: 2, w: 3, h: 4 },
                           hp: 10, max_hp: 20, phase: 2, status: "up", cap: 4, starts_ms: 1, ends_ms: 2, killer: null, my_dmg: 3,
                           my_combo: 1, fighters: 2, top: [{ name: "a", dmg: 3 }] }, { boss: "x" }],
                next: [{ boss: "soi_ma", name: "Sói Ma", at_ms: 99 }] },
      party: { id: 3, leader: "me", members: [{ id: "me", name: "Tôi", map: "pond", x: 1, y: 2 }, { id: "b", name: "B", map: null }],
               chat: [{ id: 1, name: "B", body: "hi", at_ms: 5 }] },
      invites: [{ party_id: 8, from: "C" }],
      dungeon: { run: { id: 6, room: 2, mobs: [0, 10], mob_max: [20, 20], status: "open", expires_ms: 7, leader: "me", joined: true,
                        members: [{ name: "Tôi", dmg: 30 }] }, clears_today: 1 },
    });
    expect(s.night).toBe(true);
    expect(s.snowUntilMs).toBe(5000);
    expect(s.wild?.animals.map((a) => a.species)).toEqual(["wolf"]);
    expect(s.wild?.bag).toEqual({ da_soi: 2 });
    expect(s.fights).toHaveLength(1);
    expect(s.fights[0].maxHp).toBe(20);
    expect(s.next[0].boss).toBe("soi_ma");
    expect(s.party?.members[1].map).toBeNull();
    expect(s.invites).toEqual([{ partyId: 8, from: "C" }]);
    expect(s.dungeon?.mobs).toEqual([0, 10]);
    expect(s.clearsToday).toBe(1);
  });
  it("survives junk", () => {
    const s = parseWorld(null);
    expect(s.wild).toBeNull();
    expect(s.party).toBeNull();
    expect(s.fights).toEqual([]);
  });
  it("translates refusals", () => {
    expect(worldErrorText({ message: "damage cap" })).toMatch(/đồng đội/);
    expect(worldErrorText(new Error("??"))).toBe("Có lỗi, thử lại sau.");
  });
});

describe("realm art", () => {
  it("draws every animal, boss, the gate and the stall on a stub context", async () => {
    const { drawAnimal, drawBoss, drawBossBar, drawGate, drawStall } = await import("@/lib/game/realm/art");
    const { WILD_SPECIES, BOSS_DEFS } = await import("@/lib/game/realm/model");
    let rects = 0;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k === "fillRect" ? () => { rects++; } : k in t ? t[k as string] : () => {}),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    for (const s of WILD_SPECIES) for (const night of [false, true]) drawAnimal(ctx, s.id, 50, 50, night, 1, night, 1234);
    for (const b of BOSS_DEFS) for (const ph of [1, 3]) drawBoss(ctx, b.id, 100, 100, 999, ph === 3, ph, false);
    drawBossBar(ctx, "Boss", 100, 100, 5, 10);
    drawGate(ctx, 60, 120, 0, true);
    drawStall(ctx, 460, 56, true, 0, false);
    expect(rects).toBeGreaterThan(300);
  });
});
