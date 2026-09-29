import * as THREE from "three";
import { FX_DENSITY, type WeatherFx } from "@/lib/game/art/weather";
import type { WeatherKind } from "@/lib/game/weather/model";

// Browser only: rain streaks and snowflakes in a box that travels with the camera's target. The count follows the
// viewer's weather-effects level, like the 2D particles.

const MAX = 2400;
const BOX = { w: 44, h: 18, d: 34 };

export class WeatherLayer {
  readonly root = new THREE.Group();
  private readonly rainGeo = new THREE.BufferGeometry();
  private readonly rainMat = new THREE.LineBasicMaterial({ color: 0xbcd4ec, transparent: true, opacity: 0.55 });
  private readonly rain: THREE.LineSegments;
  private readonly snowGeo = new THREE.BufferGeometry();
  private readonly snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9 });
  private readonly snow: THREE.Points;
  private readonly seeds = new Float32Array(MAX * 3);
  private readonly rainPos = new Float32Array(MAX * 6);
  private readonly snowPos = new Float32Array(MAX * 3);

  constructor() {
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = Math.random();
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.snowGeo.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3));
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.snow = new THREE.Points(this.snowGeo, this.snowMat);
    this.rain.frustumCulled = false;
    this.snow.frustumCulled = false;
    this.root.add(this.rain, this.snow);
  }

  update(kind: WeatherKind | null, fx: WeatherFx, reduced: boolean, t: number, center: THREE.Vector3, wind: number, lowQuality: boolean): void {
    const wet = kind === "rain" || kind === "thunder" || kind === "storm";
    const heavy = kind === "storm" ? 1 : kind === "thunder" ? 0.8 : 0.55;
    const k = reduced ? 0 : FX_DENSITY[fx] * (lowQuality ? 0.4 : 1);
    const nRain = wet ? Math.floor(MAX * heavy * k) : 0;
    const nSnow = kind === "snow" ? Math.floor(MAX * 0.5 * k) : 0;
    this.rain.visible = nRain > 0;
    this.snow.visible = nSnow > 0;
    const s = t / 1000;
    const slant = Math.min(0.6, wind / 80);
    if (nRain > 0) {
      const len = 0.5 + heavy * 0.3;
      for (let i = 0; i < nRain; i++) {
        const a = this.seeds[i * 3], b = this.seeds[i * 3 + 1], c = this.seeds[i * 3 + 2];
        const fall = (c + s * (1.1 + a * 0.5)) % 1;
        const x = center.x + (a - 0.5) * BOX.w + slant * fall * 4, y = BOX.h * (1 - fall) - 1, z = center.z + (b - 0.5) * BOX.d;
        const o = i * 6;
        this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x + slant * len * 0.5; this.rainPos[o + 4] = y - len; this.rainPos[o + 5] = z;
      }
      this.rainGeo.setDrawRange(0, nRain * 2);
      (this.rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (nSnow > 0) {
      for (let i = 0; i < nSnow; i++) {
        const a = this.seeds[i * 3], b = this.seeds[i * 3 + 1], c = this.seeds[i * 3 + 2];
        const fall = (c + s * (0.08 + a * 0.05)) % 1;
        const o = i * 3;
        this.snowPos[o] = center.x + (a - 0.5) * BOX.w + Math.sin(s * 0.8 + c * 20) * 0.6 + slant * fall * 3;
        this.snowPos[o + 1] = BOX.h * (1 - fall) - 1;
        this.snowPos[o + 2] = center.z + (b - 0.5) * BOX.d + Math.cos(s * 0.6 + a * 20) * 0.4;
      }
      this.snowGeo.setDrawRange(0, nSnow);
      (this.snowGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.rainGeo.dispose(); this.rainMat.dispose();
    this.snowGeo.dispose(); this.snowMat.dispose();
    this.root.clear();
  }
}
