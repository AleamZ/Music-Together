import { chunkArrays } from "./terrain-mesh";

// The terrain worker: builds chunk meshes off the main thread (the heightmap's noise and the land's colours are the
// costly part — ~10–40 ms a chunk at the finest level, the camera's stutter when it crossed a LOD ring). In: { id,
// chunk, step }; out: { id, chunk, step, arrays } with the buffers transferred.

interface Req { id: number; chunk: number; step: number }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown, t: Transferable[]): void };

ctx.onmessage = (e) => {
  const { id, chunk, step } = e.data;
  const a = chunkArrays(chunk, step);
  ctx.postMessage({ id, chunk, step, arrays: a }, [a.pos.buffer, a.nor.buffer, a.col.buffer, a.idx.buffer]);
};
