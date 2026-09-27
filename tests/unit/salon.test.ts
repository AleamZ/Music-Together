import { describe, expect, it } from "vitest";
import { salonErrorMessage, salonPrice } from "@/lib/game/salon";

describe("salonPrice", () => {
  const cur = { hair: "short", hairColor: "black" } as const;
  it("charges 300 for a style, 500 for a colour, 700 for both, and nothing for no change", () => {
    expect(salonPrice(cur, { hair: "curly", hairColor: "black" })).toBe(300);
    expect(salonPrice(cur, { hair: "short", hairColor: "blue" })).toBe(500);
    expect(salonPrice(cur, { hair: "bun", hairColor: "red" })).toBe(700);
    expect(salonPrice(cur, { hair: "short", hairColor: "black" })).toBeNull();
  });
  it("mirrors the prices in 0029's salon_style", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0029_fashion2.sql", "utf8");
    for (const n of ["300", "500", "700"]) expect(sql).toContain(n);
  });
});

describe("salonErrorMessage", () => {
  it("maps the server errors to Vietnamese", () => {
    expect(salonErrorMessage({ message: "no change" })).toMatch(/đang để rồi/);
    expect(salonErrorMessage({ message: "insufficient funds" })).toBe("Không đủ xu để làm tóc.");
    expect(salonErrorMessage({ message: "invalid option" })).toBe("Anh Ba không làm kiểu tóc này.");
    expect(salonErrorMessage(new Error("boom"))).toBe("Chưa làm tóc được, thử lại nhé.");
  });
});
