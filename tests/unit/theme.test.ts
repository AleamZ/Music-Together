import { describe, it, expect } from "vitest";
import { parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("returns 'cozy' only for the exact value", () => {
    expect(parseTheme("cozy")).toBe("cozy");
  });
  it("returns 'salon' for 'salon'", () => {
    expect(parseTheme("salon")).toBe("salon");
  });
  it("defaults to 'salon' for null / unknown / empty", () => {
    expect(parseTheme(null)).toBe("salon");
    expect(parseTheme("")).toBe("salon");
    expect(parseTheme("nope")).toBe("salon");
  });
});
