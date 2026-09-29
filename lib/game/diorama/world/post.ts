import * as THREE from "three";

// Browser only: the world's finishing pass — the scene is drawn into a target with its depth, then one full-screen
// pass inks the silhouettes and creases (a depth Laplacian, thinner and fainter with distance), and lays a faint
// paper grain and wash over it. Plus the sky dome: a gradient from the zenith to a hazy horizon that the fog matches.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 res;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 ink;
uniform float inkK;
uniform float paperK;
uniform float px;
varying vec2 vUv;

float lin(float d) { return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  vec2 o = px / res;
  float z0 = lin(texture2D(tDepth, vUv).x);
  float zl = lin(texture2D(tDepth, vUv - vec2(o.x, 0.0)).x), zr = lin(texture2D(tDepth, vUv + vec2(o.x, 0.0)).x);
  float zd = lin(texture2D(tDepth, vUv - vec2(0.0, o.y)).x), zu = lin(texture2D(tDepth, vUv + vec2(0.0, o.y)).x);
  // silhouettes: a neighbour much farther than this pixel (the near object's side gets the line)
  float far = max(max(zl, zr), max(zd, zu)) - z0;
  float sil = smoothstep(0.03, 0.1, far / z0);
  // creases: the depth's curvature
  float lap = abs(zl + zr - 2.0 * z0) + abs(zu + zd - 2.0 * z0);
  float crease = smoothstep(0.012, 0.035, lap / z0);
  float dist = smoothstep(cameraFar * 0.35, cameraFar * 0.8, z0);
  float line = max(sil, crease * 0.55) * (1.0 - dist * 0.85);
  if (z0 > cameraFar * 0.98) line = 0.0;
  // paper: a fine grain and a soft blotchy wash
  vec2 fc = gl_FragCoord.xy;
  float grain = hash(fc) - 0.5;
  float wash = vnoise(fc / 140.0) * 0.6 + vnoise(fc / 37.0) * 0.4 - 0.5;
  c *= 1.0 + paperK * (grain * 0.05 + wash * 0.07);
  c = mix(c, ink, clamp(line * inkK, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export class InkPass {
  private target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private samples: number;

  constructor(samples = 4) {
    this.samples = samples;
    this.target = this.makeTarget(2, 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture }, res: { value: new THREE.Vector2(2, 2) },
        cameraNear: { value: 0.5 }, cameraFar: { value: 1500 }, ink: { value: new THREE.Color(0x2a2320) }, inkK: { value: 0.85 },
        paperK: { value: 1 }, px: { value: 1 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: depth, depthBuffer: true });
  }

  setSamples(n: number): void {
    if (n === this.samples) return;
    this.samples = n;
    const { width, height } = this.target;
    this.target.dispose();
    this.target.depthTexture?.dispose();
    this.target = this.makeTarget(width, height);
    this.mat.uniforms.tColor.value = this.target.texture;
    this.mat.uniforms.tDepth.value = this.target.depthTexture;
  }

  setSize(w: number, h: number, dpr: number): void {
    this.target.setSize(w, h);
    this.target.depthTexture!.image.width = w;
    this.target.depthTexture!.image.height = h;
    (this.mat.uniforms.res.value as THREE.Vector2).set(w, h);
    this.mat.uniforms.px.value = Math.max(1, dpr * 0.9);
  }

  setInk(k: number, paper: number, color?: THREE.Color): void {
    this.mat.uniforms.inkK.value = k;
    this.mat.uniforms.paperK.value = paper;
    if (color) (this.mat.uniforms.ink.value as THREE.Color).copy(color);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.mat.uniforms.cameraNear.value = camera.near;
    this.mat.uniforms.cameraFar.value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
  float s = max(0.0, dot(normalize(vDir), normalize(sunDir)));
  c += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly zenith = new THREE.Color(0x6fb2e6);
  readonly horizon = new THREE.Color(0xdcecf2);
  readonly sunDir = new THREE.Vector3(-0.4, 0.6, 0.3);
  readonly sunColor = new THREE.Color(0xfff1d6);

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { zenith: { value: this.zenith }, horizon: { value: this.horizon }, sunDir: { value: this.sunDir }, sunColor: { value: this.sunColor } },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  follow(eye: THREE.Vector3): void {
    this.mesh.position.copy(eye);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
