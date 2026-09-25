/** A key typed into a text field is not a game key (spec §12); the same test as the engine's. Shared by the reel and
 *  the farm work progress. */
export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
