import * as THREE from "three";
import { ChibiFactory } from "@/lib/game/diorama/character/build";
import { ChibiRig } from "@/lib/game/diorama/character/rig";
import { chibiSpec } from "@/lib/game/diorama/character/spec";
import { poseAt } from "@/lib/game/diorama/character/pose";
import { addVoxelLights } from "@/lib/game/diorama/character/voxel-material";
import { ModelMats } from "@/lib/game/diorama/world/models";
import { enemyAnim } from "@/lib/game/diorama/world/enemies";
import { applyEnemyPose, enemyModel } from "@/lib/game/diorama/world/enemies3d";
import { fightSheets } from "./fight-sheets";
import { closeupSheet, coverageMd, gallerySheets, type Sheet, type Tile } from "./sheets";
import { wave1Sheets } from "./wave1";
import { fishSpeciesGeometry } from "@/lib/game/diorama/world/models";
import { heldFor, heldMaterial, umbrellaArm } from "@/lib/game/diorama/character/held";
import { wave3Sheets } from "./wave3";

// Offscreen outfit gallery (no DB): render.mjs bundles this with vite, opens it in Chromium and calls renderNamed.

const TAG = (import.meta as unknown as { env: Record<string, string> }).env.VITE_TAG ?? "after";
const W = window as unknown as Record<string, unknown>;
W.renderSheet = (tiles: Tile[], cols: number, tw: number, th: number, title: string): string => {
  const rows = Math.ceil(tiles.length / cols), top = 56, lab = 84;
  const out = document.createElement("canvas");
  out.width = cols * tw; out.height = top + rows * (th + lab);
  const g = out.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#f4efe6"; g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = "#2a1c18"; g.font = "bold 26px sans-serif"; g.fillText(title, 16, 38);
  const cv = document.createElement("canvas"); cv.width = tw; cv.height = th;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe9e2d4);
  addVoxelLights(scene, 2);
  const cam = new THREE.PerspectiveCamera(30, tw / th, 0.1, 50);
  const f = new ChibiFactory(400);
  const mats = new ModelMats();
  tiles.forEach((t, i) => {
    if (t.fish) {                                                           // wave 1: a fish species, side on
      const m = new THREE.Mesh(fishSpeciesGeometry(t.fish), heldMaterial());
      m.rotation.y = -Math.PI / 2 + 0.35;
      if (t.fish === "ca_duoi_song") m.rotation.z = 0.7;                       // the flat ray, tilted to show its diamond
      scene.add(m);
      cam.position.set(0, 0.55, 1.5); cam.lookAt(0, 0, 0);
      r.render(scene, cam);
      scene.remove(m);
    } else if (t.enemy) {
      const c = enemyModel(mats, t.enemy.id);
      if (c) {
      applyEnemyPose(c, enemyAnim(t.enemy.id, t.enemy.anim, t.enemy.t));
      c.root.rotation.y = t.yaw;
      scene.add(c.root);
      const hh = Math.max(1.6, c.height);
      cam.position.set(0, hh * 0.75, hh * 2.6 + 2); cam.lookAt(0, hh * 0.45, 0);
      r.render(scene, cam);
      scene.remove(c.root);
      }
    } else if (t.noChibi || t.more || t.extra || t.cam) {
    // the tile's chibis (the main one unless noChibi, plus `more`), each with its act's props (rig.setAct)
    const people = [...(t.noChibi ? [] : [{ look: t.look, act: t.act, time: t.time, x: 0, y: 0, z: 0, yaw: t.yaw }]), ...(t.more ?? [])];
    const placed = people.map((p) => {
      const rig = new ChibiRig();
      const got = f.acquire(chibiSpec(p.look), t.detail ?? "high");
      rig.setParts(got.parts);
      rig.root.rotation.y = p.yaw;
      rig.root.position.set(p.x, p.y ?? 0, p.z);
      rig.apply(p.act ? poseAt(p.act, p.time ?? 0.2) : poseAt("idle", 0.2, 0, true));
      rig.setAct(p.act ?? null);
      if (p.act) { const hf = heldFor(p.act); rig.setHeld(hf.R, hf.L); }
      scene.add(rig.root);
      return { rig, key: got.key };
    });
    const extra = t.extra?.();
    if (extra) scene.add(extra);
      const z = t.zoom ?? 1, fy = t.focusY ?? 1.08;
      if (t.cam) { cam.position.set(...t.cam.eye); cam.lookAt(...t.cam.at); }
      else { cam.position.set(0, fy + 0.3 / z, 5.0 / z); cam.lookAt(0, fy, 0); }
      r.render(scene, cam);
      if (extra) scene.remove(extra);
      for (const p of placed) { scene.remove(p.rig.root); p.rig.detach(); f.release(p.key); }
    } else {
    const rig = new ChibiRig();
    const got = f.acquire(chibiSpec(t.look), t.detail ?? "high");
    rig.setParts(got.parts);
    rig.root.rotation.y = t.yaw;
    if (t.held) rig.setHeld(t.held.R, t.held.L);
    if (t.rodLook) rig.setRodLook(t.rodLook);
    const pose = t.pose ? t.pose : t.act ? poseAt(t.act, t.time ?? 0.2) : poseAt("idle", 0.2, 0, true);
    rig.apply(t.held?.L === "umbrella" ? umbrellaArm(pose) : pose);
    scene.add(rig.root);
    const z = t.zoom ?? 1, fy = t.focusY ?? 1.08;
    cam.position.set(0, fy + 0.3 / z, 5.0 / z); cam.lookAt(0, fy, 0);
    r.render(scene, cam);
    scene.remove(rig.root);
    rig.detach();
    f.release(got.key);
    }
    const x = (i % cols) * tw, y = top + Math.floor(i / cols) * (th + lab);
    g.drawImage(cv, x, y);
    g.fillStyle = "#2a1c18"; g.font = "14px sans-serif";
    let line = "", ly = y + th + 17;
    for (const w of t.label.split(" ")) {
      if (line && g.measureText(line + w).width > tw - 12) { g.fillText(line, x + 6, ly); line = ""; ly += 16; }
      line += w + " ";
    }
    g.fillText(line, x + 6, ly);
    g.strokeStyle = "#cbbfa8"; g.strokeRect(x + 0.5, y + 0.5, tw - 1, th + lab - 1);
  });
  r.dispose();
  return out.toDataURL("image/png");
};
const SHEETS: Sheet[] = [closeupSheet(TAG), ...gallerySheets(), ...wave1Sheets(), ...fightSheets(), ...wave3Sheets()];
W.sheetNames = () => SHEETS.map((s) => s.name);
W.coverage = () => coverageMd(SHEETS);
W.renderNamed = (n: string) => {
  const s = SHEETS.find((x) => x.name === n) as Sheet;
  return (W.renderSheet as (t: Tile[], c: number, w: number, h: number, ti: string) => string)(s.tiles, s.cols, s.tw, s.th, s.title);
};
/** Stacks PNG data URLs vertically, each under a caption. */
W.stack = async (urls: string[], captions: string[]): Promise<string> => {
  const imgs = await Promise.all(urls.map((u) => new Promise<HTMLImageElement>((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = u; })));
  const cap = 44, w = Math.max(...imgs.map((i) => i.width)), h = imgs.reduce((a, i) => a + i.height + cap, 0);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#fffaf0"; g.fillRect(0, 0, w, h);
  let y = 0;
  imgs.forEach((im, i) => {
    g.fillStyle = "#7a1e1e"; g.font = "bold 28px sans-serif"; g.fillText(captions[i], 16, y + 32);
    g.drawImage(im, 0, y + cap); y += im.height + cap;
  });
  return c.toDataURL("image/png");
};
W.ready = true;
