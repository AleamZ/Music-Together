import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_CODES, HEADS, buildBody } from "@/lib/game/art/body";
import { HAIR, HAIR_CODES } from "@/lib/game/art/hair";
import { HATS, HAT_CODES } from "@/lib/game/art/hats";
import { ITEM_ART } from "@/lib/game/art/items";
import { SPRITE_H, SPRITE_W, type Dir3, type Frame } from "@/lib/game/art/layers";

const DIRS: Dir3[] = ["down", "up", "left"];
const FRAMES: Frame[] = [0, 1, 2, 3];
const onlyCodes = (rows: readonly string[], codes: string) => rows.every((r) => [...r].every((ch) => codes.includes(ch)));

describe("body grids", () => {
  it("are 24×48 for every direction and frame, using only known codes", () => {
    for (const d of DIRS) for (const f of FRAMES) {
      const rows = buildBody(d, f);
      expect(rows).toHaveLength(SPRITE_H);
      for (const r of rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(rows, BODY_CODES)).toBe(true);
    }
  });
  it("walk frames only change the legs (rows 36+)", () => {
    for (const d of DIRS) {
      const idle = buildBody(d, 0), step = buildBody(d, 1);
      expect(step.slice(0, 36)).toEqual(idle.slice(0, 36));
      expect(step.slice(36)).not.toEqual(idle.slice(36));
    }
  });
});

describe("hair layers", () => {
  it("fit the sprite and use only hair codes", () => {
    for (const style of Object.values(HAIR)) for (const d of DIRS) {
      const l = style[d];
      expect(l.top + l.rows.length).toBeLessThanOrEqual(SPRITE_H);
      for (const r of l.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(l.rows, HAIR_CODES)).toBe(true);
    }
  });
  it("cover the bald scalp in every direction", () => {
    for (const [name, style] of Object.entries(HAIR)) for (const d of DIRS) {
      const l = style[d], head = HEADS[d];
      const at = (r: number, c: number) => (r >= l.top && r < l.top + l.rows.length ? l.rows[r - l.top][c] : ".");
      for (let r = 3; r <= 16; r++) for (let c = 0; c < SPRITE_W; c++) {
        const skin = head[r][c] === "s" || head[r][c] === "S";
        const must = r <= 8 || (d === "up" && r <= 14) || (d === "left" && r <= 14 && c >= 12);
        if (skin && must) expect(at(r, c), `${name}.${d} r${r} c${c}`).not.toBe(".");
      }
    }
  });
});

describe("hats", () => {
  it("are 24 wide with known codes", () => {
    for (const h of Object.values(HATS)) {
      for (const r of h.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(h.rows, HAT_CODES)).toBe(true);
    }
  });
});

describe("item art", () => {
  it("covers exactly the starter ids and slots seeded by migration 0011", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0011_v13_game_mode.sql"), "utf8");
    const seeded = [...sql.matchAll(/\('([a-z]+_[a-z_]+)',\s*'(hat|top|bottom|shoes|neck|hand|pet)'/g)]
      .map((m) => `${m[1]}:${m[2]}`).sort();
    const art = Object.entries(ITEM_ART).map(([id, a]) => `${id}:${a.slot}`).sort();
    expect(seeded).toHaveLength(15);
    expect(art).toEqual(seeded);
  });
});
