// realtime-js hands back the existing channel for a topic even while that channel is still leaving,
// and a leaving channel never joins again. When a component unmounts and another one joins the same
// topic in the same commit (classic ↔ game switch), the new subscriber would silently get a dead
// channel. Joins therefore wait until the previous leave of the same topic has finished.

const leaving = new Map<string, Promise<void>>();

/** Resolves once the last leave of `topic` (if any) has settled. */
export function whenTopicFree(topic: string): Promise<void> {
  return leaving.get(topic) ?? Promise.resolve();
}

/** Record that `topic` is being left until `done` settles (success or failure). */
export function markLeaving(topic: string, done: Promise<unknown>): void {
  const settled = done.then(() => undefined, () => undefined);
  leaving.set(topic, settled);
  void settled.then(() => {
    if (leaving.get(topic) === settled) leaving.delete(topic);
  });
}
