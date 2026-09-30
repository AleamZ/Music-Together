"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Interactable } from "@/lib/game/maps/types";
import { claimFarmGift } from "@/lib/game/farm/rpc";
import { npcOfKind, type StoryNpcId } from "./npcs";
import { STEP_BY_ID, type DialogueLine } from "./scripts";
import { storyAccept, storyState, storyTurnIn } from "./rpc";
import { storyErrorMessage, talkTo, type StoryState } from "./model";

// The story chain on the client: the state (polled while a step is under way — its progress comes from the server's
// own records), and talking to an NPC (lib/game/story/model.ts `talkTo`): an offer (Nhận lời / Để sau), a hand-in (then
// the same NPC's next offer, Pokémon style), a hint or idle chatter. After a hint or chatter — and after an offer or a
// hand-in at a shop — the NPC's own panel opens as before (`resume`); bác Ba's log does not reopen after a talk.

export interface StoryDialog {
  lines: readonly DialogueLine[];
  choices?: { id: string; label: string }[];
  onDone: (choice: string | null) => void;
}

const POLL_MS = 8000;

export function useStory(token: string | null, opts: { toast: (t: string) => void; onCoins?: () => void }) {
  const [state, setState] = useState<StoryState | null>(null);
  const [dialog, setDialog] = useState<StoryDialog | null>(null);
  const stateRef = useRef<StoryState | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });
  /** Set by the layer: the shell's onInteract, to go on to the NPC's panel after a talk. */
  const resumeRef = useRef<((it: Interactable) => void) | null>(null);
  const bypass = useRef<string | null>(null);
  const heard = useRef<Set<string>>(new Set());
  /** run, for its own chaining (a hand-in into the same NPC's next offer). */
  const runRef = useRef<((npc: StoryNpcId, it: Interactable, s: StoryState, chained?: boolean) => Promise<void>) | null>(null);                             // hints / chatter already heard this session

  const put = useCallback((s: StoryState | null) => { stateRef.current = s; setState(s); }, []);
  const reload = useCallback(async () => {
    if (!token) return;
    try { put(await storyState(token)); } catch { /* an old server or offline: no story */ }
  }, [token, put]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = () => { if (alive && document.visibilityState !== "hidden") void reload(); };
    tick();
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (s && !s.finished) tick();
    }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [token, reload]);

  const resume = useCallback((it: Interactable) => {
    if (it.kind === "quest_giver" || !resumeRef.current) return;
    bypass.current = it.id;
    resumeRef.current(it);
  }, []);

  const say = useCallback((lines: readonly DialogueLine[], choices?: StoryDialog["choices"]) =>
    new Promise<string | null>((resolve) => {
      setDialog({ lines, choices, onDone: (c) => { setDialog(null); resolve(c); } });
    }), []);

  const run = useCallback(async (npc: StoryNpcId, it: Interactable, s: StoryState, chained = false): Promise<void> => {
    const t = talkTo(s, npc);
    if (!t || !token) return;
    const { toast, onCoins } = optsRef.current;
    if (t.mode === "idle" || t.mode === "progress") {
      if (chained) { resume(it); return; }
      await say(t.lines);
      heard.current.add(`${npc}:${t.quest?.id ?? "idle"}`);
      if (t.mode === "progress" && STEP_BY_ID.get(t.quest.id)?.claimFarmGift) {
        try { await claimFarmGift(token); } catch { /* shown by the next state */ }
        await reload();
        return;
      }
      resume(it);
      return;
    }
    if (t.mode === "offer") {
      const c = await say(t.lines, [{ id: "yes", label: "✔ Nhận lời" }, { id: "no", label: "Để sau" }]);
      if (c !== "yes") return;
      try {
        let next = await storyAccept(token, t.quest.id);
        toast(`📜 Nhận việc: ${t.quest.title}`);
        if (STEP_BY_ID.get(t.quest.id)?.claimFarmGift) {
          try { await claimFarmGift(token); next = await storyState(token); } catch { /* the hint retries */ }
        }
        put(next);
        // a step handed in to the same NPC and already done (a talk): straight on
        const q = next.quests.find((x) => x.id === t.quest.id);
        if (q?.status === "done" && q.turnin === npc) { await runRef.current?.(npc, it, next, true); return; }
      } catch (e) {
        toast(storyErrorMessage(e instanceof Error ? e.message : String(e)));
        return;
      }
      resume(it);
      return;
    }
    // turnin
    await say(t.lines);
    try {
      const next = await storyTurnIn(token, t.quest.id, it.use);
      put(next);
      const bits = [t.quest.coins > 0 ? `+${t.quest.coins} xu` : "", t.quest.xp > 0 ? `+${t.quest.xp} KN` : ""].filter(Boolean).join(" · ");
      toast(`🎉 Xong: ${t.quest.title}${bits ? ` (${bits})` : ""}`);
      onCoins?.();
      if (next.finished) return;
      await runRef.current?.(npc, it, next, true);
    } catch (e) {
      toast(storyErrorMessage(e instanceof Error ? e.message : String(e)));
    }
  }, [token, say, put, reload, resume]);
  useEffect(() => { runRef.current = run; }, [run]);

  /** The shell's onInteract asks first: true = the story took it (a dialogue opens). */
  const talk = useCallback((it: Interactable): boolean => {
    if (bypass.current === it.id) { bypass.current = null; return false; }
    const npc = npcOfKind(it.kind);
    const s = stateRef.current;
    if (!npc || !s || s.finished || dialog) return false;
    const t = talkTo(s, npc);
    if (!t) return false;
    if ((t.mode === "idle" || t.mode === "progress") && heard.current.has(`${npc}:${t.quest?.id ?? "idle"}`)
        && !(t.mode === "progress" && STEP_BY_ID.get(t.quest.id)?.claimFarmGift)) return false;
    void run(npc, it, s);
    return true;
  }, [dialog, run]);

  return { state, dialog, talk, reload, resumeRef };
}

export type StoryApi = ReturnType<typeof useStory>;
