// What the game shell's open overlays take from the world (the v13/v14 input rules; anti-cheat spec §12.1). Pure.

/** Which overlays of the game shell are open. */
export interface OpenOverlays {
  /** The shell's own panel: the queue, the board, the settings, the members, the chat or the wardrobe. */
  panel: boolean;
  /** A fishing panel: the bag, the depot, the shop or the records. */
  fishingPanel: boolean;
  /** The character editor of a first visit. */
  creating: boolean;
  /** The anti-cheat warning or ban. */
  anticheatModal: boolean;
  /** One of the field's own panels. */
  farmPanel: boolean;
  /** Transplanting or harvesting is under way. */
  farmWork: boolean;
}

/** `blocking`: the canvas takes no input. `panelOpen`: an overlay outside the field's own is open, so an Esc is its own
 *  and does not cancel the farm work (the field minds its own panels). */
export function overlayLocks(o: OpenOverlays): { blocking: boolean; panelOpen: boolean } {
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal;
  return { blocking: panelOpen || o.farmPanel || o.farmWork, panelOpen };
}
