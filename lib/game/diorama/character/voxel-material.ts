import * as THREE from "three";
import { hash3, mix, rgb, shade, type Painter, type RGB, type Texel } from "./voxel-atlas";

// The voxel look's shared pieces: crisp pixel textures, the soft-lit material (a little self-fill so colours stay
// warm under any scene light), the lighting preset, and the base painters (soft per-voxel noise and a bevel: lighter
// top edge, darker bottom edge on every side face). Reusable for the environment.

/** RGBA bytes → an sRGB texture (no mipmaps). `smooth` (the default) filters linearly: flat colour areas with soft,
 *  clean edges; `smooth: false` keeps the pixels square. */
export function pixelTexture(pixels: Uint8Array, width: number, height: number, smooth = true): THREE.DataTexture {
  const t = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

let ramp: THREE.DataTexture | null = null;
/** The light ramp: soft shading (shade → lit, linearly blended), the smooth low-poly look. */
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const px = new Uint8Array([168, 168, 172, 255, 206, 206, 208, 255, 240, 240, 240, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(px, 4, 1, THREE.RGBAFormat);
  ramp.magFilter = ramp.minFilter = THREE.LinearFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export interface VoxelMaterialOpts {
  /** Self-light share of the texture (keeps colours warm in shade). */
  fill?: number;
  transparent?: boolean;
  /** Inverted-hull outline width (world units) for geometry built with outlines; 0 = none. */
  outline?: number;
  outlineColor?: THREE.ColorRepresentation;
}

/** Toon-lit pixel material (3-step ramp) with a little self-fill, and the one-draw-call outline: vertices whose
 *  `outline` attribute is 1 are pushed out along their normal and painted flat dark. */
export function voxelMaterial(map: THREE.Texture, opts: VoxelMaterialOpts = {}): THREE.MeshToonMaterial {
  const fill = opts.fill ?? 0.22;
  const mat = new THREE.MeshToonMaterial({
    map, emissiveMap: map, emissive: new THREE.Color(fill, fill, fill), gradientMap: toonRamp(),
    transparent: !!opts.transparent, alphaTest: opts.transparent ? 0.01 : 0,
  });
  const w = opts.outline ?? 0;
  if (w > 0) {
    const color = new THREE.Color(opts.outlineColor ?? 0x2a1c18);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uOutlineW = { value: w };
      sh.uniforms.uOutlineC = { value: color };
      sh.vertexShader = ["attribute float outline;", "uniform float uOutlineW;", "varying float vOutline;", sh.vertexShader.replace(
        "#include <begin_vertex>",
        ["#include <begin_vertex>", "transformed += normalize(objectNormal) * outline * uOutlineW;", "vOutline = outline;"].join("\n"),
      )].join("\n");
      sh.fragmentShader = ["uniform vec3 uOutlineC;", "varying float vOutline;", sh.fragmentShader.replace(
        "#include <opaque_fragment>",
        ["if (vOutline > 0.5) outgoingLight = uOutlineC;", "#include <opaque_fragment>"].join("\n"),
      )].join("\n");
    };
    mat.customProgramCacheKey = () => "voxel-outline";
  }
  return mat;
}

/** Warm, soft lights for voxel scenes: sky/ground fill and a low-contrast sun. */
export const VOXEL_LIGHT = { sky: 0xfff3e2, ground: 0xc9b89a, hemi: 1.9, sun: 0xfff0d8, sunIntensity: 1.9, sunDir: [3, 7, 5] as const };

export function addVoxelLights(scene: THREE.Scene, shadowSize = 4): { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight } {
  const L = VOXEL_LIGHT;
  const hemi = new THREE.HemisphereLight(L.sky, L.ground, L.hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunIntensity);
  sun.position.set(...L.sunDir);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 0.5, far: 30 });
  scene.add(hemi, sun);
  return { hemi, sun };
}

/** Brightness for a texel: sculpted surfaces are flat colour (the light does the shading — the smooth low-poly
 *  look); plain boxes keep the voxel wobble (±amp) and bevel. */
export function tone(t: Texel, amp = 0.05, seed = 0): number {
  if (t.surface) return 1;
  let k = 1 + (hash3(t.x * 1.0001, t.y * 1.0001, t.z * 1.0001, seed) - 0.5) * 2 * amp;
  if (t.dir === "py") k *= 1.06;
  else if (t.dir === "ny") k *= 0.78;
  else if (t.h > 2) {
    if (t.v === 0) k *= 1.1;
    else if (t.v === t.h - 1) k *= 0.84;
  }
  return k;
}

/** A plain block colour with the voxel noise and bevel. */
export function solid(hex: string, amp = 0.05): Painter {
  const c = rgb(hex);
  return (t) => shade(c, tone(t, amp));
}

/** A colour picker → painted with noise and bevel. */
export function painted(pick: (t: Texel) => RGB | string, amp = 0.05): Painter {
  const cache = new Map<string, RGB>();
  return (t) => {
    const c = pick(t);
    let v: RGB | undefined;
    if (typeof c === "string") { v = cache.get(c); if (!v) cache.set(c, (v = rgb(c))); } else v = c;
    return shade(v, tone(t, amp));
  };
}

export { mix, rgb, shade };
