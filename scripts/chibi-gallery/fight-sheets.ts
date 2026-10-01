import { fightPose3D, fightPoseAt } from "@/lib/game/diorama/character/fight-pose";
import { fightLook } from "@/lib/game/diorama/character/fight-preview";
import { ENEMIES, enemyFighterPoses, type EnemyAnim } from "@/lib/game/diorama/world/enemies";
import { MARTIAL } from "@/lib/game/fight/dojo";
import { MOVES_PER_STYLE, MV_HK, MV_HP, MV_LK, MV_LP } from "@/lib/game/fight/moves";
import { moveKeys, specialPoseIds, stancePoseIds } from "@/lib/game/fight/render/poses";
import { STYLE_KEYS, STYLE_NAMES } from "@/lib/game/fight/styles";
import type { Look } from "@/lib/game/types";
import type { Sheet, Tile } from "./sheets";

// 3D wave 2 review sheets: each style's stance, key moves and a kata strip on the 3D chibi; each foe's idle / attack.

const BASE: Look = { skin: "warm", hair: "short", hairColor: "black", hat: null, top: "top_tee_white", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white", neck: null, gender: "nam" };
const SIDE = Math.PI / 2 - 0.5;

export function fightSheets(): Sheet[] {
  const sheets: Sheet[] = [];
  STYLE_KEYS.forEach((key, style) => {
    const m = MARTIAL.find((x) => x.id === style);
    const look = fightLook(m?.masterLook ?? BASE, style, 4);
    const t = (id: string, label: string): Tile => ({ look, label: `${label} [${id}]`, yaw: SIDE, pose: fightPose3D(id) });
    const mk = (mv: number) => moveKeys(style * MOVES_PER_STYLE + mv)[1];
    const tiles: Tile[] = [
      ...stancePoseIds(style).slice(0, 2).map((id, i) => t(id, `thủ thế ${i + 1}`)),
      t(mk(MV_LP), "đấm nhẹ"), t(mk(MV_HP), "đấm mạnh"), t(mk(MV_LK), "đá nhẹ"), t(mk(MV_HK), "đá mạnh"),
      t("guard", "đỡ"), t("hit_mid", "trúng đòn"), t("block", "chặn"), t("down0", "ngã (KO)"), t("win", "thắng"), t("lose", "thua"),
    ];
    while (tiles.length % 8) tiles.push(t("idle0", "nghỉ"));
    // the kata strip: the master's sequence (stance, then every special's keys), with an eased in-between per pair
    const kata = [...stancePoseIds(style), ...[1, 2, 3, 4, 5].flatMap((s) => specialPoseIds(style, s))].slice(0, 16);
    kata.forEach((id, i) => {
      tiles.push(t(id, `quyền ${i + 1}`));
      if (i % 2 === 1 && i + 1 < kata.length) tiles.push({ look, label: `quyền ${i + 1}→${i + 2} (nội suy)`, yaw: SIDE, pose: fightPoseAt([id, kata[i + 1]], 0.65, 1) });
    });
    sheets.push({ name: `w2-style-${key}`, title: `${STYLE_NAMES[key]} — thủ thế, đòn chính, bài quyền (3D)`, cols: 8, tw: 200, th: 250, tiles });
  });
  const anims: [EnemyAnim, number, string][] = [["idle", 0.6, "nghỉ"], ["attack", 0.3, "lấy đà"], ["attack", 0.48, "tấn công"], ["hit", 0.08, "trúng đòn"], ["die", 1.2, "gục"]];
  const tiles: Tile[] = [];
  for (const e of ENEMIES) for (const [a, at, lab] of anims) {
    if (e.kind === "creature") tiles.push({ look: BASE, label: `${e.name} · ${lab} [${e.id}]`, yaw: 0.9, enemy: { id: e.id, anim: a, t: at } });
    else tiles.push({ look: fightLook(e.look, e.style, 4), label: `${e.name} · ${lab} [${e.id}]`, yaw: SIDE, pose: fightPoseAt(enemyFighterPoses(e.id, a), at * 4, 0.3) });
  }
  sheets.push({ name: "w2-enemies", title: "Đối thủ 3D — nghỉ / tấn công / trúng đòn / gục", cols: 5, tw: 260, th: 260, tiles });
  return sheets;
}
