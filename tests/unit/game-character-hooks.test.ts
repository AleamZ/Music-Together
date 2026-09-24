import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";

const { fetchCharacters } = vi.hoisted(() => ({ fetchCharacters: vi.fn() }));
vi.mock("@/lib/game/character", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/character")>()),
  fetchCharacters: (ids: string[]) => fetchCharacters(ids),
}));

const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };

// braces matter: a function returned from beforeEach is run as a teardown
beforeEach(() => {
  fetchCharacters.mockReset();
});

describe("useMyCharacter", () => {
  it("loads my saved look", async () => {
    fetchCharacters.mockResolvedValue(new Map([["me", TAN]]));
    const { result } = renderHook(() => useMyCharacter("me"));
    expect(result.current.look).toBeNull();
    await waitFor(() => expect(result.current.look).toEqual(TAN));
    expect(result.current.exists).toBe(true);
  });
  it("reports a missing character (editor opens) with the default look", async () => {
    fetchCharacters.mockResolvedValue(new Map());
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).toEqual(DEFAULT_LOOK));
    expect(result.current.exists).toBe(false);
  });
  it("falls back to the default look when loading fails", async () => {
    fetchCharacters.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).toEqual(DEFAULT_LOOK));
    expect(result.current.exists).toBe(true);
  });
  it("setSaved replaces the look", async () => {
    fetchCharacters.mockResolvedValue(new Map());
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).not.toBeNull());
    act(() => result.current.setSaved(TAN));
    expect(result.current.look).toEqual(TAN);
    expect(result.current.exists).toBe(true);
  });
});

describe("useLooks", () => {
  it("fetches each account once and merges what exists", async () => {
    fetchCharacters.mockImplementation(async (ids: string[]) =>
      new Map(ids.filter((id) => id !== "b").map((id) => [id, TAN] as const)));
    const { result, rerender } = renderHook(({ ids }) => useLooks(ids), { initialProps: { ids: ["a", "b"] } });
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(TAN));
    rerender({ ids: ["b", "a", "c"] });
    await waitFor(() => expect(result.current.looks.has("c")).toBe(true));
    expect(fetchCharacters.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
    expect(result.current.looks.has("b")).toBe(false);
  });
  it("refresh re-fetches one account", async () => {
    fetchCharacters.mockResolvedValue(new Map([["a", TAN]]));
    const { result } = renderHook(() => useLooks(["a"]));
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(TAN));
    const PINK = { ...TAN, hairColor: "pink" as const };
    fetchCharacters.mockResolvedValue(new Map([["a", PINK]]));
    act(() => result.current.refresh("a"));
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(PINK));
  });
});
