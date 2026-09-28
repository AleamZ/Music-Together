import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DojoPanel from "@/components/game/fight/DojoPanel";
import { MARTIAL, TUITION, examFor } from "@/lib/game/fight/dojo";
import { enrollGate, examGate, practiceFighter, practiceGate, waitText } from "@/lib/game/fight/dojo-gates";
import type { DojoState, Enrollment } from "@/lib/game/fight/rpc";
import { DEFAULT_LOOK } from "@/lib/game/look";

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const VX = MARTIAL.find((m) => m.key === "vinhxuan")!;

function enr(over: Partial<Enrollment> = {}): Enrollment {
  return { style: VX.key, rank: 0, rankAtMs: NOW - 86_400_000, enrolledAtMs: NOW - 86_400_000, cooldownUntilMs: null, nextExamMs: null, ...over };
}
function st(over: Partial<DojoState> = {}): DojoState {
  return { enrollments: [enr()], uniforms: [VX.uniform], wearing: VX.uniform, prevOutfit: null, exam: null, serverNowMs: NOW, ...over };
}

describe("dojo gates", () => {
  it("formats waits", () => {
    expect(waitText(40_000)).toBe("40 giây");
    expect(waitText(12 * 60_000)).toBe("12 phút");
    expect(waitText(65 * 60_000)).toBe("1 giờ 5 phút");
    expect(waitText(3 * 86_400_000)).toBe("3 ngày");
  });

  it("gates enrolment on state, enrolment and coins", () => {
    expect(enrollGate(null, VX.key, 0).reason).toBe("Đang tải…");
    expect(enrollGate(st(), VX.key, 99_999).reason).toBe("Đã nhập môn");
    expect(enrollGate(st({ enrollments: [] }), VX.key, TUITION - 1).reason).toBe("Không đủ xu");
    expect(enrollGate(st({ enrollments: [] }), VX.key, TUITION).enabled).toBe(true);
  });

  it("gates the exam in the server's order", () => {
    const fee = examFor(1)!.fee;
    expect(examGate(st({ enrollments: [] }), VX.key, 1e6, NOW).reason).toBe("Chưa nhập môn");
    expect(examGate(st({ enrollments: [enr({ rank: 4 })] }), VX.key, 1e6, NOW).reason).toBe("Đã lên đai cao nhất");
    expect(examGate(st({ enrollments: [enr({ cooldownUntilMs: NOW + 30 * 60_000 })] }), VX.key, 1e6, NOW).reason).toBe("Thi lại sau 30 phút");
    expect(examGate(st({ enrollments: [enr({ nextExamMs: NOW + 90_000 })] }), VX.key, 1e6, NOW).reason).toBe("Thi được sau 2 phút");
    expect(examGate(st({ wearing: null }), VX.key, 1e6, NOW).reason).toBe("Mặc võ phục để thi");
    expect(examGate(st(), VX.key, fee - 1, NOW).reason).toBe("Không đủ xu");
    const ok = examGate(st(), VX.key, fee, NOW);
    expect(ok.enabled).toBe(true);
    expect(ok.label).toContain("Thi lên");
  });

  it("resumes a live exam of the style and blocks the others", () => {
    const exam = { id: "e", style: VX.key, targetRank: 1, fee: 1000, kataLength: 900, status: "spar" as const, startedAtMs: NOW, expiresAtMs: NOW + 1, match: null };
    expect(examGate(st({ exam }), VX.key, 0, NOW)).toMatchObject({ enabled: true, resume: "spar", label: "Vào sàn tập với thầy" });
    const other = MARTIAL.find((m) => m.key !== VX.key)!;
    const s2 = st({ exam, enrollments: [enr(), enr({ style: other.key })], wearing: other.uniform });
    expect(examGate(s2, other.key, 1e6, NOW).reason).toContain("Đang thi dở");
  });

  it("practises as the worn uniform's style", () => {
    expect(practiceGate(st({ wearing: null }), VX.key).reason).toBe("Mặc võ phục trước");
    expect(practiceGate(st(), VX.key).enabled).toBe(true);
    expect(practiceFighter({ ...DEFAULT_LOOK, outfit: VX.uniform }, st({ enrollments: [enr({ rank: 2 })] })).fighter).toEqual({ style: VX.id, rank: 2 });
    expect(practiceFighter(DEFAULT_LOOK, st()).styleName).toBe("Tự do");
    expect(practiceFighter({ ...DEFAULT_LOOK, outfit: VX.uniform }, null).fighter).toEqual({ style: 0, rank: 0 });
  });
});

describe("DojoPanel", () => {
  const props = (over: Partial<Parameters<typeof DojoPanel>[0]> = {}): Parameters<typeof DojoPanel>[0] => ({
    state: st(), error: null, coins: 1e6, tab: VX.id, nowMs: NOW, busy: false,
    onTab: vi.fn(), onEnroll: vi.fn(), onWear: vi.fn(), onUnwear: vi.fn(), onPractice: vi.fn(), onExam: vi.fn(), onClose: vi.fn(),
    ...over,
  });

  it("shows a tab per style and the style's master", () => {
    const p = props();
    render(<DojoPanel {...p} />);
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getAllByText(VX.master).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("tab")[0]);
    expect(p.onTab).toHaveBeenCalledWith(MARTIAL[0].id);
  });

  it("offers enrolment when not enrolled", () => {
    const p = props({ state: st({ enrollments: [], wearing: null }) });
    render(<DojoPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Nhập môn/ }));
    expect(p.onEnroll).toHaveBeenCalledWith(VX.key);
    expect(screen.queryByRole("button", { name: /Thi lên/ })).toBeNull();
  });

  it("disables the exam with the reason and a countdown", () => {
    render(<DojoPanel {...props({ state: st({ enrollments: [enr({ cooldownUntilMs: NOW + 65 * 60_000 })] }) })} />);
    expect((screen.getByRole("button", { name: /Thi lên/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId("gate-reason").map((e) => e.textContent)).toContain("Thi lại sau 1 giờ 5 phút");
  });

  it("asks to wear the uniform, and wears it", () => {
    const p = props({ state: st({ wearing: null }) });
    render(<DojoPanel {...p} />);
    const reasons = screen.getAllByTestId("gate-reason").map((e) => e.textContent);
    expect(reasons).toContain("Mặc võ phục để thi");
    expect(reasons).toContain("Mặc võ phục trước");
    fireEvent.click(screen.getByRole("button", { name: "Mặc võ phục" }));
    expect(p.onWear).toHaveBeenCalledWith(VX.key);
  });

  it("starts the exam and practice when open", () => {
    const p = props();
    render(<DojoPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Thi lên/ }));
    expect(p.onExam).toHaveBeenCalledWith(VX.key, expect.objectContaining({ enabled: true }));
    fireEvent.click(screen.getByRole("button", { name: "Luyện tập" }));
    expect(p.onPractice).toHaveBeenCalledWith(VX.key);
    fireEvent.click(screen.getByRole("button", { name: "Cởi võ phục" }));
    expect(p.onUnwear).toHaveBeenCalled();
  });

  it("locks the specials above the belt", () => {
    render(<DojoPanel {...props()} />);
    expect(screen.getAllByText(/🔒 Mở ở/).length).toBeGreaterThan(0);
  });

  it("disables everything while busy", () => {
    render(<DojoPanel {...props({ busy: true })} />);
    expect((screen.getByRole("button", { name: /Thi lên/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cởi võ phục" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
