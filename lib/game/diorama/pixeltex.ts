import * as THREE from "three";

// The pixel-texture pass (the forest_house.glb look: small pixel textures on low-poly). No image textures: every lit
// material gets a few lines of fragment shader that lay a 2-game-px texel grid over its faces (world space, the face's
// dominant plane) and shade each texel by what its colour looks like —
//   green → grass speckle; brown on a wall → planks (boards with seams); brown on the ground → dirt speckle;
//   straw → thatch (vertical streaks); grey / blue-grey → tin (corrugation); water materials → sparkle texels.
// The pattern fades out where a texel gets smaller than a screen pixel (no shimmer far away). One patch per material,
// chained after any onBeforeCompile it already has (the rice's wind). Cheap: a hash and a few compares per fragment.

/** Texels per world unit (1 unit = 16 game px → a texel is 2 px). */
export const PIXEL_DENSITY = 8;

const done = new WeakSet<THREE.Material>();

const VERT_DECL = "varying vec3 vPxW;\nvarying vec3 vPxN;\n";
const VERT_BODY = `
#ifdef USE_INSTANCING
  vPxW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vPxN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vPxW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vPxN = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;
const FRAG_DECL = `varying vec3 vPxW;
varying vec3 vPxN;
float pxHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
vec3 pxShade(vec3 col, float water) {
  vec3 an = abs(vPxN);
  bool top = an.y >= max(an.x, an.z);
  vec2 p = top ? vPxW.xz : (an.x > an.z ? vPxW.zy : vPxW.xy);
  vec2 q = p * ${PIXEL_DENSITY.toFixed(1)};
  float fw = length(fwidth(q));
  float amp = 1.0 - smoothstep(0.6, 1.6, fw);
  if (amp <= 0.0) return col;
  vec2 c = floor(q);
  float h = pxHash(c);
  float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float k = 1.0;
  if (water > 0.5) {
    k = h > 0.92 ? 1.3 : (h < 0.25 ? 0.9 : 1.0);
  } else if (col.g >= col.r && col.g >= col.b && sat > 0.18) {
    k = h > 0.82 ? 1.2 : (h < 0.18 ? 0.82 : 1.0 + (h - 0.5) * 0.1);                        // grass
  } else if (col.r > col.g && col.g > col.b && sat > 0.2 && mx < 0.78) {
    if (top && an.y > 0.8) k = h > 0.8 ? 1.16 : (h < 0.2 ? 0.84 : 1.0 + (h - 0.5) * 0.08);                      // dirt
    else {                                                                                  // planks
      float row = floor(c.y / 4.0);
      float off = floor(pxHash(vec2(row, 7.0)) * 12.0);
      float seam = mod(c.y, 4.0) < 1.0 ? 0.7 : 1.0;
      float joint = mod(c.x + off, 12.0) < 1.0 ? 0.78 : 1.0;
      k = seam * joint * (0.9 + 0.2 * pxHash(vec2(floor((c.x + off) / 12.0), row)));
    }
  } else if (col.r > col.b && col.g > col.b && sat > 0.2) {
    k = 0.8 + 0.4 * pxHash(vec2(c.x, floor(c.y / 3.0)));                                     // thatch / straw
  } else if (sat < 0.2) {
    k = mod(c.x, 3.0) < 1.0 ? 0.8 : 1.0 + (h - 0.5) * 0.08;                                 // tin, stone, plaster
  } else {
    k = 1.0 + (h - 0.5) * 0.14;
  }
  return col * mix(1.0, k, amp);
}
`;

type Shaded = THREE.MeshLambertMaterial | THREE.MeshToonMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
const isShaded = (m: THREE.Material): m is Shaded =>
  m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshToonMaterial || m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshStandardMaterial;

/** Give `mat` the pixel texels (once). Water materials (transparent Phong) sparkle instead. */
export function pixelize(mat: THREE.Material, water = mat instanceof THREE.MeshPhongMaterial && mat.transparent): void {
  if (done.has(mat) || !isShaded(mat) || mat.map) return;   // a textured face (signs, art) keeps its own pixels
  done.add(mat);
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_BODY);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace("#include <color_fragment>",
      `#include <color_fragment>\n  diffuseColor.rgb = pxShade(diffuseColor.rgb, ${water ? "1.0" : "0.0"});`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|px${water ? "w" : ""}`;
  mat.needsUpdate = true;
}

/** Pixelize every lit material under `root`. */
export function pixelizeTree(root: THREE.Object3D, water?: boolean): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) pixelize(x, water ?? (x instanceof THREE.MeshPhongMaterial && x.transparent));
  });
}
