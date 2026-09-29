import type * as THREE from "three";
import { chunkGeometry, geometryFromArrays, LOD_STEPS, type ChunkArrays } from "./terrain-mesh";

// Browser only: builds the terrain's chunk meshes off the main thread — a pool of workers (terrain.worker.ts), the
// results handed back as geometries on a later frame. Without workers (old browsers, tests) it falls back to one
// build per `pump()`, the old behaviour. The newest request for a chunk wins; stale results are still cached.

interface Done { id: number; chunk: number; step: number; arrays: ChunkArrays }

export class TerrainJobs {
  private readonly workers: Worker[] = [];
  private readonly busy: boolean[] = [];
  private readonly queue: Array<{ chunk: number; level: number; pri: number }> = [];
  private readonly pending = new Set<string>();
  private nextId = 1;

  constructor(private readonly onDone: (chunk: number, level: number, geo: THREE.BufferGeometry) => void, threads = 2) {
    if (typeof Worker === "undefined") return;
    try {
      for (let i = 0; i < threads; i++) {
        const w = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<Done>) => this.finish(i, e.data);
        w.onerror = () => { this.busy[i] = true; };                            // a dead worker takes no more jobs
        this.workers.push(w);
        this.busy.push(false);
      }
    } catch {
      this.workers.length = 0;
    }
  }

  get threaded(): boolean {
    return this.workers.length > 0;
  }

  /** Ask for a chunk at a level (a lower `pri` goes first); a repeat while it's queued only updates its priority. */
  request(chunk: number, level: number, pri: number): void {
    const key = `${chunk}:${level}`;
    const q = this.queue.find((j) => j.chunk === chunk && j.level === level);
    if (q) { q.pri = pri; return; }
    if (this.pending.has(key)) return;
    this.queue.push({ chunk, level, pri });
  }

  /** Drop the queued (not yet started) jobs: the camera moved on and will ask again. */
  clearQueue(): void {
    this.queue.length = 0;
  }

  /** Start jobs on idle workers (or build one here without workers). */
  pump(): void {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.pri - b.pri);
    if (!this.threaded) {
      const j = this.queue.shift()!;
      this.onDone(j.chunk, j.level, chunkGeometry(j.chunk, LOD_STEPS[j.level]));
      return;
    }
    for (let i = 0; i < this.workers.length && this.queue.length; i++) {
      if (this.busy[i]) continue;
      const j = this.queue.shift()!;
      this.busy[i] = true;
      this.pending.add(`${j.chunk}:${j.level}`);
      this.workers[i].postMessage({ id: this.nextId++, chunk: j.chunk, step: LOD_STEPS[j.level] });
    }
  }

  private finish(worker: number, d: Done): void {
    this.busy[worker] = false;
    const level = LOD_STEPS.indexOf(d.step as (typeof LOD_STEPS)[number]);
    this.pending.delete(`${d.chunk}:${level}`);
    this.onDone(d.chunk, level, geometryFromArrays(d.arrays));
    this.pump();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.queue.length = 0;
  }
}
