import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;
// The full game needs two accounts of the test project with at least 1 000 xu each (10 stakes at the lowest stake): a
// fresh account has none. "name:password" each.
const funded = [process.env.SUPABASE_TEST_CARD_PLAYER_A, process.env.SUPABASE_TEST_CARD_PLAYER_B];

type State = {
  v: number; seq: number; phase: string; turn: number | null; deadline: string | null; hand_no: number;
  seats: Array<{ seat: number; id: string; escrow: number }>;
  pub: { top?: unknown } | null;
  last: { places: number[]; net: Record<string, number> } | null;
};

// The card corner end to end with the public RPCs (spec §17): the lobby, membership, the refusals a fresh account meets,
// and — with two funded accounts — a 2-player Tiến lên game played to its settlement, the wallets' total unchanged.
run("v16 card tables", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("cb"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("bai"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("reads the lobby: three idle tables, no seats", async () => {
    const me = await reg();
    const r = await room(me.token);
    const l = await db.rpc("card_lobby", { p_room_id: r.room_id, p_session_token: me.token });
    expect(l.error).toBeNull();
    expect((l.data as { tables: unknown[] }).tables).toEqual([
      { game: "tienlen", stake: null, phase: "idle", max: 4, seats: [] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
      { game: "poker", stake: null, phase: "idle", max: 6, seats: [] },
    ]);
    const s = await db.rpc("card_state", { p_room_id: r.room_id, p_session_token: me.token, p_game: "poker" });
    expect(s.data).toMatchObject({ game: "poker", phase: "idle", seats: [], pub: {}, last: null });
    const h = await db.rpc("card_hand", { p_room_id: r.room_id, p_session_token: me.token, p_game: "poker" });
    expect(h.data).toMatchObject({ seat: null, cards: [] });
  });

  it("keeps outsiders out of every table", async () => {
    const owner = await reg();
    const stranger = await reg();
    const r = await room(owner.token);
    for (const [fn, args] of [
      ["card_lobby", {}], ["card_state", { p_game: "tienlen" }], ["card_hand", { p_game: "cao" }], ["card_tick", { p_game: "poker" }],
      ["card_leave", { p_game: "tienlen" }], ["tl_pass", { p_seq: 0 }],
    ] as const) {
      const x = await db.rpc(fn, { p_room_id: r.room_id, p_session_token: stranger.token, ...args });
      expect(x.error?.message, fn).toBe("account is not a member of this room");
    }
  });

  it("refuses a seat the wallet cannot cover, and a stand-up without a seat", async () => {
    const me = await reg();
    const r = await room(me.token);
    const sit = await db.rpc("card_sit", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen", p_seat: 1, p_stake: 100,
      p_buyin: null });
    expect(sit.error?.message).toBe("not enough coins");
    const leave = await db.rpc("card_leave", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen" });
    expect(leave.error?.message).toBe("not seated");
    const tick = await db.rpc("card_tick", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen" });
    expect(tick.data).toMatchObject({ changed: false, state: { phase: "idle" } });
  });

  (funded.every(Boolean) ? it : it.skip)("plays a 2-player Tiến lên game to its settlement; the wallets' total never changes", async () => {
    const login = async (who: string) => {
      const [u, p] = who.split(":");
      const { data, error } = await db.rpc("login", { p_username: u, p_password: p });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
    };
    const a = await login(funded[0]!);
    const b = await login(funded[1]!);
    const r = await room(a.token);
    expect((await db.rpc("join_room", { p_code: r.code, p_password: "pw", p_session_token: b.token })).error).toBeNull();
    const coins = async (t: string) => ((await db.rpc("fishing_state", { p_session_token: t })).data as { coins: number }).coins;
    const before = (await coins(a.token)) + (await coins(b.token));
    const call = async (t: string, fn: string, args: Record<string, unknown>) => {
      const x = await db.rpc(fn, { p_room_id: r.room_id, p_session_token: t, ...args });
      if (x.error) throw x.error;
      return x.data as { state: State };
    };
    await call(a.token, "card_sit", { p_game: "tienlen", p_seat: 1, p_stake: 100, p_buyin: null });
    let s = (await call(b.token, "card_sit", { p_game: "tienlen", p_seat: 2, p_stake: 100, p_buyin: null })).state;
    expect(s.phase).toBe("countdown");
    const token = (seat: number) => (s.seats.find((x) => x.seat === seat)!.id === a.account_id ? a.token : b.token);
    // the leader plays its lowest card each time it leads, the other passes: the leader goes out after 13 plays
    for (let step = 0; step < 100 && s.phase !== "result"; step++) {
      if (s.phase !== "playing") {
        await new Promise((res) => setTimeout(res, Math.max(0, Date.parse(s.deadline ?? "") - Date.now()) + 500));
        s = (await call(a.token, "card_tick", { p_game: "tienlen" })).state;
        continue;
      }
      const t = token(s.turn!);
      if (s.pub?.top) {
        s = (await call(t, "tl_pass", { p_seq: s.seq })).state;
      } else {
        const h = (await db.rpc("card_hand", { p_room_id: r.room_id, p_session_token: t, p_game: "tienlen" })).data as { cards: number[] };
        s = (await call(t, "tl_play", { p_seq: s.seq, p_cards: [Math.min(...h.cards)] })).state;
      }
    }
    expect(s.phase).toBe("result");
    expect(s.last!.places).toHaveLength(2);
    expect(Object.values(s.last!.net).reduce((x, y) => x + y, 0)).toBe(0);
    expect(s.seats.every((x) => x.escrow === 0)).toBe(true);
    await call(a.token, "card_leave", { p_game: "tienlen" });
    await call(b.token, "card_leave", { p_game: "tienlen" });
    expect((await coins(a.token)) + (await coins(b.token))).toBe(before);
  }, 60_000);
});
