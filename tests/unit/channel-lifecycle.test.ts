import { describe, it, expect } from "vitest";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("channel lifecycle", () => {
  it("a free topic resolves immediately", async () => {
    await expect(whenTopicFree("t:free")).resolves.toBeUndefined();
  });

  it("a join waits for the previous leave of the same topic only", async () => {
    const leave = deferred();
    markLeaving("t:a", leave.promise);
    let joinedA = false;
    let joinedB = false;
    void whenTopicFree("t:a").then(() => { joinedA = true; });
    void whenTopicFree("t:b").then(() => { joinedB = true; });
    await flush();
    expect(joinedA).toBe(false);
    expect(joinedB).toBe(true);
    leave.resolve();
    await flush();
    expect(joinedA).toBe(true);
  });

  it("a failed leave still frees the topic", async () => {
    const leave = deferred();
    markLeaving("t:c", leave.promise);
    leave.reject(new Error("timeout"));
    await expect(whenTopicFree("t:c")).resolves.toBeUndefined();
  });
});
