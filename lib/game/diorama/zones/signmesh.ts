import * as THREE from "three";
import { packAtlas, rasterSign, type SignArt } from "./signart";

// Browser/node (Three.js, no DOM): every painted sign face of a zone as ONE mesh — the faces packed into one pixel
// atlas (NearestFilter, no mipmaps: the letters stay crisp), one quad each, one draw call. The quads float in front of
// their boards (the builders leave a gap) and the material also asks for a polygon offset toward the camera, so a face
// never fights the board behind it.

export interface FaceQuad {
  /** Centre (world units), the face's right and up directions (unit vectors), its size (units). */
  center: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  w: number;
  h: number;
  art: SignArt;
}

export function signMesh(faces: readonly FaceQuad[]): { mesh: THREE.Mesh; texture: THREE.DataTexture; material: THREE.MeshLambertMaterial; geometry: THREE.BufferGeometry } | null {
  if (faces.length === 0) return null;
  const atlas = packAtlas(faces.map((f) => rasterSign(f.art)));
  const tex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = new THREE.Vector3(), c = new THREE.Vector3();
  faces.forEach((f, k) => {
    n.crossVectors(f.right, f.up).normalize();
    const u = atlas.uv[k], base = k * 4;
    for (const [sx, sy, tu, tv] of [[-1, -1, u.u0, u.v0], [1, -1, u.u1, u.v0], [1, 1, u.u1, u.v1], [-1, 1, u.u0, u.v1]] as const) {
      c.copy(f.center).addScaledVector(f.right, (sx * f.w) / 2).addScaledVector(f.up, (sy * f.h) / 2);
      pos.push(c.x, c.y, c.z);
      nor.push(n.x, n.y, n.z);
      uv.push(tu, tv);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.name = "signs";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "signs";
  mesh.receiveShadow = true;
  mesh.userData.keep = true;
  return { mesh, texture: tex, material: mat, geometry: geo };
}

/** The right/up vectors of a face looking south (+z), north, east (+x) or west, in the zones' world axes. */
export function faceAxes(face: "s" | "n" | "e" | "w"): { right: THREE.Vector3; up: THREE.Vector3 } {
  const up = new THREE.Vector3(0, 1, 0);
  const right = face === "s" ? new THREE.Vector3(1, 0, 0) : face === "n" ? new THREE.Vector3(-1, 0, 0) : face === "e" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  return { right, up };
}
