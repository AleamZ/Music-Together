import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0032_news.sql"), "utf8");

describe("0032_news.sql", () => {
  it("keeps _news_event and the hooks away from clients", () => {
    for (const fn of ["_news_event(uuid, text, text, jsonb)", "_news_name(uuid)", "_news_home_room(uuid)", "_news_on_catch()",
      "_news_on_ban()", "_news_on_vehicle()", "_card_settle(uuid, text)"]) {
      expect(sql, fn).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql, fn).not.toContain(`grant execute on function public.${fn}`);
    }
  });
  it("grants the readers and the root-only admin RPCs, which check _auth_root", () => {
    for (const fn of ["news_feed(uuid, text)", "news_mark_read(uuid, text, text)", "news_admin_list(text)",
      "news_post_upsert(text, uuid, text, text, text, boolean)", "news_post_delete(text, uuid)"]) {
      expect(sql, fn).toContain(`grant execute on function public.${fn} to anon, authenticated;`);
    }
    expect(sql.match(/_auth_root\(p_session_token\)/g)?.length).toBe(3);
  });
  it("hooks the four big events, keeps 300 per room and pops posts up for 24 h", () => {
    for (const kind of ["'fish_legend'", "'ban'", "'car'", "'card_win'"]) expect(sql, kind).toContain(kind);
    expect(sql).toContain("offset 299");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toMatch(/lightning[\s\S]*drown \/ rescue[\s\S]*overboard[\s\S]*house/);
  });
});
