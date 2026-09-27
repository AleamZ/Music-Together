import { describe, it, expect } from "vitest";
import { parseVitals, vitalsErrorMessage } from "@/lib/game/vitals-rpc";
import { fishingErrorMessage } from "@/lib/game/fishing/rpc";
import { farmErrorMessage } from "@/lib/game/farm/messages";

describe("vitals rpc", () => {
  it("parses the server json", () => {
    expect(parseVitals({ hunger: 12.5, thirst: 0, fainted_until_ms: null, server_now_ms: 1000 }))
      .toEqual({ hunger: 12.5, thirst: 0, faintedUntilMs: null, serverNowMs: 1000 });
    expect(parseVitals({ hunger: "x" })).toBeNull();
    expect(parseVitals(null)).toBeNull();
  });
  it("maps the guard errors to Vietnamese, also through the fishing and farm maps", () => {
    const fns: ((m: string) => string | null)[] = [
      vitalsErrorMessage,
      (m) => fishingErrorMessage({ message: m }),
      (m) => farmErrorMessage({ message: m }),
    ];
    for (const f of fns) {
      expect(f("too hungry")).toMatch(/đói/i);
      expect(f("too thirsty")).toMatch(/khát/i);
      expect(f("fainted")).toMatch(/ngất/i);
    }
  });
});
