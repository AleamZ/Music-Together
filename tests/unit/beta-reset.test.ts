import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { BETA_TITLE, betaFrame, boostLeft, boostText, isBetaTag, parseBetaMe } from "@/lib/game/beta/frame";
import { nameTag } from "@/lib/game/social";
import { filterStoreItems, isBetaItem } from "@/lib/game/store";
import { wearableIds } from "@/lib/game/diorama/character/catalog";
import { WEAR3D, wear3dDesc } from "@/lib/game/diorama/character/wear3d";
import { FURNITURE } from "@/lib/game/housing/apartment";
import type { CatalogItem } from "@/lib/game/character";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const sql = (f: string) => readFileSync(join(DIR, f), "utf8");
const BETA = sql("0118_beta_reset.sql");

/** Every public table that the chain creates (from 0004's rebuild on) with an account column, minus the dropped ones. */
function accountTables(): Set<string> {
  const out = new Set<string>();
  for (const f of files.filter((x) => x >= "0004")) {
    const s = sql(f).replace(/--[^\n]*/g, "");
    for (const m of s.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/\baccount_id\b|references public\.accounts\b/i.test(m[2])) out.add(m[1]);
    }
    for (const m of s.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column[^;]*?(?:\baccount_id\b|references public\.accounts\b)[^;]*;/gi)) out.add(m[1]);
    for (const m of s.matchAll(/drop table (?:if exists )?public\.(\w+)/gi)) if (!new RegExp(`create table (?:if not exists )?public\\.${m[1]}\\b`, "i").test(s.slice(m.index ?? 0))) out.delete(m[1]);
  }
  out.delete("accounts");
  return out;
}

/** The tables beta_reset_scope classifies: 0118's rows, and the later migrations' (0123: the forest's traps …). */
function scope(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const s = f === "0118_beta_reset.sql" ? BETA : sql(f);
    let at = s.indexOf("insert into public.beta_reset_scope");
    while (at >= 0) {
      const block = s.slice(at, s.indexOf("on conflict (tbl)", at));
      for (const m of block.matchAll(/\('(\w+)', '(wipe|keep|release|reset)'/g)) out.set(m[1], m[2]);
      at = s.indexOf("insert into public.beta_reset_scope", at + 1);
    }
  }
  return out;
}

describe("0118 the end-of-Beta reset", () => {
  it("classifies every table that holds an account's rows (the SQL smoke checks the live catalogue too)", () => {
    const sc = scope();
    expect(accountTables().size).toBeGreaterThan(120);                                  // the parser finds them
    const missing = [...accountTables()].filter((t) => !sc.has(t)).sort();
    expect(missing).toEqual([]);
    expect(sc.get("accounts")).toBeUndefined();
    for (const keep of ["account_auth", "account_secrets", "chat_messages", "anticheat_events", "anticheat_status", "blacklisted_accounts", "coin_ledger"]) {
      expect(sc.get(keep), keep).toBe("keep");
    }
    for (const wipe of ["wallets", "inventory", "rods", "fish", "fridge_fish", "account_items", "furniture_items", "pets", "owned_vehicles",
      "player_progress", "player_achievements", "quest_progress", "story_progress", "mail", "econ_listings", "ac_stat_flags"]) {
      expect(sc.get(wipe), wipe).toBe("wipe");
    }
    expect(sc.get("characters")).toBe("reset");
    for (const r of ["apartments", "house_lots", "field_plots", "econ_stalls"]) expect(sc.get(r), r).toBe("release");
  });

  it("documents the same classification in the spec", () => {
    const doc = readFileSync(join(process.cwd(), "docs/superpowers/specs/2026-10-01-beta-reset.md"), "utf8");
    for (const t of scope().keys()) expect(doc, t).toContain(`\`${t}\``);
  });

  it("runs nothing on its own: the migration only defines", () => {
    const body = BETA.replace(/--[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(body).not.toMatch(/\bselect public\.admin_beta_/i);
    expect(body).not.toMatch(/\bdelete from\b/i);
    expect(body).not.toMatch(/\bupdate public\.(?!beta_)/i);
  });

  it("draws the five keepsakes in 2D and 3D, and the mascot", () => {
    const ids = wearableIds();
    expect(ids.shoes).toContain("beta_dep");
    expect(ids.hat).toContain("beta_non");
    expect(ids.bottom).toContain("beta_quan");
    expect(ids.top).toContain("beta_ao");
    expect(ids.outfit).toContain("beta_set");
    for (const id of ["beta_dep", "beta_non", "beta_quan", "beta_ao", "beta_set"]) {
      expect(WEAR3D[id], id).toBeTruthy();
      expect(wear3dDesc(id), id).toBeTruthy();
      expect(BETA).toContain(`('${id}',`);
    }
    expect(FURNITURE.find((f) => f.id === "beta_mascot")?.exclusive).toBe(true);
  });

  it("keeps the keepsakes out of the store", () => {
    const item = (id: string): CatalogItem => ({ id, slot: "shoes", name: id, price: 0, starter: false, sort_order: 1, gender: "unisex" } as CatalogItem);
    const cat = [item("beta_dep"), item("fm_boots")];
    const base = { category: "all" as const, fitsMe: false, gender: "nam" as const };
    expect(filterStoreItems(cat, { ...base, tab: "store", ownedIds: new Set() }).map((i) => i.id)).toEqual(["fm_boots"]);
    expect(filterStoreItems(cat, { ...base, tab: "my_items", ownedIds: new Set(["beta_dep"]) }).map((i) => i.id)).toEqual(["beta_dep"]);
    expect(isBetaItem("beta_set")).toBe(true);
    expect(isBetaItem("fm_boots")).toBe(false);
  });

  it("frames a Beta player's name everywhere a name tag is drawn", () => {
    expect(betaFrame("Lan", 0)).toBe("β〔Lan〕");
    expect(betaFrame("Lan", null)).toBe("Lan");
    expect(isBetaTag(nameTag("Lan", { beta: 3, pgLevel: 2, pgTitle: BETA_TITLE }))).toBe(true);
    expect(nameTag("Lan", { beta: 3, pgLevel: 2, pgTitle: BETA_TITLE })).toBe("Lv2 β〔Lan〕 «Người khai hoang Beta»");
    expect(nameTag("Tèo", { pgLevel: 3 })).toBe("Lv3 Tèo");
    expect(isBetaTag("Lv3 Tèo")).toBe(false);
  });

  it("counts the boost down and hides it once over", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(boostLeft(now + (6 * 24 + 3) * 3_600_000, now)).toBe("6 ngày 3 giờ");
    expect(boostLeft(now + 90 * 60_000, now)).toBe("1 giờ 30 phút");
    expect(boostLeft(now - 1, now)).toBe("hết hạn");
    const me = parseBetaMe({ beta: true, tier: 2, title: BETA_TITLE, boosts: [
      { kind: "npc_quota", pct: 25, until: "2026-10-08T00:00:00Z" }, { kind: "xp", pct: 50, until: "2026-10-08T00:00:00Z" }, { kind: "bad" }] });
    expect(me.boosts).toHaveLength(2);
    expect(boostText(me, now)).toBe("⚡ +50% KN · +25% thương lái · còn 7 ngày 0 giờ");
    expect(boostText(me, Date.parse("2026-10-08T00:00:01Z"))).toBeNull();
    expect(parseBetaMe(null)).toEqual({ beta: false, tier: null, title: null, boosts: [], serverNow: null });
  });
});
