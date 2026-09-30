"use client";

import { useEffect, useRef, useState } from "react";
import type { MapId } from "@/lib/game/maps/types";
import { actionLine, currentQuest, guidance, type StoryState } from "@/lib/game/story/model";
import { CHAPTERS, STEP_BY_ID, STORY_STEPS } from "@/lib/game/story/scripts";
import { HudSlotted } from "../hud/HudSlot";

// "Chuyện làng" on the HUD: the chapter, the step, what to do now (the server's progress) and where — an arrow and the
// distance to the NPC on this map, or the way to their map. It folds to one line.

export function StoryTrackerCard({ state, mapId, me }: { state: StoryState; mapId: MapId; me: { x: number; y: number } | null }) {
  const [folded, setFolded] = useState(false);
  const q = currentQuest(state);
  if (!q || state.finished) return null;
  const def = STEP_BY_ID.get(q.id);
  const g = guidance(q, mapId, me);
  const n = STORY_STEPS.findIndex((s) => s.id === q.id);
  return (
    <section className="pch flex w-full max-w-[20rem] flex-col gap-1 p-2 font-vt leading-tight" data-testid="story-tracker"
      aria-label="Chuyện làng" aria-live="polite">
      <header className="flex items-center gap-1.5 text-base">
        <span className="flex-1 truncate opacity-80">🌸 {CHAPTERS[q.chapter] ?? "Chuyện làng"} · {n + 1}/{STORY_STEPS.length}</span>
        <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setFolded((f) => !f)}
          aria-expanded={!folded} title={folded ? "Mở" : "Thu gọn"}>{folded ? "▾" : "▴"}</button>
      </header>
      <p className={`text-xl ${q.status === "done" ? "text-emerald-700" : "text-burgundy"}`}>
        {q.status === "done" ? "✅ " : "▸ "}{q.title}
      </p>
      <p className="text-base" data-testid="story-action">
        {actionLine(q)}{q.status === "active" && q.goal > 1 ? ` (${q.progress}/${q.goal})` : ""}
      </p>
      {!folded && (
        <>
          {q.status === "active" && def && <p className="text-sm opacity-80">{def.hint}</p>}
          <p className="text-sm" data-testid="story-where">
            📍 {g.place}
            {g.here ? " — ngay đây, bấm E để nói chuyện" : g.arrow ? ` ${g.arrow} ${g.dist} bước` : ""}
          </p>
          {g.route && <p className="text-sm opacity-80">🧭 {g.route}</p>}
        </>
      )}
    </section>
  );
}

export default function StoryTracker({ state, mapId, getLocalPos }: {
  state: StoryState | null;
  mapId: MapId;
  /** My position on this map (none: no arrow, e.g. the 3D world). */
  getLocalPos?: () => { x: number; y: number } | null;
}) {
  const [me, setMe] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef(getLocalPos);
  useEffect(() => { posRef.current = getLocalPos; });
  const tracking = !!getLocalPos;
  useEffect(() => {
    if (!tracking) return;
    const id = window.setInterval(() => {
      const p = posRef.current?.() ?? null;
      setMe((o) => (p && o && Math.abs(o.x - p.x) < 4 && Math.abs(o.y - p.y) < 4 ? o : p ? { x: p.x, y: p.y } : null));
    }, 400);
    return () => window.clearInterval(id);
  }, [tracking]);
  if (!state || state.finished || !currentQuest(state)) return null;
  return <HudSlotted><StoryTrackerCard state={state} mapId={mapId} me={me} /></HudSlotted>;
}
