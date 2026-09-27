import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ChangelogCarousel } from "@/components/game/news/ChangelogCarousel";
import NewsModal from "@/components/game/NewsModal";
import { CHANGELOG_2026_09_28, CHANGELOG_ID, CHANGELOG_IMG_DIR, CHANGELOG_SECTIONS } from "@/lib/game/news/changelog";
import {
  CHANGELOG_POPUP_MS, CHANGELOG_PUBLISHED_AT, CHANGELOG_SEEN_KEY, changelogDue, resetChangelogSeenMemo, useChangelogPopup,
} from "@/lib/game/news/changelog-seen";
import { EMPTY_FEED } from "@/lib/game/news/news";

afterEach(cleanup);

const cards = CHANGELOG_2026_09_28;
const imgPath = (f: string) => join(process.cwd(), "public", CHANGELOG_IMG_DIR, f);

describe("the 25–28/9 bulletin data", () => {
  it("has unique ids, known sections and short how-tos", () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    const sections = new Set(CHANGELOG_SECTIONS.map((s) => s.id));
    for (const c of cards) {
      expect(sections.has(c.section), c.id).toBe(true);
      expect(c.title.trim(), c.id).not.toBe("");
      expect(c.howTo.length, c.id).toBeGreaterThan(0);
      expect(c.howTo.length, c.id).toBeLessThanOrEqual(4);
    }
  });
  it("gives each kind what it needs", () => {
    for (const c of cards) {
      if (c.kind === "changed") {
        expect(c.oldText.trim(), c.id).not.toBe("");
        expect(c.newText.trim(), c.id).not.toBe("");
      } else {
        expect(c.purpose.trim(), c.id).not.toBe("");
      }
    }
  });
  it("points only at pictures that exist", () => {
    for (const c of cards) {
      const files = c.kind === "changed" ? [c.oldImg, c.newImg] : [c.img];
      for (const f of files) if (f) expect(existsSync(imgPath(f)), `${c.id}: ${f}`).toBe(true);
    }
  });
});

describe("the carousel", () => {
  it("moves with the buttons and the arrow keys, and stops at the ends", () => {
    render(<ChangelogCarousel />);
    const count = () => screen.getByTestId("changelog-count").textContent;
    expect(count()).toBe(`1/${cards.length}`);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(count()).toBe(`1/${cards.length}`);
    fireEvent.click(screen.getByLabelText("Thẻ sau"));
    expect(count()).toBe(`2/${cards.length}`);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(count()).toBe(`3/${cards.length}`);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(count()).toBe(`2/${cards.length}`);
  });
  it("jumps to a section and shows compare columns or the new badge", () => {
    render(<ChangelogCarousel />);
    fireEvent.click(screen.getByRole("tab", { name: /Thú cưng/ }));
    const pets = cards.findIndex((c) => c.section === "pets");
    expect(screen.getByTestId("changelog-count").textContent).toBe(`${pets + 1}/${cards.length}`);
    expect(screen.getByTestId("changelog-new")).toBeTruthy();
    const changed = cards.findIndex((c) => c.kind === "changed");
    cleanup();
    render(<ChangelogCarousel cards={[cards[changed]]} />);
    expect(screen.getByTestId("changelog-compare")).toBeTruthy();
  });
  it("turns on a swipe", () => {
    render(<ChangelogCarousel />);
    const deck = screen.getByTestId("changelog-card").parentElement!.parentElement!;
    fireEvent.pointerDown(deck, { clientX: 300, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(deck, { clientX: 200, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(deck, { clientX: 200, pointerId: 1, pointerType: "touch" });
    expect(screen.getByTestId("changelog-count").textContent).toBe(`2/${cards.length}`);
  });
  it("shows a placeholder when a card has no picture", () => {
    render(<ChangelogCarousel cards={[{ id: "x", section: "system", kind: "new", emoji: "🧪", title: "T", date: "28/9", purpose: "p", howTo: ["a"], tags: [] }]} />);
    expect(screen.getByTestId("changelog-placeholder")).toBeTruthy();
  });
  it("opens from the pinned item at the news stand", () => {
    render(<NewsModal feed={EMPTY_FEED} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("changelog-open"));
    expect(screen.getByTestId("changelog")).toBeTruthy();
  });
});

describe("the bulletin popup", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetChangelogSeenMemo();
  });
  afterEach(() => vi.useRealTimers());

  it("is due only while fresh and unseen", () => {
    const t = CHANGELOG_PUBLISHED_AT + 1000;
    expect(changelogDue(null, t)).toBe(true);
    expect(changelogDue(CHANGELOG_ID, t)).toBe(false);
    expect(changelogDue("older", t)).toBe(true);
    expect(changelogDue(null, CHANGELOG_PUBLISHED_AT + CHANGELOG_POPUP_MS)).toBe(false);
  });
  it("shows once, then stays closed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CHANGELOG_PUBLISHED_AT + 60_000);
    const { result } = renderHook(() => useChangelogPopup());
    expect(result.current.due).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.due).toBe(false);
    expect(window.localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe(CHANGELOG_ID);
  });
});
