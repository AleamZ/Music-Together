"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { HAIR_COLOR_LABEL, HAIR_STYLE_LABEL, SKIN_LABEL } from "@/lib/game/art/palettes";
import { ChibiFactory } from "@/lib/game/diorama/character/build";
import { LOOK_SLOTS, wearableIds, wearing, type LookSlot } from "@/lib/game/diorama/character/catalog";
import { CHAR_ACTS, poseAt, type CharAct } from "@/lib/game/diorama/character/pose";
import { ChibiRig } from "@/lib/game/diorama/character/rig";
import { chibiSpec } from "@/lib/game/diorama/character/spec";
import { ANH_HAI_LOOK, CHU_TAM_LOOK, CHU_TU_LOOK, CO_BA_LOOK, CO_UT_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { GENDERS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from "@/lib/game/types";

// Dev only (/dev/diorama): the 3D chibi lab — pick a look from the real catalog art and an action, watch the model
// turn and animate; below, a line-up of sample looks (the pond's NPCs and some catalog outfits).

const ACT_LABEL: Record<CharAct, string> = {
  idle: "Đứng thở", walk: "Đi bộ", run: "Chạy", sit: "Ngồi", cast: "Quăng cần", reel: "Kéo cần", swim: "Bơi", ride: "Cưỡi xe", wave: "Vẫy tay",
};
const SLOT_LABEL: Record<LookSlot, string> = {
  hat: "Mũ", top: "Áo", bottom: "Quần/váy", outfit: "Bộ đồ", shoes: "Giày", neck: "Cổ", wrist: "Cổ tay", hairpin: "Kẹp tóc",
};

const BASE: Look = { skin: "light", hair: "short", hairColor: "black", hat: null, top: null, bottom: null, shoes: "shoes_dep_blue", neck: null };
export const SAMPLE_LOOKS: readonly { name: string; look: Look; act: CharAct }[] = [
  { name: "Mặc định", look: DEFAULT_LOOK, act: "walk" },
  { name: "cô Ba", look: CO_BA_LOOK, act: "idle" },
  { name: "chú Tư", look: CHU_TU_LOOK, act: "cast" },
  { name: "chú Tám", look: CHU_TAM_LOOK, act: "reel" },
  { name: "anh Hai", look: ANH_HAI_LOOK, act: "run" },
  { name: "cô Út", look: CO_UT_LOOK, act: "wave" },
  { name: "Vovinam", look: { ...BASE, skin: "tan", hair: "buzz", outfit: "vp_vovinam", belt: 3, shoes: "shoes_dep_brown" }, act: "idle" },
  { name: "Áo dài", look: { ...BASE, gender: "nu", hair: "long", hairColor: "darkbrown", outfit: "fm_ao_dai", hat: "hat_nonla_hue", shoes: "fm_sandals", hairpin: "acc_flower_clip" }, act: "walk" },
  { name: "Hoodie", look: { ...BASE, skin: "deep", hair: "curly", hairColor: "brown", top: "fm_hoodie", bottom: "fm_cargo_shorts", shoes: "fm_sneakers", hat: "hat_cap", wrist: "acc_watch" }, act: "run" },
  { name: "Váy maxi", look: { ...BASE, gender: "nu", hair: "twin_braids", hairColor: "pink", outfit: "fm_maxi_dress", hat: "hat_sunhat", neck: "acc_necklace_pearl" }, act: "sit" },
  { name: "Cao bồi", look: { ...BASE, skin: "warm", hair: "undercut", hairColor: "blonde", top: "fm_denim_jacket", bottom: "fm_rolled_jeans", shoes: "fm_boots", hat: "hat_straw_cowboy" }, act: "ride" },
  { name: "Tắm ao", look: { ...BASE, gender: "nu", hair: "bun", hairColor: "silver", skin: "warm", hat: "hat_crown", hairpin: null }, act: "swim" },
];

interface Mounted { scene: THREE.Scene; camera: THREE.PerspectiveCamera; factory: ChibiFactory; stop: () => void }

/** A small lit scene on a canvas; `tick` runs every frame (seconds). */
function mount(canvas: HTMLCanvasElement, camPos: THREE.Vector3, target: THREE.Vector3, ground: number, tick: (t: number) => void): Mounted {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe8d8);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x5a7a3a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -ground, right: ground, top: ground, bottom: -ground });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ground, 32), new THREE.MeshLambertMaterial({ color: 0x8fbf6a }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.copy(camPos);
  camera.lookAt(target);
  const factory = new ChibiFactory();
  let raf = 0;
  const loop = (ms: number) => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    tick(ms / 1000);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return {
    scene, camera, factory,
    stop: () => {
      cancelAnimationFrame(raf);
      factory.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

function CharacterLab() {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [act, setAct] = useState<CharAct>("idle");
  const [spin, setSpin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => wearableIds(), []);
  const stateRef = useRef({ look, act, spin });
  useEffect(() => { stateRef.current = { look, act, spin }; });

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    let m: Mounted;
    let rig: ChibiRig | null = null, key = "", lookKey = "", yaw = 0, last = 0;
    try {
      m = mount(canvas, new THREE.Vector3(0, 2.2, 6.2), new THREE.Vector3(0, 1.15, 0), 3, (t) => {
        const s = stateRef.current;
        if (!rig) { rig = new ChibiRig(m.factory.material); m.scene.add(rig.root); }
        const spec = chibiSpec(s.look);
        if (spec.key !== lookKey) {
          if (key) m.factory.release(key);
          const got = m.factory.acquire(spec, "high");
          key = got.key; lookKey = spec.key;
          rig.setParts(got.parts);
        }
        const dt = last ? Math.min(0.1, t - last) : 0;
        last = t;
        if (s.spin) yaw += dt * 0.8;
        rig.root.rotation.y = yaw;
        rig.root.position.y = s.act === "swim" ? 0.5 : 0;
        rig.apply(poseAt(s.act, t));
      });
    } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : "WebGL không dùng được"));
      return;
    }
    return () => m.stop();
  }, []);

  useEffect(() => {
    const canvas = gridRef.current;
    if (!canvas) return;
    let m: Mounted;
    const rigs: ChibiRig[] = [];
    try {
      m = mount(canvas, new THREE.Vector3(0, 4.2, 11.5), new THREE.Vector3(0, 0.9, 0), 9, (t) => {
        if (!rigs.length) {
          SAMPLE_LOOKS.forEach((s, i) => {
            const r = new ChibiRig(m.factory.material);
            r.setParts(m.factory.acquire(chibiSpec(s.look), "high").parts);
            const col = i % 6, row = Math.floor(i / 6);
            r.root.position.set((col - 2.5) * 2.2 + row * 1.1, s.act === "swim" ? 0.5 : 0, (row - 0.5) * 3.6);
            m.scene.add(r.root);
            rigs.push(r);
          });
        }
        rigs.forEach((r, i) => {
          r.root.rotation.y = Math.sin(t * 0.5 + i) * 0.7;
          r.apply(poseAt(SAMPLE_LOOKS[i].act, t, i * 0.37));
        });
      });
    } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : "WebGL không dùng được"));
      return;
    }
    return () => m.stop();
  }, []);

  const sel = "rounded border border-stone-300 bg-white px-1 py-0.5 text-xs";
  const pick = (label: string, value: string, options: readonly (readonly [string, string])[], on: (v: string) => void) => (
    <label key={label} className="flex items-center justify-between gap-2 text-xs">
      <span className="text-stone-600">{label}</span>
      <select className={`${sel} max-w-[11rem]`} value={value} onChange={(e) => on(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <section className="mx-auto w-full max-w-5xl p-4 text-stone-800" data-testid="character-lab">
      <h2 className="mb-2 text-lg font-bold">Phòng thử nhân vật 3D</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-4 md:flex-row">
        <canvas ref={mainRef} className="h-[420px] w-full rounded-lg border border-stone-300 md:w-[360px]" />
        <div className="grid flex-1 grid-cols-1 content-start gap-1.5 sm:grid-cols-2">
          {pick("Hành động", act, CHAR_ACTS.map((a) => [a, ACT_LABEL[a]] as const), (v) => setAct(v as CharAct))}
          {pick("Dáng", look.gender ?? "nam", GENDERS.map((g) => [g, g === "nu" ? "Nữ" : "Nam"] as const), (v) => setLook({ ...look, gender: v as Look["gender"] }))}
          {pick("Da", look.skin, SKIN_TONES.map((s) => [s, SKIN_LABEL[s]] as const), (v) => setLook({ ...look, skin: v as Look["skin"] }))}
          {pick("Kiểu tóc", look.hair, HAIR_STYLES.map((s) => [s, HAIR_STYLE_LABEL[s]] as const), (v) => setLook({ ...look, hair: v as Look["hair"] }))}
          {pick("Màu tóc", look.hairColor, HAIR_COLORS.map((s) => [s, HAIR_COLOR_LABEL[s]] as const), (v) => setLook({ ...look, hairColor: v as Look["hairColor"] }))}
          {LOOK_SLOTS.map((slot) => pick(
            SLOT_LABEL[slot],
            (slot === "shoes" ? look.shoes : (look[slot] ?? "")) as string,
            [...(slot === "shoes" ? [] : [["", "— không —"] as const]), ...ids[slot].map((id) => [id, id] as const)],
            (v) => setLook(wearing(look, slot, v || null)),
          ))}
          {look.outfit?.startsWith("vp_") && pick("Đai", String(look.belt ?? 0), [0, 1, 2, 3, 4].map((b) => [String(b), `Cấp ${b}`] as const), (v) => setLook({ ...look, belt: Number(v) }))}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Xoay</label>
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            {SAMPLE_LOOKS.slice(0, 6).map((s) => (
              <button key={s.name} type="button" className="rounded bg-stone-200 px-2 py-0.5 text-xs" onClick={() => setLook(s.look)}>{s.name}</button>
            ))}
          </div>
        </div>
      </div>
      <h3 className="mb-1 mt-4 text-sm font-semibold">12 kiểu mẫu</h3>
      <canvas ref={gridRef} className="h-[380px] w-full rounded-lg border border-stone-300" />
      <p className="mt-1 text-xs text-stone-500">{SAMPLE_LOOKS.map((s) => `${s.name} (${ACT_LABEL[s.act]})`).join(" · ")}</p>
    </section>
  );
}

/** The lab as an overlay over the diorama preview: a corner button (or the URL hash #lab) opens it. */
export default function CharacterLabPanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#lab") queueMicrotask(() => setOpen(true));
  }, []);
  if (!open) {
    return (
      <button type="button" className="fixed right-2 bottom-2 z-20 rounded bg-amber-200 px-3 py-1.5 text-sm font-semibold text-stone-900 shadow" onClick={() => setOpen(true)}>
        Phòng thử nhân vật 3D
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-stone-100/95">
      <button type="button" className="fixed top-2 right-2 z-40 rounded bg-stone-800 px-3 py-1 text-sm text-white" onClick={() => setOpen(false)}>Đóng</button>
      <CharacterLab />
    </div>
  );
}