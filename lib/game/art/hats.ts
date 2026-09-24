import type { Layer } from "./layers";

export type HatShape = "nonla" | "taibeo";

// Hats are symmetric, so one layer serves every facing. Codes: . o y/Y/Z (nón lá straw) x/X (fabric).
export const HATS: Record<HatShape, Layer> = {
  nonla: { top: 0, rows: [
    "...........oo...........",
    "..........oyyo..........",
    "........ooyyyYoo........",
    ".......oyyyyyYYZo.......",
    ".....ooyyyyyyYYYZoo.....",
    "....oyyyyyyyyYYYYZZo....",
    "..ooyyyyyyyyyYYYYZZZoo..",
    ".oyyyyyyyyyyyYYYYYZZZZo.",
    "ooZZZZZZZZZZZZZZZZZZZZoo",
  ] },
  taibeo: { top: 2, rows: [
    "........oooooooo........",
    "......ooxxxxxxxxoo......",
    ".....oxxxxxxxxxxxxo.....",
    ".....oxxxxxxxxxxxxo.....",
    ".....oXXXXXXXXXXXXo.....",
    "...ooxxxxxxxxxxxxxxoo...",
    "..oxxxxxxxxxxxxxxxxxxo..",
    "..oooXXXXXXXXXXXXXXooo..",
  ] },
};

export const HAT_CODES = ".oyYZxX";
