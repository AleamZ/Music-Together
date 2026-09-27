import { R, type Dir3, type Layer } from "./layers";

export type HatShape = "nonla" | "taibeo"
  | "cap" | "beanie" | "fedora" | "sunhat" | "helmet" | "coi" | "bucket" | "crown" | "antlers" | "cowboy";

// Hat layers, per facing ("right" mirrors "left"). Codes: . o y/Y/Z (straw, gold) x/X (fabric main/shade)
// b/B (band, brim, cuff, ribbon) g (accent: logo, pom-pom, badge, gem, highlight).
// No outer outline in the art (compose.ts traces it). A hat hides everything above its `clip` row that it does not
// cover itself: the hair's volume, and the head, never poke out around it.
const same = (l: Layer): Record<Dir3, Layer> => ({ down: l, left: l, up: l });
/** A symmetric row from its left half (12 columns). */
const sym = (half: string): string => half + [...half].reverse().join("");

export const HATS: Record<HatShape, Record<Dir3, Layer>> = {
  nonla: same({ top: 1, rows: [
    R(11, "yY"),
    R(10, "yyYY"),
    R(9, "yyyYYZ"),
    R(8, "yyyyYYZZ"),
    R(7, "yyyyyYYYZZ"),
    R(6, "yyyyyyYYYZZZ"),
    R(5, "yyyyyyyYYYYZZZ"),
    R(3, "yyyyyyyyyYYYYYZZZZ"),
    R(1, "yyyyyyyyyyyYYYYYYZZZZZ"),
    R(1, "ZZZZZZZZZZZZZZZZZZZZZZ"),
  ] }),
  taibeo: same({ top: 2, rows: [
    R(8, "xxxxxxxx"),
    R(6, "xxxxxxxxxxxX"),
    R(5, "xxxxxxxxxxxxXX"),
    R(4, "xxxxxxxxxxxxxXXX"),
    R(4, "xxxxxxxxxxxxxXXX"),
    R(4, "XXXXXXXXXXXXXXXX"),
    R(2, "xxxxxxxxxxxxxxxxxxXX"),
    R(1, "xxxxxxxxxxxxxxxxxxxxXX"),
    R(1, "XXXX..............XXXX"),
  ] }),
  // a baseball cap: a curved crown with a button and a logo, the brim to the front
  cap: {
    down: { top: 2, rows: [
      R(11, "bb"),
      R(8, "xxxxxxxX"),
      R(6, "xxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(4, "xxxxxxxggxxxxxXX"),
      R(3, "xxxxxxxxggxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(2, "XXXXXXXXXXXXXXXXXXXX"),
      R(2, "bbbbbbbbbbbbbbbbbbbB"),
      R(3, "BBBBBBBBBBBBBBBBBB"),
    ] },
    left: { top: 2, rows: [
      R(12, "bb"),
      R(9, "xxxxxxxX"),
      R(7, "xxxxxxxxxxXX"),
      R(6, "xxxxxxxxxxxxXX"),
      R(5, "ggxxxxxxxxxxxxXX"),
      R(4, "xggxxxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxxxXX"),
      R(4, "XXXXXXXXXXXXXXXXXX"),
      R(0, "bbbbbbbbB"),
    ] },
    up: { top: 2, rows: [
      R(11, "bb"),
      R(8, "xxxxxxxX"),
      R(6, "xxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(2, "xxxxxxxxb..bxxxxxxXX"),
    ] },
  },
  // a knit beanie: ribbed dome, a folded cuff and a pom-pom
  beanie: same({ top: 0, rows: [
    R(10, "gggg"),
    R(9, "gggggg"),
    R(10, "gggg"),
    R(7, "xxxxxxxxxX"),
    R(5, "xXxxXxxXxxXxXX"),
    R(4, "xxXxxXxxXxxXxxXX"),
    R(3, "xxxXxxXxxXxxXxxXXX"),
    R(3, "xxxXxxXxxXxxXxxXXX"),
    R(2, "bbbbbbbbbbbbbbbbbbbB"),
    R(2, "bBbBbBbBbBbBbBbBbBbB"),
    R(2, "BBBBBBBBBBBBBBBBBBBB"),
  ] }),
  // a fedora: a pinched crown with a band and a medium brim
  fedora: same({ top: 2, rows: [
    R(8, "xxx..xxX"),
    R(7, "xxxxXXxxxX"),
    R(6, "xxxxxXXxxxXX"),
    R(6, "xxxxxxxxxxXX"),
    R(6, "bbbbbbbbbbbB"),
    R(6, "BBBBBBBBBBBB"),
    R(1, "xxxxxxxxxxxxxxxxxxxxXX"),
    R(2, "XXXXXXXXXXXXXXXXXXXX"),
  ] }),
  // a sun hat: a low crown with a ribbon bow and a wide brim that droops at the ends
  sunhat: same({ top: 3, rows: [
    R(8, "xxxxxxxX"),
    R(7, "xxxxxxxxXX"),
    R(6, "xxxxxxxxxxXX"),
    R(6, "bbbbbbbbbgbB"),
    R(2, "xxxxxxxxxxxxgxgxxxxX"),
    R(0, "xxxxxxxxxxxxxxxxxxxxxxXX"),
    R(0, "XXX..................XXX"),
  ] }),
  // a motorbike half-helmet: a glossy shell, a rim line and a grey chin strap (b)
  helmet: {
    down: { top: 3, rows: [
      R(8, "xgxxxxxX"),
      R(6, "xggxxxxxxxXX"),
      R(5, "xgxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "XXXXXXXXXXXXXXXXXX"),
      R(4, "b..............b"),
      R(4, "b..............b"),
      R(4, "b..............b"),
      R(4, "b..............b"),
      R(4, "b..............b"),
      R(4, "b..............b"),
      R(5, "b............b"),
      R(6, "bb........bb"),
    ] },
    left: { top: 3, rows: [
      R(9, "xgxxxxX"),
      R(7, "xggxxxxxXX"),
      R(6, "xgxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "XXXXXXXXXXXXXXXXXX"),
      R(12, "b"),
      R(12, "b"),
      R(11, "b"),
      R(10, "b"),
      R(9, "b"),
      R(8, "b"),
      R(7, "b"),
      R(6, "b"),
    ] },
    up: { top: 3, rows: [
      R(8, "xxxxxxxX"),
      R(6, "xxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "xxxxxxxxxxxxxxxxXX"),
      R(3, "XXXXXXXXXXXXXXXXXX"),
    ] },
  },
  // mũ cối: a tall dome, a small brim all round and a round badge at the front
  coi: {
    down: { top: 1, rows: [
      R(10, "xxxX"),
      R(8, "xxxxxxxX"),
      R(7, "xxxxxxxxxX"),
      R(6, "xxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(5, "xxxxxxggxxxxXX"),
      R(4, "xxxxxxgbbgxxxxXX"),
      R(4, "xxxxxxxggxxxxxXX"),
      R(1, "xxxxxxxxxxxxxxxxxxxxXX"),
      R(2, "XXXXXXXXXXXXXXXXXXXX"),
    ] },
    left: { top: 1, rows: [
      R(11, "xxxX"),
      R(9, "xxxxxxxX"),
      R(8, "xxxxxxxxxX"),
      R(7, "xxxxxxxxxxXX"),
      R(6, "xxxxxxxxxxxxXX"),
      R(5, "gxxxxxxxxxxxxxXX"),
      R(4, "gbxxxxxxxxxxxxXX"),
      R(4, "gxxxxxxxxxxxxxXX"),
      R(1, "xxxxxxxxxxxxxxxxxxxxXX"),
      R(2, "XXXXXXXXXXXXXXXXXXXX"),
    ] },
    up: { top: 1, rows: [
      R(10, "xxxX"),
      R(8, "xxxxxxxX"),
      R(7, "xxxxxxxxxX"),
      R(6, "xxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(5, "xxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(4, "xxxxxxxxxxxxxxXX"),
      R(1, "xxxxxxxxxxxxxxxxxxxxXX"),
      R(2, "XXXXXXXXXXXXXXXXXXXX"),
    ] },
  },
  // a bucket hat: a short flat-topped crown and a brim that slopes down all round
  bucket: same({ top: 4, rows: [
    R(7, "xxxxxxxxxX"),
    R(6, "xxxxxxxxxxXX"),
    R(5, "xxxxxxxxxxxxXX"),
    R(5, "bbbbbbbbbbbbbB"),
    R(3, "xxxxxxxxxxxxxxxxxX"),
    R(2, "xxxxxxxxxxxxxxxxxxXX"),
    R(1, "XXXXXXXXXXXXXXXXXXXXXX"),
  ] }),
  // a crown: five gold points on a band set with gems, sitting on the hair
  crown: same({ top: 1, rows: [
    R(4, "g...y..gg..y...g"),
    R(4, "y..yYy.yy.yYy..Y"),
    R(4, "yY.yYy.yY.yYy.YY"),
    R(4, "yyyyyyyyyyyyyyYY"),
    R(4, "YYYYYYYYYYYYYYYY"),
    R(4, "yygyyyybbyyyygyY"),
    R(4, "ZZZZZZZZZZZZZZZZ"),
  ] }),
  // reindeer antlers on a headband over the hair
  antlers: same({ top: 1, rows: [
    sym("xx...xx....."),
    sym("xx...xx.xx.."),
    sym(".xxxxxxxX..."),
    sym("..xXX..bbbbb"),
    sym("...bbbbb...."),
  ] }),
  // a straw cowboy hat: a creased crown with a band, the brim turned up at the sides
  cowboy: same({ top: 2, rows: [
    R(7, "yyyy..yyyY"),
    R(6, "yyyyyYYyyyyY"),
    R(1, "y....yyyyyYYyyyyY....Y"),
    R(1, "yy...yyyyyyyyyyYY...YY"),
    R(1, "yyy..bbbbbbbbbbbB..YYY"),
    R(1, "yyYyyyYyyyYyyyYyyyYyYY"),
    R(2, "ZZZZZZZZZZZZZZZZZZZZ"),
  ] }),
};
/** The first row (unposed) a hat leaves to the head and hair. */
export const HAT_CLIP: Record<HatShape, number> = {
  nonla: 10, taibeo: 8,
  cap: 10, beanie: 11, fedora: 9, sunhat: 9, helmet: 10, coi: 10, bucket: 10, crown: 4, antlers: 0, cowboy: 8,
};

export const HAT_CODES = ".oyYZxXbBg";
