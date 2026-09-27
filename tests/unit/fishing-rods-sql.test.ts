import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/0034_rods_nets.sql", "utf8");
const PREV = readFileSync("supabase/migrations/0029_fashion2.sql", "utf8");

describe("0034_rods_nets.sql (v18.2)", () => {
  it("adds the new stock with its prices and durability", () => {
    expect(SQL).toContain("('rod_fiber',  'rod',  'Cần sợi thủy tinh',  700,");
    expect(SQL).toContain("('rod_master', 'rod',  'Cần thủ',           5000,");
    expect(SQL).toMatch(/\('net_small',\s+'net',\s+'Lưới nhỏ',\s+250,.*\b20,\s+24,/);
    expect(SQL).toMatch(/\('net_big',\s+'net',\s+'Lưới lớn',\s+600,.*\b30,\s+36,/);
    expect(SQL).toMatch(/\('bait_gold',\s+'bait', 'Mồi vàng',\s+25,/);
    expect(SQL).toContain("update public.shop_items set durability = null where id = 'rod_wood';");
  });

  it("re-creates the ledger reasons: the 27 of 0029 plus 'repair'", () => {
    const list = (s: string) => {
      const m = [...s.matchAll(/check \(reason in \(([^)]*)\)\)/g)].pop();
      return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
    };
    expect(list(PREV)).toHaveLength(27);
    expect(list(SQL)).toEqual([...list(PREV), "repair"]);
  });

  it("keeps finish_cast at 4 args, wears on a hook attempt and grants the swim immunity on overboard", () => {
    expect(SQL).toContain("create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,\n                                              p_hooked boolean default false)");
    expect(SQL).toContain("grant execute on function public.finish_cast(text, uuid, boolean, boolean)");
    expect(SQL).toContain("perform public._rod_wear(v_account, v_rod, 1);");
    expect(SQL).toContain("update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false");
  });
});
