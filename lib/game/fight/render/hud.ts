// v20 Võ đài: the arena HUD (spec §v20.1 "HUD"): HP bars with a yellow damage trail, the round timer, round pips,
// energy bars segmented at 250 with "TK" lit at 1000, and the big "K.O." letters. The Vietnamese banners and the
// combo counter are HTML over the canvas, from hudText (pure).

import {
  ENERGY_MAX, F_CHITS, F_EN, F_HP, F_HPMAX, F_WINS, G_LAST, G_LEFT, G_NEED, G_PHASE, G_RESULT, G_ROUND, G_TIMER,
  ROUND_FRAMES, PH_END, PH_FIGHT, PH_INTRO, PH_OVER, REASON_KO, REASON_TIME, RESULT_DRAW, END_FRAMES, fb, type State,
} from "../engine";
import { drawText, textWidth } from "./font";
import type { PixelCtx } from "./rig";

export const ARENA_W = 384;
export const ARENA_H = 216;
const BAR_W = 160;
const EN_W = 120;
const INK = "#1a1216";
const BAR_BG = "#40242a";
const HP = "#5fcf55";
const HP_LOW = "#e5533d";
const TRAIL = "#f3d23c";
const EN = "#56a8ff";
const EN_FULL = "#ffd24a";
const PIP = "#ffd24a";
const PIP_OFF = "#5a4a3e";

/** Seconds on the round timer. */
export const timerSeconds = (s: State): number => Math.max(0, Math.ceil(s[G_TIMER] / 60));

/** The damage trail: it holds for 20 frames after a hit, then catches up (render-only). */
export class TrailTracker {
  private shown = [0, 0];
  private last = [0, 0];
  private hold = [0, 0];
  update(s: State): readonly number[] {
    for (let side = 0; side < 2; side++) {
      const hp = s[fb(side) + F_HP];
      if (hp < this.last[side]) this.hold[side] = 20;
      else if (this.hold[side] > 0) this.hold[side] -= 1;
      else this.shown[side] = Math.max(hp, this.shown[side] - 8);
      if (hp > this.shown[side]) this.shown[side] = hp;
      this.last[side] = hp;
    }
    return this.shown;
  }
}

function frame(c: PixelCtx, x: number, y: number, w: number, h: number): void {
  c.fillStyle = INK;
  c.fillRect(x - 1, y - 1, w + 2, h + 2);
  c.fillStyle = BAR_BG;
  c.fillRect(x, y, w, h);
}

/** Paints the bars, the timer, the pips, the energy and (after a KO) the big letters. */
export function paintHud(c: PixelCtx, s: State, trail: readonly number[], reduced: boolean): void {
  for (let side = 0; side < 2; side++) {
    const b = fb(side);
    const max = s[b + F_HPMAX];
    const hp = Math.max(0, s[b + F_HP]);
    const w = Math.round((hp * BAR_W) / max);
    const tw = Math.round((Math.max(hp, trail[side] ?? hp) * BAR_W) / max);
    const x = side === 0 ? 12 : ARENA_W - 12 - BAR_W;
    frame(c, x, 8, BAR_W, 8);
    // P1's bar drains toward the centre from the left edge; P2's mirrors it
    c.fillStyle = TRAIL;
    if (side === 0) c.fillRect(x + BAR_W - tw, 8, tw, 8);
    else c.fillRect(x, 8, tw, 8);
    c.fillStyle = hp * 4 < max ? HP_LOW : HP;
    if (side === 0) c.fillRect(x + BAR_W - w, 8, w, 8);
    else c.fillRect(x, 8, w, 8);
    c.fillStyle = "#ffffff55";
    if (side === 0) c.fillRect(x + BAR_W - w, 8, w, 2);
    else c.fillRect(x, 8, w, 2);
    // round pips
    const need = s[G_NEED];
    for (let i = 0; i < need; i++) {
      const px = side === 0 ? x + BAR_W - 6 - i * 8 : x + i * 8 + 1;
      c.fillStyle = INK;
      c.fillRect(px - 1, 19, 7, 5);
      c.fillStyle = s[b + F_WINS] > i ? PIP : PIP_OFF;
      c.fillRect(px, 20, 5, 3);
    }
    // energy, segmented at 250
    const en = s[b + F_EN];
    const ex = side === 0 ? 12 : ARENA_W - 12 - EN_W;
    frame(c, ex, 205, EN_W, 5);
    const ew = Math.round((en * EN_W) / ENERGY_MAX);
    c.fillStyle = en >= ENERGY_MAX ? EN_FULL : EN;
    if (side === 0) c.fillRect(ex, 205, ew, 5);
    else c.fillRect(ex + EN_W - ew, 205, ew, 5);
    c.fillStyle = INK;
    for (let k = 1; k < 4; k++) c.fillRect(ex + (k * EN_W) / 4, 205, 1, 5);
    const tkx = side === 0 ? ex + EN_W + 4 : ex - 4 - textWidth("TK");
    drawText(c, "TK", tkx, 205, en >= ENERGY_MAX ? EN_FULL : "#6b5a4c", 1, INK);
  }
  // the timer
  const secs = s[G_PHASE] === PH_INTRO && s[G_ROUND] === 1 ? 99 : timerSeconds(s);
  const t = String(Math.min(99, secs)).padStart(2, "0");
  c.fillStyle = INK;
  c.fillRect(ARENA_W / 2 - 13, 4, 26, 16);
  c.fillStyle = "#2c1d24";
  c.fillRect(ARENA_W / 2 - 12, 5, 24, 14);
  drawText(c, t, ARENA_W / 2 - Math.floor(textWidth(t, 2) / 2), 7, secs <= 10 && s[G_PHASE] === PH_FIGHT ? "#ff6a4d" : "#fff4d8", 2);
  // K.O.
  if (s[G_PHASE] === PH_END && s[G_LAST] >> 2 === REASON_KO && s[G_LEFT] > 20) {
    const scale = reduced ? 8 : Math.min(8, 4 + Math.max(0, END_FRAMES - s[G_LEFT]) / 3);
    const sc = Math.floor(scale);
    const w = textWidth("K.O.", sc);
    drawText(c, "K.O.", Math.floor(ARENA_W / 2 - w / 2), Math.floor(80 - (5 * sc) / 2), "#ff3b2f", sc, INK);
  }
}

export interface HudText {
  /** The big banner ("Hiệp 1", "Đấu!", "Hết giờ!", "Hòa!", "… thắng!"), or null. */
  banner: string | null;
  /** The line beneath it ("Hạ đo ván!"). */
  sub: string | null;
  /** The combo counter shown on each side ("3 đòn!"): the hits that side's attacker has chained. */
  combo: [string | null, string | null];
}

/** The copy the overlay shows over the canvas (pure). */
export function hudText(s: State, names: readonly [string, string]): HudText {
  const phase = s[G_PHASE];
  let banner: string | null = null, sub: string | null = null;
  if (phase === PH_INTRO) {
    banner = s[G_LEFT] > 30 ? `Hiệp ${s[G_ROUND]}` : "Đấu!";
  } else if (phase === PH_FIGHT && s[G_TIMER] > ROUND_FRAMES - 30) {
    banner = "Đấu!";
  } else if (phase === PH_END) {
    const last = s[G_LAST], reason = last >> 2, winner = last & 3;
    if (reason === REASON_KO) {
      sub = winner === 0 ? "Hòa! Cả hai cùng gục" : "Hạ đo ván!";
    } else if (reason === REASON_TIME) {
      banner = "Hết giờ!";
      sub = winner === 0 ? "Hòa!" : `${names[winner - 1]} thắng hiệp này`;
    }
  } else if (phase === PH_OVER) {
    const r = s[G_RESULT];
    banner = r === RESULT_DRAW ? "Hòa!" : `${names[r - 1]} thắng!`;
  }
  const combo: [string | null, string | null] = [null, null];
  for (let side = 0; side < 2; side++) {
    const hitsOnFoe = s[fb(1 - side) + F_CHITS];
    if (hitsOnFoe >= 2) combo[side] = `${hitsOnFoe} đòn!`;
  }
  return { banner, sub, combo };
}
