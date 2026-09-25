import { describe, it, expect } from "vitest";
import { previewPose } from "@/lib/game/art/preview";

describe("previewPose", () => {
  it("treats a first frame earlier than the start time as the start", () => {
    expect(previewPose(-0.004, false)).toEqual({ facing: "down", frame: 0 });
  });
  it("starts facing down on frame 0", () => {
    expect(previewPose(0, false)).toEqual({ facing: "down", frame: 0 });
  });
  it("turns every 1.2 s and steps 8 frames a second", () => {
    expect(previewPose(1.3, false)).toEqual({ facing: "left", frame: 2 });
    expect(previewPose(5, false)).toEqual({ facing: "down", frame: 0 });
  });
  it("keeps frame 0 when motion is reduced", () => {
    expect(previewPose(1.3, true)).toEqual({ facing: "left", frame: 0 });
  });
});
