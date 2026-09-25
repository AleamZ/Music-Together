import type { Dir3, Frame } from "./layers";

// Body templates, 24 px wide. Region codes (colours come from the look, see compose.ts):
//   . transparent · o outline · s/S skin/shade · e eyes+brows · b blush · m mouth
//   t/T/u/K top main/shade/highlight/detail · q/Q scarf band · r/R scarf tails (front, inside the torso)
//   v/V scarf tails (side view, outside the torso) · n scarf-tail outline
//   p/P/l bottom main/shade/stripe · j hem · g/G lower leg · f/F sandal strap/sole

/** Rows 0–16: bald head + face (hair and hats are separate layers). */
export const HEAD_FRONT: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osseesssseeSSo.....",
  ".....osssessssesSSo.....",
  ".....osssessssesSSo.....",
  ".....ossbsssSssbSSo.....",
  ".....osssssmmsssSSo.....",
  ".......osssssssSo.......",
  "........oSSSSSSo........",
];
export const HEAD_BACK: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".......osssssssso.......",
  "........oSSSSSSo........",
];
/** Facing left; "right" is drawn mirrored. */
export const HEAD_SIDE: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  "......ossssssssssso.....",
  "......oseesssssssso.....",
  "......osessSsssssso.....",
  "......osessSsssssso.....",
  ".....osbsssSsssssso.....",
  "......omsssSsssssso.....",
  ".......osssSsssso.......",
  "........oSSSSo..........",
];

/** Rows 17–29. */
export const TORSO_FRONT: readonly string[] = [
  "......oQqQqQqQqQqo......",
  "......oqQqQqQqQqQo......",
  "...ouuttttRrRrtttTTTo...",
  "...ouuttttrRrRtttTTTo...",
  "...ouuttttRrRrtttTTTo...",
  "...ouutKKKrRrRKKKTTTo...",
  "...osstKtKRrrRKtKTSSo...",
  "...osstKKKtRRtKKKTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttKtttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttKtttttTSSo...",
  "...ossTTTTTTTTTTTTsso...",
];
export const TORSO_BACK: readonly string[] = [
  "......oQqQqQqQqQqo......",
  "......oqQqQqQqQqQo......",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...ossTTTTTTTTTTTTsso...",
];
export const TORSO_SIDE: readonly string[] = [
  ".......oQqQqQqo.........",
  ".......oqQqQqQo.........",
  "....nVvottuuutTTo.......",
  "....nvVottuuutTTo.......",
  "....nVvottuuutTTo.......",
  ".....nVottuuutTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottSSStTTo.......",
  ".......oTTTTTTTTo.......",
];

/** Rows 30–35. */
export const BOTTOM_FRONT: readonly string[] = [
  "....oopppppppppppPoo....",
  ".....oplpppppppplPo.....",
  ".....oplpppppppplPo.....",
  ".....oplpppooppplPo.....",
  ".....oplpppooppplPo.....",
  ".....jjjjjj..jjjjjj.....",
];
export const BOTTOM_SIDE: readonly string[] = [
  ".......oppppppPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......ojjjjjjjjo.......",
];

/** Rows 36–45: one leg, 6 columns wide (left leg = columns 5–10, right leg = columns 13–18). */
export const LEG_L: readonly string[] = [
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".offfo",
  "osssso",
  "oFFFFo",
  "oooooo",
];
export const LEG_R: readonly string[] = [
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "offfo.",
  "osssso",
  "oFFFFo",
  "oooooo",
];
export const LEGS_SIDE_IDLE: readonly string[] = [
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........offfo...........",
  ".......osssso...........",
  ".......oFFFFo...........",
  ".......oooooo...........",
];
export const LEGS_SIDE_STRIDE: readonly string[] = [
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......offo.oFFo........",
  "......osssso.oSSo.......",
  "......oFFFFo.oFFo.......",
  "......oooooo.oooo.......",
];

export const HEADS: Record<Dir3, readonly string[]> = { down: HEAD_FRONT, up: HEAD_BACK, left: HEAD_SIDE };
export const BODY_CODES = ".osSebmtTuKqQrRvVnpPljgGfF";

const EMPTY_ROW = "........................";

/** A lifted leg is the same template one row shorter (the foot moves up one pixel). */
function lift(leg: readonly string[]): string[] {
  return [...leg.slice(1), "......"];
}

function legsFront(liftLeft: boolean, liftRight: boolean): string[] {
  const l = liftLeft ? lift(LEG_L) : LEG_L;
  const r = liftRight ? lift(LEG_R) : LEG_R;
  return l.map((row, i) => "....." + row + ".." + r[i] + ".....");
}

/** Full 24×48 body for a direction and walk frame (0 idle, 1 step A, 2 idle, 3 step B). */
export function buildBody(dir: Dir3, frame: Frame): string[] {
  if (dir === "down") return [...HEAD_FRONT, ...TORSO_FRONT, ...BOTTOM_FRONT, ...legsFront(frame === 1, frame === 3), EMPTY_ROW, EMPTY_ROW];
  if (dir === "up") return [...HEAD_BACK, ...TORSO_BACK, ...BOTTOM_FRONT, ...legsFront(frame === 3, frame === 1), EMPTY_ROW, EMPTY_ROW];
  const legs = frame === 1 || frame === 3 ? LEGS_SIDE_STRIDE : LEGS_SIDE_IDLE;
  return [...HEAD_SIDE, ...TORSO_SIDE, ...BOTTOM_SIDE, ...legs, EMPTY_ROW, EMPTY_ROW];
}
