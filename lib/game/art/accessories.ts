import { R, type Dir3, type Layer } from "./layers";

// Accessory layers (v18.6). Codes: . transparent · c main · C shade · D accent (pendant, watch face, flower centre).
// Rows are unposed; compose.ts shifts them by the pose (necklaces and hairpins by `dy`, wrist bands with the arm).

export const ACC_CODES = ".cCD";

export type NeckStyle = "chain" | "pearl" | "jade";
export type WristKind = "band" | "beads" | "watch";
export type HairpinKind = "star" | "bow" | "headband" | "bandana" | "flower" | "tie";

/** A 1-px chain from the collar dipping to a pendant at the chest (front); a short arc at the throat (side); the
 *  back of the chain at the nape (back). */
const CHAIN: Record<Dir3, Layer> = {
  down: { top: 21, rows: [R(7, "c........c"), R(8, "C......C"), R(9, "cC..Cc"), R(11, "cc"), R(11, "DD")] },
  left: { top: 21, rows: [R(10, "c"), R(9, "C"), R(9, "D")] },
  up: { top: 21, rows: [R(9, "cCcCcC")] },
};
/** A pearl string: round beads (a shade dot between each), no pendant. */
const PEARL: Record<Dir3, Layer> = {
  down: { top: 21, rows: [R(7, "c........c"), R(8, "c......c"), R(9, "cC..Cc"), R(11, "cc")] },
  left: { top: 21, rows: [R(10, "c"), R(9, "c"), R(9, "C")] },
  up: { top: 21, rows: [R(9, "cCcCcC")] },
};
/** A thin chain and a jade drop, two pixels wide and two tall. */
const JADE: Record<Dir3, Layer> = {
  down: { top: 21, rows: [R(7, "c........c"), R(8, "C......C"), R(9, "C....C"), R(10, "c..c"), R(11, "DD"), R(11, "DD")] },
  left: { top: 21, rows: [R(10, "c"), R(9, "C"), R(9, "D"), R(9, "D")] },
  up: { top: 21, rows: [R(9, "cCcCcC")] },
};
export const NECKLACES: Record<NeckStyle, Record<Dir3, Layer>> = { chain: CHAIN, pearl: PEARL, jade: JADE };

/** The two wrist pixels (the arm is 2 wide): a plain band, two bead colours, or a strap with a face. */
export const WRIST_ROW: Record<WristKind, string> = { band: "cC", beads: "cD", watch: "DC" };

/** Hairpins: small clips near the right temple (front), on the side of the head (side) and on the back (back);
 *  the headband and the sports band run across the head. */
export const HAIRPINS: Record<HairpinKind, Record<Dir3, Layer>> = {
  star: {
    down: { top: 5, rows: [R(16, "c"), R(15, "cDc"), R(16, "C")] },
    left: { top: 5, rows: [R(13, "c"), R(12, "cDc"), R(13, "C")] },
    up: { top: 6, rows: [R(12, "c"), R(11, "cDc"), R(12, "C")] },
  },
  bow: {
    down: { top: 5, rows: [R(14, "cc.cc"), R(15, "cDc"), R(14, "CC.CC")] },
    left: { top: 5, rows: [R(11, "cc.cc"), R(12, "cDc"), R(11, "CC.CC")] },
    up: { top: 7, rows: [R(9, "cc.cc"), R(10, "cDc"), R(9, "CC.CC")] },
  },
  headband: {
    down: { top: 3, rows: [R(6, "cccccccccccc"), R(4, "cc" + ".".repeat(12) + "cc"), R(3, "C" + ".".repeat(16) + "C")] },
    left: { top: 3, rows: [R(6, "cccccccc"), R(4, "cc......CC"), R(3, "C"), R(14, "C")] },
    up: { top: 3, rows: [R(6, "cccccccccccc"), R(4, "cc" + ".".repeat(12) + "cc"), R(3, "C" + ".".repeat(16) + "C")] },
  },
  bandana: {
    down: { top: 8, rows: [R(3, "c".repeat(18)), R(3, "C".repeat(18))] },
    left: { top: 8, rows: [R(2, "c".repeat(19)), R(2, "C".repeat(17) + "cc"), R(19, "cC"), R(20, "C")] },
    up: { top: 8, rows: [R(3, "c".repeat(18)), R(3, "C".repeat(7) + "cc" + "C".repeat(9)), R(10, "cC"), R(10, "C.C")] },
  },
  flower: {
    down: { top: 4, rows: [R(16, "c"), R(15, "cDc"), R(16, "C")] },
    left: { top: 4, rows: [R(13, "c"), R(12, "cDc"), R(13, "C")] },
    up: { top: 6, rows: [R(11, "c.c"), R(12, "D"), R(11, "C.C")] },
  },
  tie: {
    down: { top: 6, rows: [R(17, "cc"), R(17, "CC")] },
    left: { top: 9, rows: [R(17, "cC"), R(17, "Cc")] },
    up: { top: 11, rows: [R(10, "cCCc")] },
  },
};
