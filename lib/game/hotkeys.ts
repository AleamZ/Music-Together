import { isTyping } from "@/lib/game/keys";

/** The game HUD's keyboard shortcuts: one table (the help overlay lists it) and a pure resolver. A resolved action is
 *  carried out by the element marked `data-hotkey="<id>"` (clicked, or focused for a text field), so a key does only
 *  what its visible, enabled button would. Keys handled elsewhere (movement, E, R, M, Space/Esc in minigames) are
 *  listed with `external: true` and never resolved here. */

export type HotkeyGroup = "move" | "hud" | "pond" | "social" | "music" | "other";

export interface Hotkey {
  /** The action id (`data-hotkey` value); `null` for a key handled by its own listener. */
  id: string | null;
  /** KeyboardEvent.code values (layout independent). */
  codes: readonly string[];
  /** What the badge / help shows. */
  label: string;
  desc: string;
  group: HotkeyGroup;
  external?: true;
}

export const HOTKEY_GROUPS: ReadonlyArray<{ group: HotkeyGroup; title: string }> = [
  { group: "move", title: "Di chuyển & tương tác" },
  { group: "hud", title: "Đồ đạc & bảng" },
  { group: "pond", title: "Bờ ao" },
  { group: "social", title: "Trò chuyện & đi nhờ" },
  { group: "music", title: "Nhạc" },
  { group: "other", title: "Khác" },
];

export const HOTKEYS: readonly Hotkey[] = [
  { id: null, codes: ["KeyW", "KeyA", "KeyS", "KeyD"], label: "WASD / ←↑↓→", desc: "Đi lại", group: "move", external: true },
  { id: null, codes: ["KeyE"], label: "E", desc: "Tương tác, cứu người, xin đi nhờ / xuống xe / cho xuống", group: "move", external: true },
  { id: null, codes: ["KeyR"], label: "R", desc: "Lên / xuống xe", group: "move", external: true },
  { id: null, codes: ["Space"], label: "Space", desc: "Giật cần, kéo cá, thả lưới, minigame", group: "move", external: true },
  { id: null, codes: ["Escape"], label: "Esc", desc: "Thu cần, đóng bảng", group: "move", external: true },
  { id: "wardrobe", codes: ["KeyI"], label: "I", desc: "Tủ đồ", group: "hud" },
  { id: "bag", codes: ["KeyB"], label: "B", desc: "Giỏ đồ", group: "hud" },
  { id: "fish", codes: ["KeyF"], label: "F", desc: "Cất / lấy cá trên tay", group: "hud" },
  { id: "umbrellas", codes: ["KeyU"], label: "U", desc: "Ô của tôi", group: "hud" },
  { id: "dog", codes: ["KeyP"], label: "P", desc: "Chó của bạn", group: "hud" },
  { id: "farmTasks", codes: ["KeyG"], label: "G", desc: "Việc đồng áng (ở ruộng)", group: "hud" },
  { id: "settings", codes: ["KeyO"], label: "O", desc: "Cài đặt cá nhân", group: "hud" },
  { id: "zoom", codes: ["KeyZ"], label: "Z", desc: "Chỉnh zoom camera", group: "hud" },
  { id: null, codes: ["KeyM"], label: "M", desc: "Thu / mở bản đồ nhỏ", group: "hud", external: true },
  { id: "jump", codes: ["KeyJ"], label: "J", desc: "Nhảy xuống ao", group: "pond" },
  { id: "warmUp", codes: ["KeyK"], label: "K", desc: "Khởi động", group: "pond" },
  { id: "net", codes: ["KeyL"], label: "L", desc: "Quăng lưới", group: "pond" },
  { id: "chatFocus", codes: ["KeyT"], label: "T", desc: "Gõ tin nhắn", group: "social" },
  { id: "chat", codes: ["KeyC"], label: "C", desc: "Mở phòng chat", group: "social" },
  { id: "react", codes: ["KeyX"], label: "X", desc: "Thả cảm xúc", group: "social" },
  { id: "members", codes: ["KeyV"], label: "V", desc: "Thành viên", group: "social" },
  { id: "liftAccept", codes: ["KeyY"], label: "Y", desc: "Đồng ý cho đi nhờ", group: "social" },
  { id: "liftDecline", codes: ["KeyN"], label: "N", desc: "Từ chối đi nhờ (khi có người xin)", group: "social" },
  { id: "queue", codes: ["KeyQ"], label: "Q", desc: "Hàng đợi nhạc", group: "music" },
  { id: "board", codes: ["KeyN"], label: "N", desc: "Bảng tin", group: "music" },
  { id: "help", codes: ["KeyH", "Slash"], label: "H / ?", desc: "Bảng phím tắt", group: "other" },
];

export interface HotkeyContext {
  /** The world takes input (no panel, minigame, faint or trip holds the screen). */
  enabled: boolean;
  helpOpen: boolean;
  /** Someone is asking me for a lift (Y / N answer them; N is "Bảng tin" otherwise). */
  offer: boolean;
}

export type HotkeyEvent = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">;

/** The action a key press asks for, or null (typing, modifiers, a held key, a blocked screen, not ours). */
export function hotkeyFor(e: HotkeyEvent, ctx: HotkeyContext): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return null;
  // the open help closes on H / ? (Esc is the modal's own)
  if (ctx.helpOpen) return e.code === "KeyH" || e.code === "Slash" ? "help" : null;
  if (!ctx.enabled) return null;
  if (e.code === "KeyY") return ctx.offer ? "liftAccept" : null;
  if (e.code === "KeyN") return ctx.offer ? "liftDecline" : "board";
  const k = HOTKEYS.find((h) => !h.external && h.id !== null && h.codes.includes(e.code));
  return k?.id ?? null;
}

/** The label of an action's key ("B"), for badges and tooltips. */
export const hotkeyLabel = (id: string): string => HOTKEYS.find((h) => h.id === id)?.label ?? "";

/** "Giỏ đồ (B)". */
export const withKey = (text: string, id: string): string => `${text} (${hotkeyLabel(id)})`;
