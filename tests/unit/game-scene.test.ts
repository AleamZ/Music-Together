import { describe, it, expect } from "vitest";
import { buildHallMap } from "@/lib/game/maps/hall";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, nearestInteractable, PROMPT_RANGE, stackBoxes } from "@/lib/game/scene";

const hall = buildHallMap();

describe("computeView", () => {
  it("picks the largest whole scale that keeps ~300×180 world px visible", () => {
    expect(computeView(960, 560, 640, 400)).toEqual({ scale: 3, vw: 320, vh: 187 });
    expect(computeView(1920, 1080, 640, 400)).toEqual({ scale: 6, vw: 320, vh: 180 });
  });
  it("zooms in on tall phone screens instead of showing past the map", () => {
    expect(computeView(750, 1624, 640, 400)).toEqual({ scale: 5, vw: 150, vh: 325 });
  });
  it("never goes below scale 1", () => {
    expect(computeView(100, 60, 640, 400).scale).toBe(1);
  });
});

describe("cameraFor", () => {
  it("centres on the head and clamps to the map", () => {
    expect(cameraFor({ x: 320, y: 200 }, 320, 180, 640, 400)).toEqual({ x: 160, y: 86 });
    expect(cameraFor({ x: 10, y: 10 }, 320, 180, 640, 400)).toEqual({ x: 0, y: 0 });
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400)).toEqual({ x: 320, y: 220 });
  });
  it("may scroll past the map's bottom by the HUD inset", () => {
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400, 30)).toEqual({ x: 320, y: 250 });
    expect(cameraFor({ x: 320, y: 200 }, 320, 180, 640, 400, 30)).toEqual({ x: 160, y: 86 });
  });
  it("centres the map when the view is bigger than it", () => {
    expect(cameraFor({ x: 0, y: 0 }, 800, 500, 640, 400)).toEqual({ x: -80, y: -50 });
  });
});

describe("hit tests", () => {
  it("finds interactables by their click rect", () => {
    expect(interactableAt(hall, { x: 320, y: 118 })?.id).toBe("dj_booth");
    expect(interactableAt(hall, { x: 596, y: 240 })?.id).toBe("notice_board");
    expect(interactableAt(hall, { x: 300, y: 250 })).toBeNull();
  });
  it("prompts only near an interactable's use spot", () => {
    expect(nearestInteractable(hall, { x: 320, y: 152 })?.id).toBe("dj_booth");
    expect(nearestInteractable(hall, { x: 320, y: 190 })).toBeNull();
  });
  it("hits a character's body box", () => {
    expect(hitsCharacter({ x: 100, y: 80 }, { x: 100, y: 100 })).toBe(true);
    expect(hitsCharacter({ x: 112, y: 80 }, { x: 100, y: 100 })).toBe(false);
    expect(hitsCharacter({ x: 100, y: 50 }, { x: 100, y: 100 })).toBe(false);
  });
});

describe("inUseRange", () => {
  it("is true within PROMPT_RANGE of the use spot and false just beyond it", () => {
    const booth = hall.interactables.find((i) => i.id === "dj_booth")!;
    expect(inUseRange(booth, booth.use)).toBe(true);
    expect(inUseRange(booth, { x: booth.use.x, y: booth.use.y + PROMPT_RANGE })).toBe(true);
    expect(inUseRange(booth, { x: booth.use.x, y: booth.use.y + PROMPT_RANGE + 1 })).toBe(false);
  });
});

describe("stackBoxes", () => {
  it("keeps boxes that do not overlap", () => {
    const boxes = [{ x: 0, y: 0, w: 10, h: 5 }, { x: 20, y: 0, w: 10, h: 5 }];
    expect(stackBoxes(boxes, 1, 1)).toEqual(boxes);
  });
  it("pushes an overlapping name tag down by its height + gap", () => {
    const out = stackBoxes([{ x: 0, y: 10, w: 30, h: 5 }, { x: 16, y: 10, w: 30, h: 5 }], 1, 1);
    expect(out[1]).toEqual({ x: 16, y: 16, w: 30, h: 5 });
  });
  it("stacks bubbles upwards but never above minY", () => {
    const b = { x: 0, y: 20, w: 30, h: 10 };
    const out = stackBoxes([b, { ...b, x: 5 }, { ...b, x: 5 }], -1, 2, 0);
    expect(out.map((o) => o.y)).toEqual([20, 8, 0]);
  });
});
