import { describe, it, expect } from "vitest";
import { formatClock } from "@/lib/format";

describe("formatClock", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(74_000)).toBe("1:14");
    expect(formatClock(3_661_000)).toBe("61:01");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatClock(-500)).toBe("0:00");
  });
});
