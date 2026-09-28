"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MARTIAL } from "@/lib/game/fight/dojo";
import { MOVES_PER_STYLE, MV_HK, MV_HP, MV_LK, MV_LP } from "@/lib/game/fight/moves";
import { paintArena } from "@/lib/game/fight/render/arena-art";
import { paintChibiFighter } from "@/lib/game/fight/render/chibi";
import { readFighterArt, writeFighterArt, type FighterArt } from "@/lib/game/fight/render/fighter-art";
import { GROUND_Y } from "@/lib/game/fight/render/fx";
import { ARENA_H, ARENA_W } from "@/lib/game/fight/render/hud";
import { RIG_H, RIG_W, moveKeys, poseData, specialPoseIds, stancePoseIds, type PoseId } from "@/lib/game/fight/render/poses";
import { paintFighter, type FighterLook } from "@/lib/game/fight/render/rig";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";

// Dev only (app/dev/fighter-art): the v20 fighters side by side — the 48 × 64 rig and the chibi prototype
// (lib/game/fight/render/chibi.ts) — in the same poses, a few looks and uniforms, both facings, and in the arena at
// the real scale. The switch at the top picks the painter real fights use in this browser (fighter-art.ts).

const LOOKS: readonly { name: string; look: Look }[] = [
  { name: "Mặc định", look: { ...DEFAULT_LOOK, hat: null, neck: null } },
  ...MARTIAL.map((m) => ({ name: m.master, look: m.masterLook })),
];

const STYLES: readonly { id: number; name: string }[] = [{ id: 0, name: "Tự do" }, ...MARTIAL.map((m) => ({ id: m.id, name: m.name }))];

/** The in-game switch: this page's own writes, and other tabs' (the storage event). */
const artListeners = new Set<() => void>();
function subscribeArt(cb: () => void): () => void {
  artListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    artListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** The rows of the comparison: a name and the keyframes shown (cycled). */
function rowsFor(style: number): { name: string; poses: PoseId[] }[] {
  const move = (i: number) => [...moveKeys(style * MOVES_PER_STYLE + i)];
  return [
    { name: "Đứng tấn", poses: stancePoseIds(style) },
    { name: "Thủ", poses: ["guard", "cguard"] },
    { name: "Đi", poses: ["walk0", "walk1", "walk2", "walk3"] },
    { name: "Ngồi", poses: ["crouch"] },
    { name: "Nhảy", poses: ["prejump", "jump0", "jump1", "jump2", "land"] },
    { name: "Đấm nhẹ", poses: move(MV_LP) },
    { name: "Đấm mạnh", poses: move(MV_HP) },
    { name: "Đá nhẹ", poses: move(MV_LK) },
    { name: "Đá mạnh", poses: move(MV_HK) },
    { name: "Đỡ đòn", poses: ["block", "cblock"] },
    { name: "Trúng đòn", poses: ["hit_high", "hit_mid", "hit_low"] },
    { name: "Ngã", poses: ["fall", "down0", "down1", "getup0", "getup1"] },
    { name: "Tuyệt chiêu 1", poses: specialPoseIds(style, 1) },
    { name: "Tuyệt kỹ", poses: specialPoseIds(style, 5) },
  ];
}

function paintOne(ctx: CanvasRenderingContext2D, art: FighterArt, pose: PoseId, fl: FighterLook, x: number, y: number, flip: boolean): void {
  if (art === "chibi") paintChibiFighter(ctx, pose, fl, x, y, flip);
  else paintFighter(ctx, poseData(pose, fl.style), fl, x, y, flip);
}

/** One fighter on a small canvas, cycling through `poses` (or showing `still`). */
function Fighter({ art, fl, poses, flip = false, scale, animate, still }: {
  art: FighterArt;
  fl: FighterLook;
  poses: readonly PoseId[];
  flip?: boolean;
  scale: number;
  animate: boolean;
  still?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = poses.join(",");
  useEffect(() => {
    const ctx = ref.current?.getContext("2d") ?? null;
    const list = key.split(",");
    if (!ctx || list.length === 0) return;
    ctx.imageSmoothingEnabled = false;
    const draw = (i: number) => {
      ctx.clearRect(0, 0, RIG_W, RIG_H);
      ctx.fillStyle = "#00000033";
      ctx.fillRect(12, RIG_H - 1, 24, 1);
      paintOne(ctx, art, list[i % list.length], fl, 0, 0, flip);
    };
    if (still !== undefined || !animate) {
      draw(still ?? Math.floor(list.length / 2));
      return;
    }
    let i = 0;
    draw(0);
    const id = window.setInterval(() => draw(++i), 220);
    return () => window.clearInterval(id);
  }, [art, fl, key, flip, animate, still]);
  return (
    <canvas
      ref={ref}
      width={RIG_W}
      height={RIG_H}
      title={`${art} · ${poses[still ?? 0] ?? ""}`}
      className="rounded-sm bg-[#e9dfc7]"
      style={{ width: RIG_W * scale, height: RIG_H * scale, imageRendering: "pixelated" }}
    />
  );
}

/** Two fighters in the arena at the real scale (as a fight draws them), cycling a punch, a kick and the stance. */
function ArenaShot({ art, a, b, animate }: { art: FighterArt; a: FighterLook; b: FighterLook; animate: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d") ?? null;
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const seqA = [...stancePoseIds(a.style), ...moveKeys(a.style * MOVES_PER_STYLE + MV_HP), ...moveKeys(a.style * MOVES_PER_STYLE + MV_HK)];
    const seqB = ["guard", "guard", "block", "block", "hit_mid", "hit_mid", "guard", "guard"];
    const draw = (i: number) => {
      paintArena(ctx, "dojo", i * 8, !animate);
      const y = GROUND_Y - RIG_H + 1;
      for (const [x, fl, pose, flip] of [[150, a, seqA[i % seqA.length], false], [210, b, seqB[i % seqB.length], true]] as const) {
        ctx.fillStyle = "#00000055";
        ctx.fillRect(x - RIG_W / 2 + 12, GROUND_Y - 1, 24, 2);
        paintOne(ctx, art, pose, fl, x - RIG_W / 2, y, flip);
      }
    };
    if (!animate) {
      draw(0);
      return;
    }
    let i = 0;
    draw(0);
    const id = window.setInterval(() => draw(++i), 260);
    return () => window.clearInterval(id);
  }, [art, a, b, animate]);
  return (
    <canvas
      ref={ref}
      width={ARENA_W}
      height={ARENA_H}
      className="block max-w-full"
      style={{ width: ARENA_W * 2, imageRendering: "pixelated" }}
    />
  );
}

export default function FighterArtPreview() {
  const [style, setStyle] = useState(1);
  const [rank, setRank] = useState(2);
  const [lookIdx, setLookIdx] = useState(0);
  const [scale, setScale] = useState(3);
  const [animate, setAnimate] = useState(true);
  const inGame = useSyncExternalStore(subscribeArt, readFighterArt, () => "chibi" as const);

  const look = LOOKS[lookIdx]?.look ?? LOOKS[0].look;
  const fl = useMemo<FighterLook>(() => ({ look, style, rank }), [look, style, rank]);
  const foe = useMemo<FighterLook>(() => ({ look: LOOKS[(lookIdx + 3) % LOOKS.length].look, style: (style % 7) + 1, rank: 4 - rank }), [lookIdx, style, rank]);
  const rows = rowsFor(style);
  const pick = (art: FighterArt) => { writeFighterArt(art); for (const cb of artListeners) cb(); };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 text-[#2b2118]">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Võ đài — hình võ sĩ: rig hiện tại vs chibi (bản thử)</h1>
        <p className="text-sm opacity-80">
          Trang dev. Mỗi ô: rig 48 × 64 bên trái, chibi bên phải; hai hướng. Chibi lấy đầu, tóc, da, mặt của nhân vật
          thế giới và võ phục của môn phái (đai theo cấp).
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded border border-[#b89b6a] bg-[#f6ecd4] p-2" data-testid="fighter-art-switch">
          <span className="font-semibold">Trong trận (trình duyệt này):</span>
          {(["rig", "chibi"] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={inGame === a}
              className={`rounded border px-3 py-1 ${inGame === a ? "border-[#2b2118] bg-[#2b2118] text-[#f6ecd4]" : "border-[#b89b6a] bg-white"}`}
              onClick={() => pick(a)}
            >
              {a === "rig" ? "Rig (cũ)" : "Chibi (mặc định)"}
            </button>
          ))}
          <span className="text-xs opacity-70">Mở lại trận để thấy thay đổi.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">Môn
            <select className="rounded border px-1" value={style} onChange={(e) => setStyle(Number(e.target.value))}>
              {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Đai
            <select className="rounded border px-1" value={rank} onChange={(e) => setRank(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Nhân vật
            <select className="rounded border px-1" value={lookIdx} onChange={(e) => setLookIdx(Number(e.target.value))}>
              {LOOKS.map((l, i) => <option key={l.name} value={i}>{l.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Phóng
            <select className="rounded border px-1" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {[2, 3, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> Chuyển động
          </label>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Trên võ đài (đúng tỉ lệ trận đấu)</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {(["rig", "chibi"] as const).map((a) => (
            <figure key={a} className="flex flex-col gap-1">
              <ArenaShot art={a} a={fl} b={foe} animate={animate} />
              <figcaption className="text-sm opacity-80">{a === "rig" ? "Rig (cũ)" : "Chibi (mặc định)"}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Mọi võ phục (thủ · đấm mạnh · đá mạnh)</h2>
        <div className="flex flex-wrap gap-4">
          {STYLES.map((s) => {
            const f: FighterLook = { look, style: s.id, rank };
            const keys = ["guard", moveKeys(s.id * MOVES_PER_STYLE + MV_HP)[1], moveKeys(s.id * MOVES_PER_STYLE + MV_HK)[1]];
            return (
              <figure key={s.id} className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  {keys.map((_, i) => <Fighter key={`r${i}`} art="rig" fl={f} poses={keys} still={i} scale={2} animate={false} />)}
                </div>
                <div className="flex gap-1">
                  {keys.map((_, i) => <Fighter key={`c${i}`} art="chibi" fl={f} poses={keys} still={i} scale={2} animate={false} />)}
                </div>
                <figcaption className="text-sm">{s.name}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Từng động tác</h2>
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.name} className="flex flex-wrap items-center gap-3 border-b border-[#d8c7a4] pb-3">
              <span className="w-28 shrink-0 font-semibold">{r.name}</span>
              <div className="flex gap-1" title="phải">
                <Fighter art="rig" fl={fl} poses={r.poses} scale={scale} animate={animate} />
                <Fighter art="chibi" fl={fl} poses={r.poses} scale={scale} animate={animate} />
              </div>
              <div className="flex gap-1" title="trái">
                <Fighter art="rig" fl={fl} poses={r.poses} flip scale={scale} animate={animate} />
                <Fighter art="chibi" fl={fl} poses={r.poses} flip scale={scale} animate={animate} />
              </div>
              <div className="flex flex-wrap gap-1 opacity-90">
                {r.poses.map((p, i) => (
                  <div key={`${p}${i}`} className="flex flex-col gap-0.5">
                    <Fighter art="rig" fl={fl} poses={r.poses} still={i} scale={1} animate={false} />
                    <Fighter art="chibi" fl={fl} poses={r.poses} still={i} scale={1} animate={false} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
