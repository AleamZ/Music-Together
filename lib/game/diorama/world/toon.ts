import * as THREE from "three";

// Browser only: the world's toon look — a stepped light ramp shared by every material, and the zones' Lambert
// materials restyled to it (same colours, same see-through roofs and night glow).

let ramp: THREE.DataTexture | null = null;

/** The light ramp: four soft steps (deep shade, shade, lit, highlight). */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const steps = [0.42, 0.62, 0.86, 1.0];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { data.set([v * 255, v * 255, v * 255, 255], i * 4); });
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function toon(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

/** Swap every Lambert material under `root` for its toon twin; returns old → new (to re-point roofs and glow lists). */
export function toonify(root: THREE.Object3D): Map<THREE.Material, THREE.MeshToonMaterial> {
  const swap = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const conv = (m: THREE.Material): THREE.Material => {
    if (!(m instanceof THREE.MeshLambertMaterial)) return m;
    let t = swap.get(m);
    if (!t) {
      t = toon({
        color: m.color, map: m.map, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity,
        emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, side: m.side, alphaTest: m.alphaTest, depthWrite: m.depthWrite,
      });
      t.name = m.name;
      swap.set(m, t);
    }
    return t;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
  for (const old of swap.keys()) old.dispose();
  return swap;
}
