// Pure: wave 3's chibi actions (crafts, emotes, the card table, the xe ôm's pillion) on the same joint chains as
// pose.ts. `extraPose` fills a fresh pose `p` (already at REST) for one of these acts at time `s` (seconds, with the
// character's phase); pose.ts dispatches here and clamps the joints afterwards. Each is a closed-form loop.

import type { Pose } from "./pose";

export type ExtraAct =
  | "hammer" | "stir" | "sort"                                  // craft mini-games: Rèn (anvil), Nấu thuốc (cauldron), Phân loại (nia)
   | "dance" | "clap"                                // emotes: 🎉/🔥 dance, 👏 clap; 📷 is wave 1's "photo"
  | "card_hold" | "card_play" | "card_deal" | "card_win"        // the card tables
  | "pillion";                                                  // the xe ôm's passenger, hands on the driver's waist
export const EXTRA_ACTS: readonly ExtraAct[] = ["hammer", "stir", "sort", "dance", "clap", "card_hold", "card_play", "card_deal", "card_win", "pillion"];
const SET: ReadonlySet<string> = new Set(EXTRA_ACTS);
export const isExtraAct = (a: string): a is ExtraAct => SET.has(a);

/** Seated acts (the caller puts the hips on a seat: the card tables, the pillion). */
export const SEATED_EXTRA: ReadonlySet<ExtraAct> = new Set<ExtraAct>(["card_hold", "card_play", "card_deal", "card_win", "pillion"]);

const TAU = Math.PI * 2;

/** The card tables' sitting legs (as pose.ts's sit): thighs level, knees at 90°. */
function seated(p: Pose): void {
  p.drop = 0.56;
  p.legL.x = p.legR.x = 1.64;
  p.legL.z = p.legR.z = 0.06;
  p.kneeL = p.kneeR = 1.54;
}

export function extraPose(p: Pose, act: ExtraAct, s: number): void {
  switch (act) {
    case "hammer": {
      // Rèn: the hammer raised over the right shoulder and brought down on the anvil (0.7 s a strike), the left hand
      // holding the tongs on the anvil; a stance with the knees soft, a little bounce on each strike
      const k = (s / 0.7) % 1;
      const up = k < 0.55 ? k / 0.55 : Math.max(0, 1 - (k - 0.55) / 0.15);
      const e = up * up * (3 - 2 * up);
      p.armR.x = 0.55 + e * 1.9; p.armR.z = 0.18; p.elbowR = 0.35 + e * 1.1;
      p.armL.x = 0.75; p.armL.z = 0.05; p.elbowL = 0.75;
      p.lean = 0.24 - e * 0.1;
      p.legL.x = 0.2; p.legR.x = -0.15; p.kneeL = 0.22; p.kneeR = 0.12;
      const hit = k >= 0.7 && k < 0.82 ? 1 - (k - 0.7) / 0.12 : 0;
      p.bob = -0.015 - hit * 0.02; p.squash = -hit * 0.02;
      p.headX = 0.28;
      break;
    }
    case "stir": {
      // Nấu thuốc: the long spoon in both hands, stirring the cauldron in big slow circles, leaning over the steam
      const a = s * TAU * 0.8;
      p.lean = 0.2 + Math.sin(a) * 0.04;
      p.armR.x = 1.0 + Math.sin(a) * 0.22; p.armR.z = 0.12 + Math.cos(a) * 0.18; p.elbowR = 0.75 + Math.cos(a) * 0.15;
      p.armL.x = 0.9 + Math.sin(a) * 0.22; p.armL.z = 0.02 - Math.cos(a) * 0.12; p.elbowL = 0.95;
      p.roll = Math.cos(a) * 0.04;
      p.kneeL = p.kneeR = 0.1;
      p.headX = 0.3; p.headZ = Math.cos(a) * 0.05;
      p.bob = Math.sin(a * 2) * 0.005;
      break;
    }
    case "sort": {
      // Phân loại: the nia (round tray) held out in both hands, tipped left (good grain) and right (pebbles) in turn
      const w = Math.sin(s * TAU * 0.9), j = Math.sin(s * TAU * 5) * 0.03;
      p.armL.x = p.armR.x = 0.9 + j; p.armL.z = p.armR.z = 0.18;
      p.elbowL = 0.9 + w * 0.25; p.elbowR = 0.9 - w * 0.25;
      p.roll = w * 0.05; p.lean = 0.12;
      p.headX = 0.3; p.headZ = w * 0.08;
      p.kneeL = p.kneeR = 0.08;
      break;
    }
    case "dance": {
      // a happy chibi dance: hips swaying, arms pumping overhead in turn, a hop on every beat (2 beats/s)
      const b = s * TAU * 1.0, w = Math.sin(b), hop = Math.abs(Math.sin(b * 2));
      p.bob = hop * 0.07; p.squash = (hop - 0.5) * 0.04;
      p.roll = w * 0.12; p.headZ = -w * 0.15;
      p.armL.x = 0.4; p.armR.x = 0.4;
      p.armL.z = 1.6 + Math.max(0, w) * 0.9; p.armR.z = 1.6 + Math.max(0, -w) * 0.9;
      p.elbowL = 0.6 + Math.max(0, -w) * 0.9; p.elbowR = 0.6 + Math.max(0, w) * 0.9;
      p.legL.x = Math.max(0, w) * 0.5; p.kneeL = Math.max(0, w) * 0.9;
      p.legR.x = Math.max(0, -w) * 0.5; p.kneeR = Math.max(0, -w) * 0.9;
      p.legL.z = p.legR.z = 0.08;
      p.face = "happy";
      break;
    }
    case "clap": {
      // 👏: both hands meeting in front of the chest, three claps a second
      const c = Math.abs(Math.sin(s * TAU * 1.5));
      p.armL.x = p.armR.x = 1.05; p.armL.z = p.armR.z = -0.12 + c * 0.42;
      p.elbowL = p.elbowR = 1.1;
      p.bob = (1 - c) * 0.012; p.headX = -0.06;
      p.face = "happy";
      break;
    }
    case "card_hold": {
      // at the table: the hand of cards fanned in the left hand at the chest, the right hand resting on the table
      seated(p);
      const b = Math.sin(s * TAU * 0.3);
      p.armL.x = 0.95; p.armL.z = -0.05; p.elbowL = 1.35;
      p.armR.x = 0.75; p.armR.z = 0.1; p.elbowR = 0.7;
      p.lean = 0.08; p.headX = 0.22 + b * 0.03; p.bob = b * 0.005;
      break;
    }
    case "card_play": {
      // playing a card: the right hand takes one from the fan and lays it down in the middle (1.4 s a play)
      seated(p);
      const k = (s / 1.4) % 1, e = Math.sin(Math.min(1, k / 0.6) * Math.PI);
      p.armL.x = 0.95; p.armL.z = -0.05; p.elbowL = 1.35;
      p.armR.x = 0.8 + e * 0.55; p.armR.z = 0.05 - e * 0.1; p.elbowR = 1.2 - e * 0.85;
      p.lean = 0.1 + e * 0.12; p.headX = 0.25;
      break;
    }
    case "card_deal": {
      // dealing round the table: the deck in the left hand, the right flicking cards out left, ahead, right
      seated(p);
      const k = (s / 0.45) % 1, f = Math.sin(k * Math.PI), dir = Math.sin(s * TAU * 0.35);
      p.armL.x = 0.9; p.armL.z = -0.08; p.elbowL = 1.3;
      p.armR.x = 0.95 + f * 0.35; p.armR.z = 0.1 + dir * 0.35; p.elbowR = 1.0 - f * 0.6;
      p.lean = 0.1; p.headX = 0.2; p.headZ = -dir * 0.1;
      break;
    }
    case "card_win": {
      // won the hand: both fists up, a bounce in the seat
      seated(p);
      const b = Math.abs(Math.sin(s * TAU * 1.6));
      p.armL.x = p.armR.x = 0.3; p.armL.z = p.armR.z = 2.5; p.elbowL = p.elbowR = 0.5 + b * 0.3;
      p.bob = b * 0.05; p.lean = -0.1; p.headX = -0.2;
      p.face = "happy";
      break;
    }
    case "pillion": {
      // ngồi sau xe ôm: astride the pillion, knees bent onto the pegs, the hands holding the driver's waist
      const b = Math.abs(Math.sin(s * TAU * 1.2));
      p.drop = 0.24;
      p.legL.x = p.legR.x = 1.2; p.legL.z = p.legR.z = 0.36;
      p.kneeL = p.kneeR = 1.6; p.ankleL = p.ankleR = 0.2;
      p.armL.x = p.armR.x = 0.95; p.armL.z = p.armR.z = 0.32; p.elbowL = p.elbowR = 0.85;
      p.lean = 0.05; p.bob = b * 0.035; p.headZ = 0.06;
      break;
    }
  }
}

/** The acts' Vietnamese names (the dev lab, the review sheet). */
export const EXTRA_ACT_LABEL: Record<ExtraAct, string> = {
  hammer: "Rèn (búa + đe)", stir: "Nấu thuốc (khuấy vạc)", sort: "Phân loại (sàng nia)", dance: "Nhảy múa", clap: "Vỗ tay",
  card_hold: "Cầm bài", card_play: "Đánh bài", card_deal: "Chia bài", card_win: "Thắng ván", pillion: "Ngồi sau xe ôm",
};
