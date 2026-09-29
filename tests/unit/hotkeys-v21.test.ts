import { describe, it, expect } from "vitest";
import {
  HOTKEYS,
  HOTKEY_GROUPS,
  hotkeyFor,
  hotkeyLabel,
  withKey,
} from "@/lib/game/hotkeys";

const enabledCtx = { enabled: true, helpOpen: false, offer: false };

function ev(
  code: string,
  extra: Partial<Parameters<typeof hotkeyFor>[0]> = {},
): Parameters<typeof hotkeyFor>[0] {
  return {
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: document.body,
    ...extra,
  };
}

const numberRow = [
  { id: "profile", number: 1 },
  { id: "quests", number: 2 },
  { id: "profession", number: 3 },
  { id: "playerMarket", number: 4 },
  { id: "petCenter", number: 5 },
  { id: "world", number: 6 },
  { id: "photo", number: 7 },
] as const;

describe("hotkeys v21", () => {
  it.each(numberRow)(
    "resolves $id from Digit$number and Numpad$number",
    ({ id, number }) => {
      expect(hotkeyFor(ev(`Digit${number}`), enabledCtx)).toBe(id);
      expect(hotkeyFor(ev(`Numpad${number}`), enabledCtx)).toBe(id);
      expect(hotkeyLabel(id)).toBe(String(number));
      expect(
        HOTKEYS.find((hotkey) => hotkey.id === id),
      ).toMatchObject({ group: "hud", label: String(number) });
    },
  );

  it("formats labels and preserves existing letter-key labels", () => {
    expect(withKey("Hồ sơ", "profile")).toBe("Hồ sơ (1)");
    expect(hotkeyLabel("nope")).toBe("");
    expect(hotkeyLabel("wardrobe")).toBe("I");
    expect(hotkeyLabel("bag")).toBe("B");
    expect(hotkeyLabel("help")).toBe("H / ?");
  });

  it("ignores number keys when disabled or when help is open", () => {
    expect(hotkeyFor(ev("Digit1"), { ...enabledCtx, enabled: false })).toBeNull();
    expect(hotkeyFor(ev("Numpad1"), { ...enabledCtx, helpOpen: true })).toBeNull();
    expect(hotkeyFor(ev("KeyH"), { ...enabledCtx, helpOpen: true })).toBe("help");
    expect(hotkeyFor(ev("Slash"), { ...enabledCtx, helpOpen: true })).toBe("help");
  });

  it("ignores modifiers and repeated key events", () => {
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { repeat: true },
    ]) {
      expect(hotkeyFor(ev("Digit1", extra), enabledCtx)).toBeNull();
    }
  });

  it("ignores typing in an input", () => {
    const input = document.createElement("input");
    expect(hotkeyFor(ev("Digit1", { target: input }), enabledCtx)).toBeNull();
  });

  it("shares no non-external codes except KeyN for board and liftDecline", () => {
    const idsByCode = new Map<string, string[]>();

    for (const hotkey of HOTKEYS.filter((entry) => !entry.external)) {
      for (const code of hotkey.codes) {
        const ids = idsByCode.get(code) ?? [];
        ids.push(hotkey.id as string);
        idsByCode.set(code, ids);
      }
    }

    const shared = [...idsByCode].filter(([, ids]) => ids.length > 1);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.[0]).toBe("KeyN");
    expect(shared[0]?.[1].sort()).toEqual(["board", "liftDecline"]);
  });

  it("has unique non-external ids and valid groups", () => {
    const ids = HOTKEYS.filter((hotkey) => !hotkey.external && hotkey.id !== null)
      .map((hotkey) => hotkey.id);
    expect(new Set(ids).size).toBe(ids.length);

    const groups = new Set(HOTKEY_GROUPS.map(({ group }) => group));
    for (const hotkey of HOTKEYS) {
      expect(groups.has(hotkey.group)).toBe(true);
    }
  });
});
