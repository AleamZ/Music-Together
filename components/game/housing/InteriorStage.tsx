"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { readGfx, subscribeGfx, type GfxMode } from "@/lib/game/diorama/flag";
import type { Billboard } from "@/lib/game/diorama/types";
import Interior3d from "./Interior3d";
import { drawItem, setTankContents } from "@/lib/game/art/furniture";
import { WALK_CYCLE } from "@/lib/game/art/layers";
import { getCharacterFrames } from "@/lib/game/art/raster";
import type { FishRow } from "@/lib/game/fishing/state";
import { APT_TILE, footprint, furnitureOf, isSurface, itemRect, nearestUsable, type Placed } from "@/lib/game/housing/apartment";
import { joinInterior, type InteriorHandle, type InteriorMember } from "@/lib/game/housing/interior-net";
import { SLEEP_MS, type MotelState } from "@/lib/game/housing/motel";
import { facingFor, inputDir, isBlockedAt, stepMove, WALK_SPEED, type Grid, type KeyState } from "@/lib/game/movement";
import { rect, type Ctx } from "@/lib/game/maps/scene-art";
import { aquariumView } from "@/lib/game/pets/v2";
import type { Facing, Look, Vec } from "@/lib/game/types";
import AquariumPanel from "./AquariumPanel";
import FridgePanel from "./FridgePanel";
import FurnitureIcon from "./FurnitureIcon";
import TvController from "./TvController";

/** What every interior's layout has (v19.2 apartments, v19.3 houses). */
export interface StageLayout { ownerName: string; canEdit: boolean; wall: string | null; floor: string | null; items: Placed[] }

/** One kind of interior for the stage: its size, its shell, its walking grid, its decorating rules and its RPCs. */
export interface InteriorSpace<L extends StageLayout> {
  /** The realtime topic's key ("apt:3", "house:2") and the world size in px. */
  key: string;
  w: number;
  h: number;
  title: (l: L) => string;
  entry: (l: L) => Vec;
  grid: (l: L) => Grid;
  paintShell: (c: Ctx, l: L) => void;
  shellKey: (l: L) => string;
  /** The decorating grid's first tile row (the apartment's wall rows are not floor). */
  gridTop: number;
  /** Shade what I cannot furnish while decorating (optional). */
  decorShade?: (c: Ctx, l: L) => void;
  /** May I decorate here at all? */
  canDecorate: (l: L) => boolean;
  /** Why `p` cannot go there (a refusal the error texts know), or null. */
  canPlace: (l: L, p: Placed) => string | null;
  /** May I select (move, turn, store) this placed item? */
  mayPick: (l: L, p: Placed) => boolean;
  /** May I use this bed / TV / fridge? */
  mayUse: (l: L, p: Placed) => boolean;
  atDoor: (l: L, pos: Vec) => boolean;
  errText: (e: unknown) => string;
  enter: () => Promise<L>;
  place: (id: number, x: number, y: number, rot: number) => Promise<L>;
  pickup: (id: number) => Promise<L>;
  /** Wallpaper and floor (null: not mine to change). */
  surface: ((kind: "wall" | "floor", item: string | null) => Promise<L>) | null;
  sleep: (() => Promise<MotelState>) | null;
  /** The apartment whose TV plays here (null: no working TV). */
  tvNo: number | null;
}

interface Other { name: string; look: Look | null; x: number; y: number; tx: number; ty: number; f: Facing; m: boolean; walkT: number }

const KEYMAP: Record<string, keyof KeyState> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const SEND_MS = 100;
const BEAT_MS = 3000;

export interface InteriorStageProps<L extends StageLayout> {
  space: InteriorSpace<L>;
  token: string;
  roomId: string;
  me: { id: string; name: string; look: Look };
  layout: L;
  /** My furniture storage (v19.2's apartment list). */
  storage: ReadonlyArray<{ id: number; item: string }>;
  bag: readonly FishRow[];
  speciesName: (id: string) => string;
  /** A banner under the title (the knocks on an apartment's door). */
  banner?: ReactNode;
  onStorageChanged: () => void;
  onBagChanged: () => void;
  onSlept: (s: MotelState) => void;
  onDuck: (on: boolean) => void;
  onLeave: (why?: string) => void;
}

/** A walkable interior (v19.2, generalised in v19.3; spec R1–R3): the layout the server returned, everyone inside on the
 *  interior's own realtime topic, the bed (sleep), the TV and the fridge; decorating on the grid (place, turn, move,
 *  store) with the same checks as the server. The space adapter says what kind of interior it is. */
export default function InteriorStage<L extends StageLayout>(props: InteriorStageProps<L>) {
  const { space, token, roomId, me, onStorageChanged, onLeave, onSlept, onDuck } = props;
  const [layout, setLayout] = useState<L>(props.layout);
  const W = space.w, H = space.h;
  const canEdit = space.canDecorate(layout);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(3);
  const [panel, setPanel] = useState<"tv" | "fridge" | "aquarium" | null>(null);
  const [decorating, setDecorating] = useState(false);
  const [ghost, setGhost] = useState<Placed | null>(null);
  const [selected, setSelected] = useState<Placed | null>(null);
  const [near, setNear] = useState<{ id: number | null; kind: string | null; door: boolean }>({ id: null, kind: null, door: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [tvKey, setTvKey] = useState(0);
  const [tvLit, setTvLit] = useState(false);
  const [members, setMembers] = useState<InteriorMember[]>([]);

  const grid = useMemo(() => space.grid(layout), [space, layout]);
  const usable = useMemo(() => layout.items.filter((p) => space.mayUse(layout, p)), [space, layout]);
  const hasTv = space.tvNo !== null && usable.some((p) => furnitureOf(p.item)?.kind === "tv");
  const hasFridge = usable.some((p) => furnitureOf(p.item)?.kind === "fridge");
  const entry = space.entry(layout);
  // v21 (0074): the aquariums — what swims in them (the furniture art draws it) for everyone let in
  const aquaHome = useMemo(() => {
    const m = /^(apt|house):(\d+)$/.exec(space.key);
    return m ? { kind: m[1] as "apt" | "house", no: Number(m[2]) } : null;
  }, [space.key]);
  const hasAquarium = aquaHome !== null && layout.items.some((p) => furnitureOf(p.item)?.kind === "aquarium");
  const [aquaTick, setAquaTick] = useState(0);
  useEffect(() => {
    if (!aquaHome || !layout.items.some((p) => furnitureOf(p.item)?.kind === "aquarium")) { setTankContents(null); return; }
    let stop = false;
    aquariumView(token, roomId, aquaHome.kind, aquaHome.no).then((v) => {
      if (!stop) setTankContents(new Map(v.tanks.map((t) => [t.tank, { decor: t.decor, fish: t.fish }])));
    }, () => { /* not let in any more: the layout refetch handles it */ });
    return () => { stop = true; };
  }, [aquaHome, layout, token, roomId, aquaTick]);
  useEffect(() => () => setTankContents(null), []);

  // --- the live loop's state (refs: the canvas loop never goes through React)
  const pos = useRef<Vec>({ ...entry });
  const facing = useRef<Facing>("up");
  const keys = useRef<KeyState>({ up: false, down: false, left: false, right: false });
  const target = useRef<Vec | null>(null);
  const walkT = useRef(0);
  const moving = useRef(false);
  const others = useRef(new Map<string, Other>());
  const net = useRef<InteriorHandle | null>(null);
  const live = useRef({ layout, grid, usable, ghost, selected, tvLit, sleepAt, decorating, entry });
  useEffect(() => { live.current = { layout, grid, usable, ghost, selected, tvLit, sleepAt, decorating, entry }; });
  const inputOn = panel === null && sleepAt === null;
  const inputRef = useRef(inputOn);
  useEffect(() => { inputRef.current = inputOn && !decorating; }, [inputOn, decorating]);

  // --- fit the interior to the screen (whole-number pixel scale)
  useEffect(() => {
    const fit = () => setScale(Math.max(1, Math.min(5, Math.floor(Math.min((window.innerWidth - 16) / W, (window.innerHeight - 190) / H)))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [W, H]);

  // --- the interior's topic: the others inside, their steps, and change hints
  const refetch = useCallback(async () => {
    try {
      setLayout(await space.enter());
    } catch (e) {
      onLeave(space.errText(e));
    }
  }, [space, onLeave]);
  useEffect(() => {
    const at = live.current.entry;
    const h = joinInterior(roomId, { key: space.key, w: space.w, h: space.h }, { id: me.id, name: me.name, look: me.look }, (e) => {
      if (e.kind === "pos") {
        const o = others.current.get(e.pos.id);
        if (o) Object.assign(o, { tx: e.pos.x, ty: e.pos.y, f: e.pos.f, m: e.pos.m });
        else others.current.set(e.pos.id, { name: "…", look: null, x: e.pos.x, y: e.pos.y, tx: e.pos.x, ty: e.pos.y, f: e.pos.f, m: e.pos.m, walkT: 0 });
      } else if (e.kind === "members") {
        const ids = new Set(e.members.map((m) => m.id));
        for (const id of [...others.current.keys()]) if (!ids.has(id)) others.current.delete(id);
        for (const m of e.members) {
          const o = others.current.get(m.id);
          if (o) { o.name = m.name; o.look = m.look; }
          else others.current.set(m.id, { name: m.name, look: m.look, x: at.x, y: at.y, tx: at.x, ty: at.y, f: "up", m: false, walkT: 0 });
        }
        setMembers(e.members);
        // a newcomer learns where I stand
        net.current?.sendPos({ x: pos.current.x, y: pos.current.y, f: facing.current, m: false });
      } else if (e.kind === "layout") void refetch();
      else setTvKey((k) => k + 1);
    });
    net.current = h;
    return () => { net.current = null; h.close(); };
  }, [roomId, space.key, space.w, space.h, me.id, me.name, me.look, refetch]);

  // --- keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k && inputRef.current && !(e.target instanceof HTMLInputElement)) { keys.current[k] = true; target.current = null; e.preventDefault(); }
      if (e.code === "KeyR" && live.current.decorating && live.current.ghost) {
        const g = live.current.ghost;
        setGhost({ ...g, rot: (g.rot + 1) % 4 });
      }
      if (e.code === "Escape" && live.current.decorating) { setGhost(null); setSelected(null); }
    };
    const up = (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k) keys.current[k] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // after a layout change I may stand inside a new piece (or a new wall): back to the entry
  useEffect(() => {
    if (isBlockedAt(grid, pos.current.x, pos.current.y)) pos.current = { ...live.current.entry };
  }, [grid]);

  // --- the loop: walk, follow the others, draw
  useEffect(() => {
    const cv = canvasRef.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    c.imageSmoothingEnabled = false;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shell = document.createElement("canvas");
    shell.width = W; shell.height = H;
    let shellKey = "";
    let last = performance.now(), lastSent = 0, lastBeat = 0, wasMoving = false, raf = 0;
    let nearKey = "";
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const L = live.current;
      // me
      let dir = inputRef.current ? inputDir(keys.current) : { x: 0, y: 0 };
      const tg = target.current;
      if (inputRef.current && tg && dir.x === 0 && dir.y === 0) {
        const dx = tg.x - pos.current.x, dy = tg.y - pos.current.y;
        if (Math.hypot(dx, dy) < 2) target.current = null; else dir = { x: dx, y: dy };
      }
      const before = pos.current;
      const next = stepMove(L.grid, before, dir, dt, WALK_SPEED);
      const moved = Math.hypot(next.x - before.x, next.y - before.y) > 0.01;
      if (tg && !moved && dir.x !== 0) target.current = null;              // stuck against something
      pos.current = next;
      if (dir.x !== 0 || dir.y !== 0) facing.current = facingFor(dir, facing.current);
      moving.current = moved;
      walkT.current = moved ? walkT.current + dt : 0;
      if ((moved && now - lastSent > SEND_MS) || (wasMoving && !moved) || now - lastBeat > BEAT_MS) {
        net.current?.sendPos({ x: Math.round(next.x), y: Math.round(next.y), f: facing.current, m: moved });
        lastSent = now; lastBeat = now;
      }
      wasMoving = moved;
      // what I stand next to
      const n = nearestUsable(L.usable, next);
      const door = space.atDoor(L.layout, next);
      const nk = `${n?.id ?? ""}|${door}`;
      if (nk !== nearKey) { nearKey = nk; setNear({ id: n?.id ?? null, kind: n ? furnitureOf(n.item)?.kind ?? null : null, door }); }
      // the others glide to their last position
      for (const o of others.current.values()) {
        const k = Math.min(1, dt * 12);
        o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
        o.walkT = o.m ? o.walkT + dt : 0;
      }
      // draw: the shell (cached), the rugs, then furniture and people by their base
      const key = space.shellKey(L.layout);
      if (key !== shellKey) { shellKey = key; const sc = shell.getContext("2d"); if (sc) { sc.clearRect(0, 0, W, H); space.paintShell(sc, L.layout); } }
      c.clearRect(0, 0, W, H);
      c.drawImage(shell, 0, 0);
      const t = reduced ? 0 : now;
      const items = L.layout.items.filter((p) => !(L.ghost && L.ghost.id === p.id));
      for (const p of items) if (furnitureOf(p.item)?.kind === "rug") drawItem(c, p, t);
      const sprites: Array<{ y: number; draw: () => void }> = [];
      for (const p of items) {
        if (furnitureOf(p.item)?.kind === "rug") continue;
        const r = itemRect(p)!;
        sprites.push({ y: r.y + r.h, draw: () => drawItem(c, p, t, L.tvLit) });
      }
      const person = (look: Look | null, x: number, y: number, f: Facing, wt: number, name: string, mine: boolean) => {
        sprites.push({ y, draw: () => {
          if (look) {
            const fr = wt > 0 ? WALK_CYCLE[Math.floor(wt * 8) % WALK_CYCLE.length] : 0;
            c.drawImage(getCharacterFrames(look)[f][fr], Math.round(x) - 12, Math.round(y) - 46);
          } else rect(c, "#3a2418", x - 4, y - 20, 8, 20);
          c.font = "8px monospace"; c.textAlign = "center";
          c.fillStyle = "rgba(0,0,0,0.55)"; const w = Math.min(60, c.measureText(name).width + 4); c.fillRect(Math.round(x - w / 2), Math.round(y) - 56, w, 9);
          c.fillStyle = mine ? "#ffe08a" : "#ffffff"; c.fillText(name, Math.round(x), Math.round(y) - 49, 58);
        } });
      };
      if (L.sleepAt === null) person(me.look, next.x, next.y, facing.current, walkT.current, me.name, true);
      for (const o of others.current.values()) person(o.look, o.x, o.y, o.f, o.walkT, o.name, false);
      sprites.sort((a, b) => a.y - b.y);
      for (const s of sprites) s.draw();
      // decorating: the grid, the rooms I cannot furnish, the ghost (green: fits, red: not) and the selection
      if (L.decorating) {
        space.decorShade?.(c, L.layout);
        c.save(); c.globalAlpha = 0.18;
        for (let x = 0; x <= W; x += APT_TILE) rect(c, "#000", x, space.gridTop * APT_TILE, 1, H - space.gridTop * APT_TILE);
        for (let y = space.gridTop * APT_TILE; y <= H; y += APT_TILE) rect(c, "#000", 0, y, W, 1);
        c.restore();
        if (L.ghost) {
          const ok = space.canPlace(L.layout, L.ghost) === null;
          c.save(); c.globalAlpha = 0.7; drawItem(c, L.ghost, t); c.restore();
          const fp = footprint(L.ghost.item, L.ghost.rot);
          if (fp) {
            c.save(); c.globalAlpha = 0.3;
            rect(c, ok ? "#3fbf5a" : "#e03a3a", L.ghost.x * APT_TILE, L.ghost.y * APT_TILE, fp.w * APT_TILE, fp.h * APT_TILE);
            c.restore();
          }
        } else if (L.selected) {
          const r = itemRect(L.selected);
          if (r) { c.strokeStyle = "#ffe08a"; c.lineWidth = 1; c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
        }
      }
      // the sleep cutscene: the lights go down, Zzz over the bed
      if (L.sleepAt !== null) {
        const k = Math.min(1, (now - L.sleepAt) / 900);
        c.save(); c.globalAlpha = k * 0.75; rect(c, "#0a0c1e", 0, 0, W, H); c.restore();
        const bed = L.usable.find((p) => furnitureOf(p.item)?.kind === "bed");
        const r = bed ? itemRect(bed) : null;
        if (r) for (let z = 0; z < 3; z++) {
          const ph = ((now / 1400 + z / 3) % 1);
          c.fillStyle = "#ffffff"; c.font = `${ph < 0.5 ? 8 : 10}px monospace`;
          if (ph < 0.9) c.fillText("z", r.x + r.w / 2 + ph * 20 + z * 3, r.y + 8 - ph * 22);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [me.look, me.name, space, W, H]);

  // --- the sleep cutscene's end
  useEffect(() => {
    if (sleepAt === null) return;
    const id = setTimeout(() => { setSleepAt(null); setMsg("☀️ Dậy rồi! Ngủ ngon 24 giờ: đói, khát chậm hơn, đi nhanh hơn và thể lực hồi nhanh hơn."); }, SLEEP_MS);
    return () => clearTimeout(id);
  }, [sleepAt]);

  // --- actions
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg(space.errText(e)); } finally { setBusy(false); }
  }, [busy, space]);
  const changed = useCallback((l: L) => {
    setLayout(l);
    net.current?.notify("layout");
    onStorageChanged();
  }, [onStorageChanged]);
  const place = (g: Placed) => void run(async () => {
    const why = space.canPlace(layout, g);
    if (why) { setMsg(space.errText(new Error(why))); return; }
    changed(await space.place(g.id, g.x, g.y, g.rot));
    setGhost(null); setSelected(null);
  });
  const pickup = (p: Placed) => void run(async () => { changed(await space.pickup(p.id)); setSelected(null); });
  const setSurface = space.surface;
  const surface = (kind: "wall" | "floor", item: string | null) => void run(async () => { if (setSurface) changed(await setSurface(kind, item)); });
  const doSleep = space.sleep;
  const sleep = () => void run(async () => {
    if (!doSleep) return;
    const s = await doSleep();
    setSleepAt(performance.now());
    onSlept(s);
  });

  const worldAt = (e: React.PointerEvent<HTMLCanvasElement>): Vec => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const tileOf = (w: Vec, g: Placed) => {
    const fp = footprint(g.item, g.rot) ?? { w: 1, h: 1 };
    return { x: Math.round(w.x / APT_TILE - fp.w / 2), y: Math.round(w.y / APT_TILE - fp.h / 2) };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!decorating || !ghost) return;
    const t = tileOf(worldAt(e), ghost);
    if (t.x !== ghost.x || t.y !== ghost.y) setGhost({ ...ghost, ...t });
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const w = worldAt(e);
    if (!decorating) { if (inputOn) target.current = w; return; }
    if (ghost) { place({ ...ghost, ...tileOf(w, ghost) }); return; }
    const hit = [...layout.items].reverse().find((p) => {
      const r = itemRect(p);
      return r && w.x >= r.x && w.x < r.x + r.w && w.y >= r.y && w.y < r.y + r.h && space.mayPick(layout, p);
    });
    setSelected(hit ?? null);
  };

  // wave 3: the 3D mode shows the room in 3D (the 2D canvas stays for decorating)
  const gfx = useSyncExternalStore<GfxMode>(subscribeGfx, readGfx, () => "2d");
  const show3d = gfx === "3d" && !decorating;
  const people3d = useCallback((): Billboard[] => {
    const out: Billboard[] = [];
    if (live.current.sleepAt === null) out.push({ id: me.id, look: me.look, x: pos.current.x, y: pos.current.y, facing: facing.current, frame: 0, name: me.name, me: true });
    for (const [id, o] of others.current) if (o.look) out.push({ id, look: o.look, x: o.x, y: o.y, facing: o.f, frame: 0, name: o.name });
    return out;
  }, [me.id, me.look, me.name]);
  const walk3d = useCallback((w: Vec) => { if (inputRef.current) target.current = w; }, []);

  const storage = props.storage.filter((s) => !isSurface(furnitureOf(s.item)));
  const surfaces = props.storage.filter((s) => isSurface(furnitureOf(s.item)));
  const nearKind = near.kind;
  return (
    <div className="game-ui fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-[#1e1a24]/95 p-2 font-vt text-lg text-ink" data-testid="interior">
      <div className="pch flex max-w-full flex-wrap items-center gap-2 px-2 py-1">
        <span className="text-xl">{space.title(layout)}</span>
        <span className="text-base opacity-80">👥 {members.length + 1} người trong nhà</span>
        {canEdit && (
          <button type="button" className={`pch-btn px-2 py-0.5 ${decorating ? "pch-btn-primary" : ""}`}
            onClick={() => { setDecorating((d) => !d); setGhost(null); setSelected(null); }}>🛠️ {decorating ? "Xong" : "Trang trí"}</button>
        )}
        <button type="button" className="pch-btn px-2 py-0.5" disabled={sleepAt !== null} onClick={() => onLeave()}>🚪 Ra ngoài</button>
      </div>
      {props.banner}
      <div className="flex max-w-full flex-col items-center gap-2 lg:flex-row lg:items-start">
        {show3d && <Interior3d w={W} h={H} gridTop={space.gridTop} wall={layout.wall} floor={layout.floor} items={layout.items}
          people={people3d} onTap={walk3d} width={W * scale} height={H * scale} />}
        <canvas ref={canvasRef} width={W} height={H} data-testid="interior-canvas"
          className={`max-w-full touch-none rounded-sm border-4 border-[#5a381e] [image-rendering:pixelated] ${show3d ? "hidden" : ""}`}
          style={{ width: W * scale, height: H * scale }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} />
        {decorating && (
          <aside className="pch flex max-h-[40vh] w-full max-w-sm flex-col gap-1 overflow-y-auto p-2 text-base lg:max-h-[70vh]" data-testid="decorate-panel">
            <p className="text-lg">🛠️ Trang trí · bấm món rồi bấm vào phòng để đặt · R: xoay · Esc: bỏ</p>
            {selected && !ghost && (
              <div className="flex flex-wrap items-center gap-1">
                <b>{furnitureOf(selected.item)?.name}</b>
                <button type="button" className="pch-btn px-1.5 py-0.5" disabled={busy} onClick={() => place({ ...selected, rot: (selected.rot + 1) % 4 })}>↻ Xoay</button>
                <button type="button" className="pch-btn px-1.5 py-0.5" disabled={busy} onClick={() => { setGhost(selected); setSelected(null); }}>✥ Di chuyển</button>
                <button type="button" className="pch-btn px-1.5 py-0.5" disabled={busy} onClick={() => pickup(selected)}>📦 Cất vào kho</button>
              </div>
            )}
            {ghost && (
              <div className="flex flex-wrap items-center gap-1">
                Đang đặt <b>{furnitureOf(ghost.item)?.name}</b>
                <button type="button" className="pch-btn px-1.5 py-0.5" onClick={() => setGhost({ ...ghost, rot: (ghost.rot + 1) % 4 })}>↻ Xoay</button>
                <button type="button" className="pch-btn px-1.5 py-0.5" onClick={() => setGhost(null)}>Bỏ</button>
              </div>
            )}
            <p className="mt-1">📦 Kho ({storage.length})</p>
            {storage.length === 0 && <p className="opacity-70">Kho trống — mua đồ ở tiệm cô Năm (Chợ Lớn).</p>}
            <ul className="grid grid-cols-2 gap-1">
              {storage.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`pch-btn flex w-full items-center gap-1 px-1 py-0.5 text-left text-sm ${ghost?.id === s.id ? "pch-btn-primary" : ""}`}
                    onClick={() => { setSelected(null); setGhost({ id: s.id, item: s.item, x: Math.floor(entry.x / APT_TILE), y: Math.max(space.gridTop, Math.floor(entry.y / APT_TILE) - 4), rot: 0 }); }}>
                    <FurnitureIcon item={s.item} tiles={2} scale={1} />
                    <span className="truncate">{furnitureOf(s.item)?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {setSurface && (
              <>
                <p className="mt-1">🎨 Tường & sàn</p>
                <div className="flex flex-wrap gap-1">
                  <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy} onClick={() => surface("wall", null)}>Tường trơn</button>
                  <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy} onClick={() => surface("floor", null)}>Sàn trơn</button>
                  {[...new Set(surfaces.map((s) => s.item))].map((id) => (
                    <button key={id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                      onClick={() => surface(furnitureOf(id)!.kind as "wall" | "floor", id)}>{furnitureOf(id)?.name}</button>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}
      </div>
      {!decorating && (
        <div className="flex flex-wrap items-center justify-center gap-2" data-testid="interior-actions">
          {nearKind === "bed" && doSleep && <button type="button" className="pch-btn pch-btn-primary" disabled={busy || sleepAt !== null} onClick={sleep}>🛏️ Ngủ</button>}
          {nearKind === "tv" && hasTv && <button type="button" className="pch-btn pch-btn-primary" onClick={() => setPanel("tv")}>📺 Xem tivi</button>}
          {nearKind === "fridge" && <button type="button" className="pch-btn pch-btn-primary" onClick={() => setPanel("fridge")}>🧊 Tủ lạnh</button>}
          {near.door && <span className="pch px-2 py-0.5 text-base">Gần cửa — bấm 🚪 Ra ngoài để về phố</span>}
          {hasTv && nearKind !== "tv" && <button type="button" className="pch-btn" onClick={() => setPanel("tv")}>📺 Tivi</button>}
          {hasFridge && nearKind !== "fridge" && <button type="button" className="pch-btn" onClick={() => setPanel("fridge")}>🧊</button>}
          {hasAquarium && <button type="button" className="pch-btn" onClick={() => setPanel("aquarium")}>🐠 Bể cá</button>}
        </div>
      )}
      <p className="text-sm text-parchment/80">Mũi tên / WASD hoặc bấm vào nhà để đi. Đứng cạnh giường, tivi, tủ lạnh để dùng.</p>
      {msg && <p className="pch px-3 py-1" role="status">{msg}</p>}
      {sleepAt !== null && <p className="pch px-3 py-1" aria-live="polite">💤 Zzz… ngủ một giấc thật ngon…</p>}
      {hasTv && space.tvNo !== null && (
        <TvController token={token} roomId={roomId} no={space.tvNo} open={panel === "tv"} refreshKey={tvKey} onClose={() => setPanel(null)}
          onChanged={() => net.current?.notify("tv")} onDuck={onDuck} onLit={setTvLit} />
      )}
      {panel === "aquarium" && hasAquarium && aquaHome && (
        <AquariumPanel token={token} roomId={roomId} kind={aquaHome.kind} no={aquaHome.no} bag={props.bag} speciesName={props.speciesName}
          onBagChanged={props.onBagChanged} onChanged={() => { setAquaTick((k) => k + 1); net.current?.notify("layout"); }} onClose={() => setPanel(null)} />
      )}
      {panel === "fridge" && hasFridge && (
        <FridgePanel token={token} bag={props.bag} speciesName={props.speciesName} onBagChanged={props.onBagChanged} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
