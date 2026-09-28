import { span, type GarmentArt, type GarmentCtx, type GarmentLayers } from "./garments";

// v20.2 Võ đường: the seven võ phục as outfit-slot garments of the world chibi (fashion-models style: region colours +
// small overlays, both bodies, every facing and frame). The look carries no rank, so the belt, sash, armband or
// waistband is drawn in the style's first belt colour (plan ruling P13); the fight rig draws the real rank.
// Codes: 1 the belt colour, 2 a darker line (lapels, the belt's knot), 3 a collar, 4 a lighter trim.

/** Each style's first belt colour (lib/game/fight/dojo.ts; pinned by tests/unit/uniforms.test.ts). Kept here so the world
 *  painter does not load the fight engine. */
export const FIRST_BELT: Readonly<Record<string, string>> = {
  vovinam: "#9fd3f0", muaythai: "#f6f6f2", karate: "#f6f6f2", taekwondo: "#f6f6f2", boxing: "#f6f6f2", judo: "#f6f6f2", vinhxuan: "#f6f6f2",
};
const beltColor = (key: string): string => FIRST_BELT[key] ?? "#f6f6f2";

/** A belt across the waist (rows 29–30) tied in front, its two tails hanging over the hips. */
function belt(c: GarmentCtx, L: GarmentLayers, tails = true): void {
  const u = L.under;
  if (c.dir === "left") {
    u.h(8, 15, 29, "1"); u.h(8, 15, 30, "2");
    if (tails) { u.set(7, 30, "1"); u.set(7, 31, "1"); u.set(7, 32, "2"); }
    return;
  }
  const [l, r] = span(c, 29);
  u.h(l, r, 29, "1"); u.h(l, r, 30, "2");
  if (c.dir === "up" || !tails) return;
  u.set(11, 29, "2"); u.set(12, 29, "2");
  u.v(11, 31, 33, "1"); u.v(12, 31, 32, "1"); u.set(11, 34, "2");
}

/** Crossed lapels of a gi (front view), a darker line from each shoulder down to the belt. */
function lapels(c: GarmentCtx, L: GarmentLayers, code = "2", wide = false): void {
  const u = L.under;
  if (c.dir === "left") { u.v(8, 21, 28, code); if (wide) u.v(9, 22, 27, code); return; }
  if (c.dir === "up") { u.h(10, 13, 21, code); return; }
  for (let i = 0; i < 7; i++) {
    u.set(9 + Math.min(i, 3), 21 + i, code);
    u.set(14 - Math.min(i, 3), 21 + i, code);
    if (wide) { u.set(10 + Math.min(i, 3), 21 + i, code); u.set(13 - Math.min(i, 3), 21 + i, code); }
  }
}

/** A band round both upper arms (front and back views). */
function armbands(c: GarmentCtx, L: GarmentLayers): void {
  if (c.dir === "left") return;
  for (const x of [c.g.armL, c.g.armR]) L.over.h(x, x + 1, 23, "1");
}

const gi = (main: string, shade: string, hi: string, beltKey: string, extra: Record<string, string> = {}): Pick<GarmentArt, "colors"> => ({
  colors: { t: main, T: shade, u: hi, K: main, a: main, A: shade, p: main, P: shade, l: shade, 1: beltColor(beltKey), 2: "#1f2027", ...extra },
});

export const UNIFORM_ART: Record<string, GarmentArt> = {
  vp_vovinam: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
    ...gi("#2f5fb8", "#21438a", "#4a78cf", "vovinam", { 2: "#172f63" }),
    draw(c, L) { lapels(c, L); belt(c, L); },
  },
  vp_muaythai: {
    slot: "outfit", gender: "unisex", body: { sleeve: "none", thigh: 3 },
    colors: {
      t: "#c9302c", T: "#8f1f1c", u: "#e25550", K: "#c9302c", a: "#c9302c", A: "#8f1f1c", p: "#c9302c", P: "#8f1f1c", l: "#f2e6c8",
      j: "#f2e6c8", 1: beltColor("muaythai"), 2: "#f2e6c8",
    },
    draw(c, L) {
      armbands(c, L);
      const u = L.under;
      if (c.dir === "left") { u.h(8, 15, 31, "2"); return; }
      const [l, r] = span(c, 31);
      u.h(l, r, 31, "2");
      if (c.dir === "down") { u.set(l + 1, 33, "2"); u.set(r - 1, 33, "2"); }
    },
  },
  vp_karate: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
    ...gi("#f3f0e7", "#c9c2b1", "#ffffff", "karate", { 2: "#8a8272" }),
    draw(c, L) { lapels(c, L); belt(c, L); },
  },
  vp_taekwondo: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
    ...gi("#f4f4f2", "#c8c8c4", "#ffffff", "taekwondo", { 2: "#8a8a86", 3: "#1d1d22" }),
    draw(c, L) { lapels(c, L, "3"); belt(c, L); },
  },
  vp_boxing: {
    slot: "outfit", gender: "unisex", body: { sleeve: "none", thigh: 3 },
    colors: {
      t: "#d8332d", T: "#9c211d", u: "#ee6a5e", K: "#d8332d", a: "#d8332d", A: "#9c211d", p: "#e2b33a", P: "#b0851f", l: "#fff1c2",
      j: "#b0851f", 1: beltColor("boxing"), 2: "#9c211d",
    },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "left") { u.h(8, 15, 31, "1"); u.h(8, 15, 32, "2"); return; }
      const [l, r] = span(c, 31);
      u.h(l, r, 31, "1"); u.h(l, r, 32, "2");
      if (c.dir === "down") { u.v(l + 1, 33, 34, "l"); u.v(r - 1, 33, 34, "l"); }
    },
  },
  vp_judo: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
    ...gi("#1f4ea6", "#153677", "#3e6cc4", "judo", { 2: "#0e2452", 4: "#5b86d6" }),
    draw(c, L) { lapels(c, L, "4", true); belt(c, L); },
  },
  vp_vinhxuan: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
    ...gi("#26262e", "#131318", "#3c3c48", "vinhxuan", { 2: "#9a9aa6", 4: "#f2efe6" }),
    draw(c, L) {
      const u = L.under;
      // the mandarin collar and frog buttons, then the sash tied at the side
      if (c.dir === "left") {
        u.h(8, 11, 21, "4"); u.set(8, 23, "4"); u.set(8, 25, "4");
      } else if (c.dir === "down") {
        u.h(10, 13, 21, "4");
        for (const y of [23, 25, 27]) { u.set(11, y, "4"); u.set(12, y, "4"); }
      } else u.h(10, 13, 21, "4");
      belt(c, L, false);
      if (c.dir === "down") { const [l] = span(c, 29); u.v(l, 31, 33, "1"); u.set(l, 34, "2"); }
    },
  },
};

export const UNIFORM_ART_IDS: readonly string[] = Object.keys(UNIFORM_ART);
