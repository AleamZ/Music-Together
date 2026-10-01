import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SONG_CAI_ROUTE } from "@/lib/game/world/routes";
import { heightAt, RIVER_LEVEL, songCaiRenderHeight } from "@/lib/game/world/terrain";
import { zoneAt } from "@/lib/game/world/zones";
import { toon } from "./toon";

// Browser only (0116): Bến đò Sông Cái in 3D, built from the same routes.ts data the 2D world map draws — the dock's
// planks on posts from the bank out over the reeds into the river, the ghe moored at its foot, and the signpost
// "→ Sông Cái (cấp 3)" at the junction with the hall–pond road. (The road itself is in ROADS: the terrain lays it.)

const U = (px: number) => px / 16;

/** The land the world draws at (x, y): Sông Cái's carved channel inside the zone, the terrain elsewhere. */
export function routeGround(x: number, y: number): number {
  return zoneAt({ x, y }) === "song_cai" ? songCaiRenderHeight(x, y) : heightAt(x, y);
}

/** The dock's deck height at world y (a hand over the land at the bank, over the water further out). */
export function dockDeck(y: number): number {
  const d = SONG_CAI_ROUTE.dock, x = d.x + d.w / 2;
  return Math.max(routeGround(x, y), RIVER_LEVEL) + 0.2;
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (geo.getAttribute("uv")) geo.deleteAttribute("uv");
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) =>
  colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8c98a"; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#3b2a1a"; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = "#2a1d12"; g.font = "bold 30px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 34, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSongCaiRoute(): THREE.Group {
  const R = SONG_CAI_ROUTE, d = R.dock, root = new THREE.Group();
  root.name = "song-cai-route";
  const parts: THREE.BufferGeometry[] = [];
  const cx = U(d.x + d.w / 2), hw = U(d.w / 2);
  // the dock: planks every 8 px, posts every 24 px, a rail on the river half
  for (let y = d.y; y <= d.y + d.h; y += 8) {
    const deck = dockDeck(y);
    parts.push(box(hw * 2, 0.16, 0.42, cx, deck, U(y), (y / 8) % 2 ? 0xa8743f : 0x9a6a38));
    if ((y - d.y) % 24 === 0) for (const s of [-1, 1]) {
      const top = deck + 0.7, bot = Math.min(RIVER_LEVEL, routeGround(d.x + d.w / 2, y)) - 0.8;
      parts.push(box(0.22, top - bot, 0.22, cx + s * hw, (top + bot) / 2, U(y), 0x6b4a33));
    }
  }
  // the ghe moored at the foot (a hull, its ribs, a mooring post)
  const gx = U(R.dockFoot.x + 26), gz = U(R.dockFoot.y - 4), gy = RIVER_LEVEL + 0.1;
  parts.push(box(3.2, 0.45, 1.1, gx, gy, gz, 0x7a4a22), box(3.6, 0.2, 0.7, gx, gy - 0.2, gz, 0x5e3a1c));
  for (const k of [-1, 0, 1]) parts.push(box(0.12, 0.35, 1.12, gx + k, gy + 0.2, gz, 0x5e3a1c));
  parts.push(box(0.26, 1.6, 0.26, cx + hw + 0.2, RIVER_LEVEL + 0.4, U(R.dockFoot.y), 0x4a3322));
  // the signpost: a post and its arrowed board, facing the hall–pond road (north)
  const sg = heightAt(R.sign.x, R.sign.y);
  parts.push(box(0.25, 2.6, 0.25, U(R.sign.x), sg + 1.3, U(R.sign.y), 0x6b4a33));
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, toon({ vertexColors: true }));
  mesh.castShadow = true;
  root.add(mesh);
  const tex = signTexture(R.sign.text);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.set(U(R.sign.x) + 1.4, sg + 2.3, U(R.sign.y) - 0.15);
  board.rotation.x = -0.35;                                      // tilted up a little: read from the road and from above
  root.add(board);
  return root;
}
