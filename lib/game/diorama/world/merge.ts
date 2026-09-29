import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The zones' static geometry merged into one mesh per material (and shadow flags), to cut the world's draw calls:
// every zone diorama is hundreds of small meshes sharing a few dozen cached materials. What moves is left alone —
// found by snapshotting every object, running the zone's own animation/state hooks (`probe`), and keeping whatever
// changed (and everything under it), plus the caller's explicit keeps (swaying crowns, water, instanced meshes).

export interface MergeResult {
  /** Meshes before → after. */
  before: number;
  after: number;
  /** The merged geometries (the caller disposes them with the zone). */
  geos: THREE.BufferGeometry[];
  /** The vertex-coloured materials made for the merged meshes (the caller disposes them). */
  mats: THREE.Material[];
}

type Colored = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null; emissive?: THREE.Color; emissiveIntensity?: number;
  flatShading?: boolean; vertexColors: boolean; gradientMap?: THREE.Texture | null };

/** The material "family": everything but the base colour, which is baked into the vertices when meshes of different
 *  colours merge. Materials the view animates (`keepMats`: see-through roofs, night glow, bulbs) keep their own. */
export function familyKey(mat: THREE.Material, keepMats: ReadonlySet<THREE.Material>): string {
  if (keepMats.has(mat)) return `own:${mat.uuid}`;
  const m = mat as Colored;
  if (!m.color) return `own:${mat.uuid}`;
  return [mat.type, +mat.transparent, mat.opacity.toFixed(3), mat.side, m.map?.uuid ?? "-", m.emissive?.getHexString() ?? "-", m.emissiveIntensity ?? 1,
    +(m.flatShading ?? false), mat.alphaTest, +mat.depthWrite, +mat.depthTest, m.gradientMap?.uuid ?? "-"].join("|");
}

/** The key two meshes must share to be merged: the material family, shadow flags, draw order and vertex layout. */
export function mergeKey(m: THREE.Mesh, keepMats: ReadonlySet<THREE.Material> = new Set()): string | null {
  const g = m.geometry, mat = m.material;
  if (Array.isArray(mat) || Object.keys(g.morphAttributes).length > 0) return null;
  const fam = familyKey(mat, keepMats);
  const attrs = Object.keys(g.attributes).filter((k) => k !== "color" || fam.startsWith("own:")).sort()
    .map((k) => `${k}${g.attributes[k].itemSize}${(g.attributes[k] as THREE.BufferAttribute).normalized ? "n" : ""}`);
  return [fam, +m.castShadow, +m.receiveShadow, m.renderOrder, +m.frustumCulled, g.index ? "i" : "n", attrs.join(",")].join("|");
}

/** A mesh's geometry in the merge's space, its material colour (× any vertex colours) baked into a colour attribute. */
function bakedPart(m: THREE.Mesh, rel: THREE.Matrix4, bake: boolean): THREE.BufferGeometry {
  const g = m.geometry.clone().applyMatrix4(rel);
  g.clearGroups();
  if (!bake) return g;
  const base = (m.material as Colored).color ?? new THREE.Color(1, 1, 1);
  const n = g.attributes.position.count, out = new Float32Array(n * 3);
  const vc = (m.material as Colored).vertexColors ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
  for (let i = 0; i < n; i++) {
    out[i * 3] = base.r * (vc ? vc.getX(i) : 1);
    out[i * 3 + 1] = base.g * (vc ? vc.getY(i) : 1);
    out[i * 3 + 2] = base.b * (vc ? vc.getZ(i) : 1);
  }
  g.setAttribute("color", new THREE.BufferAttribute(out, 3));
  return g;
}

function snapshot(o: THREE.Object3D): string {
  const m = o as THREE.Mesh;
  const pv = m.isMesh ? (m.geometry.attributes.position as THREE.BufferAttribute | undefined)?.version ?? 0 : 0;
  return `${o.visible ? 1 : 0}|${pv}|${o.position.toArray().map((v) => v.toFixed(5))}|${o.quaternion.toArray().map((v) => v.toFixed(5))}|${o.scale.toArray().map((v) => v.toFixed(5))}|${m.isMesh ? m.geometry.uuid : ""}`;
}

/** Merge `root`'s static meshes. `probe` runs the zone's animation/state hooks so the moving parts reveal themselves. */
export function mergeStatic(root: THREE.Object3D, opts: { probe?: () => void; keep?: Iterable<THREE.Object3D>; keepMats?: Iterable<THREE.Material> } = {}): MergeResult {
  const keepMats = new Set(opts.keepMats ?? []);
  const before = new Map<THREE.Object3D, string>();
  root.traverse((o) => before.set(o, snapshot(o)));
  opts.probe?.();
  const dynamic = new Set<THREE.Object3D>(opts.keep ?? []);
  root.traverse((o) => {
    const was = before.get(o);
    if (was === undefined || was !== snapshot(o)) dynamic.add(o);        // moved, toggled, re-shaped — or added by the probe
  });

  const groups = new Map<string, THREE.Mesh[]>();
  let count = 0;
  root.updateMatrixWorld(true);
  const visit = (o: THREE.Object3D, still: boolean): void => {
    const ok = still && !dynamic.has(o) && o.visible && !o.userData.keep;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      count++;
      const inst = (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh;
      if (ok && !inst && o.children.length === 0 && m.matrixWorld.determinant() > 0) {
        const key = mergeKey(m, keepMats);
        if (key) { const list = groups.get(key); if (list) list.push(m); else groups.set(key, [m]); }
      }
    }
    for (const c of o.children.slice()) visit(c, ok);
  };
  for (const c of root.children.slice()) visit(c, !dynamic.has(root));

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  const twins = new Map<string, Colored>();
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const own = keepMats.has(first.material as THREE.Material) || !(first.material as Colored).color;
    const parts = list.map((m) => bakedPart(m, rel.multiplyMatrices(inv, m.matrixWorld), !own));
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    let mat = first.material as THREE.Material;
    if (!own) {
      // one white, vertex-coloured twin per family (the baked colours carry the rest)
      const key = familyKey(mat, keepMats);
      let twin = twins.get(key);
      if (!twin) {
        twin = mat.clone() as Colored;
        twin.color?.set(0xffffff);
        twin.vertexColors = true;
        twins.set(key, twin);
      }
      mat = twin;
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.name = "merged";
    root.add(mesh);
    geos.push(merged);
    for (const m of list) m.parent?.remove(m);
    removed += list.length - 1;
  }
  return { before: count, after: count - removed, geos, mats: [...twins.values()] };
}
