import { describe, it, expect } from "vitest";
import { overlayLocks } from "@/lib/game/overlays";

const none = {
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, cardPanel: false, rulesBook: false,
};

describe("overlayLocks (the game shell's blocking and FarmOverlays' panelOpen)", () => {
  it("leaves the canvas and the farm work their input while nothing is open", () => {
    expect(overlayLocks(none)).toEqual({ blocking: false, panelOpen: false });
  });

  it("takes both while the anti-cheat warning or ban is open, so its Esc never cancels the farm work", () => {
    expect(overlayLocks({ ...none, anticheatModal: true })).toEqual({ blocking: true, panelOpen: true });
    expect(overlayLocks({ ...none, anticheatModal: true, farmWork: true })).toEqual({ blocking: true, panelOpen: true });
  });

  it("takes both for a shell panel, a fishing panel, the character editor, a card table or the rules book", () => {
    for (const open of ["panel", "fishingPanel", "creating", "cardPanel", "rulesBook"] as const) {
      expect(overlayLocks({ ...none, [open]: true })).toEqual({ blocking: true, panelOpen: true });
    }
  });

  it("takes only the canvas input for the field's own panel, the farm work, a round and a crab visit, whose Esc the field handles", () => {
    expect(overlayLocks({ ...none, farmPanel: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmWork: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmRound: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmCrab: true })).toEqual({ blocking: true, panelOpen: false });
  });
});
