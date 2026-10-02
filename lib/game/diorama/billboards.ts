import * as THREE from "three";
import { BETA_GOLD, isBetaTag } from "@/lib/game/beta/frame";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { SPRITE_H, SPRITE_W } from "@/lib/game/art/layers";
import { pxLen, pxToWorld, type MapSize } from "./coords";
import type { Billboard } from "./types";

// Browser only: characters as camera-facing billboards (Octopath / Paper Mario style). Each shows its existing 24×48
// chibi frame (the same compositor as the 2D game) on an upright quad that turns about the vertical axis only, with a
// soft shadow blob at the feet and a name tag above the head.

const CH_W = pxLen(SPRITE_W), CH_H = pxLen(SPRITE_H);
/** The 2D sprite's feet sit 46 px below its top: the quad's bottom is 2 px (in sprite px) under the feet. */
const FEET_OFFSET = pxLen(SPRITE_H - 46);
const MAX_TEXTURES = 600;

interface Actor3D {
  group: THREE.Group;
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  tag: THREE.Sprite | null;
  tagText: string | null;
  seen: number;
}

export class BillboardLayer {
  readonly root = new THREE.Group();
  private readonly size: MapSize;
  private readonly geo: THREE.PlaneGeometry;
  private readonly blobGeo: THREE.CircleGeometry;
  private readonly blobMat: THREE.MeshBasicMaterial;
  private readonly textures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private readonly tags = new Map<string, { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial; aspect: number }>();
  private readonly actors = new Map<string, Actor3D>();
  private readonly tint = new THREE.Color(1, 1, 1);
  private frameNo = 0;
  /** Ground height at a map px (the dock's deck is raised). */
  private readonly groundAt: (x: number, y: number) => number;

  constructor(size: MapSize, groundAt: (x: number, y: number) => number) {
    this.size = size;
    this.groundAt = groundAt;
    this.geo = new THREE.PlaneGeometry(CH_W, CH_H);
    this.geo.translate(0, CH_H / 2 - FEET_OFFSET, 0);
    this.blobGeo = new THREE.CircleGeometry(0.42, 16);
    this.blobGeo.rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x28190a, transparent: true, opacity: 0.32, depthWrite: false });
  }

  private texture(cv: HTMLCanvasElement): THREE.CanvasTexture {
    let tex = this.textures.get(cv);
    if (tex) return tex;
    if (this.textures.size >= MAX_TEXTURES) this.dropTextures();
    tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(cv, tex);
    return tex;
  }

  /** Too many looks seen: start the texture cache over (the frames re-upload on demand). */
  private dropTextures(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }

  private tag(text: string, me: boolean): { mat: THREE.SpriteMaterial; aspect: number } {
    const key = `${me ? 1 : 0}|${text}`;
    const hit = this.tags.get(key);
    if (hit) return hit;
    const scale = 4, font = 9 * scale;
    const cv = document.createElement("canvas");
    const c = cv.getContext("2d");
    if (!c) throw new Error("canvas-2d-unavailable");
    c.font = `bold ${font}px monospace`;
    const w = Math.ceil(c.measureText(text).width) + 8 * scale, h = font + 6 * scale;
    cv.width = w; cv.height = h;
    c.font = `bold ${font}px monospace`;
    c.fillStyle = me ? "rgba(58, 36, 24, 0.85)" : "rgba(20, 20, 30, 0.65)";
    c.beginPath();
    c.roundRect(0, 0, w, h, 3 * scale);
    c.fill();
    if (isBetaTag(text)) {                                                                      // 0118: the Beta frame
      c.strokeStyle = BETA_GOLD; c.lineWidth = 1.5 * scale;
      c.beginPath(); c.roundRect(scale, scale, w - 2 * scale, h - 2 * scale, 2.5 * scale); c.stroke();
    }
    c.fillStyle = me ? "#ffe08a" : "#ffffff";
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillText(text, w / 2, h / 2 + scale / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const entry = { tex, mat, aspect: w / h };
    this.tags.set(key, entry);
    return entry;
  }

  /** The night's colour over the sprites (they are unlit, so they follow the scene's light by hand). */
  setTint(c: THREE.Color): void {
    this.tint.copy(c);
  }

  update(list: readonly Billboard[], cameraYaw: number): void {
    const n = ++this.frameNo;
    for (const b of list) {
      let a = this.actors.get(b.id);
      if (!a) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
        const body = new THREE.Mesh(this.geo, mat);
        const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
        blob.position.y = 0.02;
        blob.renderOrder = 1;
        const group = new THREE.Group();
        group.add(blob, body);
        this.root.add(group);
        a = { group, body, tag: null, tagText: null, seen: n };
        this.actors.set(b.id, a);
      }
      a.seen = n;
      const w = pxToWorld(b, this.size);
      a.group.position.set(w.x, this.groundAt(b.x, b.y), w.z);
      a.body.rotation.y = cameraYaw;
      const cv = getCharacterFrames(b.look)[b.facing][b.frame];
      const tex = this.texture(cv);
      if (a.body.material.map !== tex) {
        a.body.material.map = tex;
        a.body.material.needsUpdate = true;
      }
      a.body.material.color.copy(this.tint);
      if (b.name !== a.tagText) {
        if (a.tag) { a.group.remove(a.tag); a.tag = null; }
        if (b.name) {
          const t = this.tag(b.name, !!b.me);
          const s = new THREE.Sprite(t.mat);
          const h = 0.42;
          s.scale.set(h * t.aspect, h, 1);
          s.position.y = CH_H + 0.05;
          s.renderOrder = 10;
          a.tag = s;
          a.group.add(s);
        }
        a.tagText = b.name;
      }
    }
    for (const [id, a] of this.actors) {
      if (a.seen === n) continue;
      this.root.remove(a.group);
      a.body.material.dispose();
      this.actors.delete(id);
    }
  }

  dispose(): void {
    for (const a of this.actors.values()) a.body.material.dispose();
    this.actors.clear();
    this.root.clear();
    this.dropTextures();
    for (const t of this.tags.values()) { t.tex.dispose(); t.mat.dispose(); }
    this.tags.clear();
    this.geo.dispose();
    this.blobGeo.dispose();
    this.blobMat.dispose();
  }
}
