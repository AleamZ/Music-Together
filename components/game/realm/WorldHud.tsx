"use client";

// v21 "world" (0075): the world HUD — the 🌍 button (the panel), the boss banner, the action bar next to a wild animal,
// the strike button in a boss arena (K), the stall / gate shortcuts and the last party chat line.
import { useEffect, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import {
  ACT_RANGE, GATE, MAX_COMBO, STALL, beat, inArena, near, speciesOf, type WildAction,
} from "@/lib/game/realm/model";
import type { MapId } from "@/lib/game/maps/types";
import type { WildAnimal } from "@/lib/game/realm/rpc";
import { animalAt, useWorld } from "./useWorld";
import WorldPanel, { type WorldTab } from "./WorldPanel";
import KeyBadge from "../KeyBadge";
import WildGame from "./WildGame";
import ComboGame from "./ComboGame";

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const vnTime = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(11, 16);

export default function WorldHud(props: {
  token: string;
  roomId: string;
  accountId: string;
  isOwner: boolean;
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  /** Another overlay holds the screen: no keys, no action bar. */
  blocked: boolean;
  toast: (text: string) => void;
  onCoins: () => void;
  onWeather: () => void;
  /** The panel opened or closed (it holds the input like any panel). */
  onPanel: (open: boolean) => void;
}) {
  const { mapId, blocked, onPanel } = props;
  const w = useWorld(props);
  const [tab, setTab] = useState<WorldTab | null>(null);
  const open = (t: WorldTab | null) => setTab(t);
  // v22: a minigame holds the input like a panel
  const gameOpen = w.wild !== null || w.combo !== null;
  useEffect(() => { onPanel(tab !== null || gameOpen); }, [gameOpen, tab, onPanel]);

  const s = w.state;
  const now = w.here.now + w.offset;
  const pos = w.here.pos;

  // the nearest animal in photo range
  let target: { a: WildAnimal; d: number } | null = null;
  if (s?.wild && pos) {
    for (const a of s.wild.animals) {
      if (now >= a.expiresMs) continue;
      const p = animalAt(a, now);
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d <= ACT_RANGE.photo && (!target || d < target.d)) target = { a, d };
    }
  }
  const fight = s?.fights.find((f) => f.status === "up" && now >= f.startsMs && now < f.endsMs && inArena(mapId, pos, { map: f.map, ...f.arena })) ?? null;
  const since = w.lastHit ? w.here.now - w.lastHit.at : Infinity;
  const b = beat(since);

  // K strikes the boss in whose arena I stand
  const canStrike = fight !== null && !blocked && !w.busy && !gameOpen && b !== "wait";
  useEffect(() => {
    if (!canStrike || !fight) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "KeyK" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      e.preventDefault();
      w.attack(fight);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStrike, fight, w]);

  const banner = s?.fights.find((f) => f.status === "up" && now < f.endsMs) ?? null;
  const lastChat = s?.party?.chat.at(-1) ?? null;
  const chatFresh = lastChat !== null && now - lastChat.atMs < 60_000;
  const atStall = near(mapId, pos, STALL, 56);
  const atGate = near(mapId, pos, GATE, 56);
  const sp = target ? speciesOf(target.a.species) : null;
  const danger = sp !== null && sp.danger > 0 && s?.night === true;

  const actBtn = (action: WildAction, label: string, ok: boolean) => (
    <button key={action} type="button" className="pch-btn px-2 py-0.5 text-base" disabled={!ok || w.busy} onClick={() => target && w.act(target.a, action)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="pointer-events-none absolute bottom-24 left-2 z-10 flex max-w-[calc(100vw-1rem)] flex-col items-start gap-1 font-vt">
        {banner && (
          <button type="button" className="pch pointer-events-auto px-2 py-1 text-left text-base leading-tight" onClick={() => open("boss")}>
            {now < banner.startsMs ? "📣" : "⚔️"} <b>{banner.name}</b>{" "}
            {now < banner.startsMs ? `xuất hiện sau ${clock(banner.startsMs - now)}` : `còn ${clock(banner.endsMs - now)} · ${Math.round((100 * banner.hp) / Math.max(1, banner.maxHp))}% máu`}
            {" · "}{banner.map === "pond" ? "Ao câu cá" : "Bãi đất trống"}
          </button>
        )}
        {chatFresh && lastChat && (
          <button type="button" className="pch pointer-events-auto max-w-72 truncate px-2 py-0.5 text-sm" onClick={() => open("party")} title="Chat tổ đội">
            👥 <b>{lastChat.name}:</b> {lastChat.body}
          </button>
        )}
        <div className="pointer-events-auto flex gap-1">
          <button type="button" className="pch-btn relative px-2 py-0.5 text-base" title="Thế giới: săn bắt, tổ đội, boss, hầm ngục (6)" data-hotkey="world" onClick={() => open("world")}>
            {s?.night ? "🌙" : "🌍"}<span className="sr-only"> Thế giới</span><KeyBadge id="world" />
            {(s?.invites.length ?? 0) > 0 && <span className="ml-0.5 text-red-700">✉️</span>}
          </button>
          {atStall && <button type="button" className="pch-btn px-2 py-0.5 text-base" onClick={() => open("wild")}>{s?.night ? "🏮 Chợ đêm" : "🏹 Sạp thợ săn"}</button>}
          {atGate && <button type="button" className="pch-btn px-2 py-0.5 text-base" onClick={() => open("dungeon")}>🕳️ Hầm ngục</button>}
        </div>
      </div>

      {!blocked && !gameOpen && target && sp && !fight && (
        <div className="pch pointer-events-auto absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 px-2 py-1 font-vt text-base">
          <span className="mr-1">{sp.name}{danger ? " ⚠️ nguy hiểm" : ""}</span>
          {sp.hunt > 0 && actBtn("hunt", "🏹 Săn", target.d <= ACT_RANGE.hunt)}
          {sp.trap > 0 && actBtn("trap", "🪤 Bẫy", target.d <= ACT_RANGE.trap)}
          {actBtn("photo", target.a.photographed ? "📷 Đã chụp" : "📷 Chụp", !target.a.photographed)}
        </div>
      )}

      {!blocked && !gameOpen && fight && (
        <div className="pointer-events-auto absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 font-vt">
          <div className="pch px-2 py-0.5 text-sm tabular-nums">
            Góp {fight.myDmg}/{fight.cap} · combo {fight.myCombo}/{MAX_COMBO}
            {w.lastHit && since < 1500 && <b className="ml-2 text-red-700">−{w.lastHit.dmg}{w.lastHit.combo > 0 ? ` ×${w.lastHit.combo}` : ""}</b>}
          </div>
          <button type="button" disabled={!canStrike || fight.myDmg >= fight.cap}
            className={`pch-btn pch-btn-primary px-4 py-1 text-xl ${b === "beat" ? "ring-4 ring-amber-400" : ""}`}
            onClick={() => w.attack(fight)} title="Tung chuỗi đòn: bấm mũi tên đúng nhịp, né khi boss vung đòn">
            ⚔️ Đánh <span className="pointer-coarse:hidden">(K)</span>
          </button>
        </div>
      )}

      {w.wild && <WildGame view={w.wild} onEnd={w.wildEnd} onClose={w.wildClose} />}
      {w.combo && <ComboGame view={w.combo} onEnd={w.comboEnd} onClose={w.comboClose} />}

      {tab && s && (
        <WorldPanel tab={tab} onTab={setTab} onClose={() => open(null)} world={w} state={s} now={now} mapId={mapId} pos={pos}
          isOwner={props.isOwner} accountId={props.accountId} atStall={atStall} atGate={atGate} vnTime={vnTime} clock={clock} />
      )}
    </>
  );
}
