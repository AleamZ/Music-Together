import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import DialogueBox from "@/components/game/story/DialogueBox";
import { StoryTrackerCard } from "@/components/game/story/StoryTracker";
import { parseStoryState } from "@/lib/game/story/model";
import { STORY_STEPS } from "@/lib/game/story/scripts";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const LINES = [
  { speaker: "co_ba" as const, text: "Chào con!" },
  { speaker: "hoa" as const, text: "Đi thôi." },
];
const text = () => screen.getByTestId("dialogue-text").textContent ?? "";
const typed = () => (screen.getByTestId("dialogue-text").firstChild?.textContent ?? "");

describe("DialogueBox", () => {
  it("types the line, the first press shows it whole, the next goes on, the last closes", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    render(<DialogueBox lines={LINES} onDone={done} typeMs={20} />);
    expect(screen.getByTestId("dialogue-speaker").textContent).toBe("Cô Ba");
    expect(text()).toBe("Chào con!");                                   // the rest is laid out, invisible
    act(() => { vi.advanceTimersByTime(60); });
    expect(typed().length).toBeGreaterThan(0);
    expect(typed().length).toBeLessThan("Chào con!".length);
    fireEvent.keyDown(window, { code: "Space" });                        // skip the typewriter
    expect(typed()).toBe("Chào con!");
    fireEvent.click(screen.getByTestId("dialogue-next"));                // next line
    expect(screen.getByTestId("dialogue-speaker").textContent).toBe("Chị Hoa");
    fireEvent.keyDown(window, { code: "Enter" });                        // skip
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialogue-next").textContent).toBe("▶ Xong");
    fireEvent.click(screen.getByRole("dialog"));                         // a tap anywhere on the box
    expect(done).toHaveBeenCalledWith(null);
  });

  it("offers the choices on the last line, Enter picks the first, Esc closes without one", () => {
    const done = vi.fn();
    render(<DialogueBox lines={LINES.slice(0, 1)} typeMs={0} onDone={done}
      choices={[{ id: "yes", label: "✔ Nhận lời" }, { id: "no", label: "Để sau" }]} />);
    expect(screen.queryByTestId("dialogue-next")).toBeNull();
    fireEvent.click(screen.getByText("Để sau"));
    expect(done).toHaveBeenLastCalledWith("no");
    fireEvent.keyDown(window, { code: "Enter" });
    expect(done).toHaveBeenLastCalledWith("yes");
    fireEvent.keyDown(window, { code: "Escape" });
    expect(done).toHaveBeenLastCalledWith(null);
  });

  it("keeps Space from reaching the game", () => {
    const game = vi.fn();
    document.addEventListener("keydown", game);
    render(<DialogueBox lines={LINES} typeMs={0} onDone={() => {}} />);
    fireEvent.keyDown(window, { code: "Space" });
    expect(game).not.toHaveBeenCalled();
    document.removeEventListener("keydown", game);
  });
});

describe("StoryTrackerCard", () => {
  const state = (status: string, extra: Record<string, unknown> = {}) => parseStoryState({
    current: "s06_xo", finished: false, veteran: false,
    quests: STORY_STEPS.map((s) => ({ id: s.id, chapter: s.chapter, title: s.id === "s06_xo" ? "Xô đầy cá" : s.id, objective: "Câu thêm 3 con cá.",
      giver: "co_ba", turnin: "co_ba", kind: "catch", goal: 3, progress: 1, status: s.id === "s06_xo" ? status : "claimed", coins: 0, xp: 0, ...extra })),
  })!;

  it("shows the chapter, the objective with the server's progress, and the arrow to the NPC", () => {
    render(<StoryTrackerCard state={state("active")} mapId="pond" me={{ x: 570, y: 340 }} />);
    expect(screen.getByTestId("story-tracker").textContent).toContain("Chương 3");
    expect(screen.getByTestId("story-action").textContent).toBe("Câu thêm 3 con cá. (1/3)");
    expect(screen.getByTestId("story-where").textContent).toContain("↑ 200 bước");
  });

  it("says to go back when done, and the way from another map", () => {
    render(<StoryTrackerCard state={state("done")} mapId="hall" me={null} />);
    expect(screen.getByTestId("story-action").textContent).toBe("Quay lại cô Ba để báo xong");
    expect(screen.getByTestId("story-tracker").textContent).toContain("Bến câu cá");
  });

  it("shows nothing when the chain is finished", () => {
    const s = { ...state("claimed"), finished: true, current: null };
    const { container } = render(<StoryTrackerCard state={s} mapId="hall" me={null} />);
    expect(container.textContent).toBe("");
  });
});
