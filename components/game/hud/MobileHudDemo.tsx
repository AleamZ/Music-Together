"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { ChatFab, MobileDrawer, MobileMenuButton, MobileSheet, NoRide, type DrawerItem } from "./MobileHud";
import ReelOverlay from "../fishing/ReelOverlay";
import DialogueBox from "../story/DialogueBox";
import { TouchControls } from "./TouchHud";
import { StoryPill } from "../story/StoryTracker";
import HudChatBar from "../HudChatBar";
import VitalsHud from "../VitalsHud";
import type { StoryState } from "@/lib/game/story/model";

// Dev harness (app/dev/mobile-hud): the compact phone HUD with mocked data over a fake play area, to check the layout
// at phone landscape sizes without Supabase. Mirrors how GameShell wires the pieces when `useCompactHud()` is true.

const STORY: StoryState = {
  current: "s01_chao", finished: false, veteran: false,
  quests: [{
    id: "s01_chao", chapter: 1, title: "Gặp bác Ba Làng", objective: "Chào bác Ba", giver: "bac_ba_lang", turnin: "bac_ba_lang",
    kind: "talk", goal: 1, progress: 0, status: "active", coins: 50, xp: 10, item: null, itemQty: 0,
  }],
};

const GROUPS = [
  { id: "settings", icon: "⚙️", label: "Cài đặt" },
  { id: "bag", icon: "🎒", label: "Túi đồ", badge: 2 },
  { id: "play", icon: "🧭", label: "Hoạt động" },
  { id: "quests", icon: "📜", label: "Nhiệm vụ & tin tức", badge: true },
];

const noSubscribe = () => () => {};
const readFrame = () => {
  try { return new URLSearchParams(window.location.search).get("frame"); } catch { return null; }
};

export default function MobileHudDemo() {
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>("Xuống ao câu cá");
  const closeSheet = useCallback(() => setSheet(null), []);
  // ?frame=reel | bite | dialogue | busy: the overlays the real game puts over the compact HUD
  const asked = useSyncExternalStore(noSubscribe, readFrame, () => null);
  const [done, setDone] = useState(false);
  const frame = done ? null : asked;
  const setFrame = (f: null) => setDone(f === null);
  const dialogue = frame === "dialogue";
  const items: DrawerItem[] = [
    { id: "status", icon: "🧑", label: "Trạng thái" },
    ...GROUPS,
    { id: "map", icon: "🗺️", label: "Bản đồ", onPick: () => setToast("(bản đồ thế giới)") },
    { id: "ride", icon: "🚗", label: "Phương tiện" },
    { id: "chat", icon: "💬", label: "Chat" },
    { id: "members", icon: "👥", label: "Thành viên (3)" },
    { id: "classic", icon: "🖥️", label: "Giao diện cũ" },
  ];
  return (
    <div className="game-ui fixed inset-0 overflow-hidden bg-[#5a8f32] text-ink" data-testid="mobile-hud-demo" data-compact-hud="">
      <div aria-hidden="true" className="absolute inset-0"
        style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.08) 1px,transparent 1px)", backgroundSize: "32px 32px" }} />
      <div aria-hidden="true" className="absolute left-[55%] top-[45%] h-24 w-40 rounded-[50%] bg-[#3d8fd1]" />
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-8 w-6 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[#c0392b]" />

      <MobileMenuButton open={drawer} badge onOpen={() => { setSheet(null); setDrawer(true); }}
        vitals={{ hunger: 72, thirst: 41, stamina: 88, coins: 99_800_000 }} />
      <StoryPill state={STORY} mapId="hall" me={{ x: 0, y: 0 }} onExpand={() => setSheet("quests")} />
      <div className="pointer-events-none absolute left-1/2 top-[max(2.5rem,calc(env(safe-area-inset-top)+2.25rem))] z-20 max-w-[calc(100vw-14rem)] -translate-x-1/2" role="status">
        {toast && <p className="pch px-2 py-0.5 font-vt text-base leading-tight" data-testid="hud-toast" onAnimationEnd={() => setToast(null)}>{toast}</p>}
      </div>
      {frame === null && <button type="button" className="pch-btn pch-btn-primary absolute bottom-[max(3.75rem,calc(env(safe-area-inset-bottom)+3.25rem))] left-1/2 z-10 max-w-[calc(100vw-20rem)] -translate-x-1/2 truncate text-base">Câu cá</button>}
      {frame === "reel" && <ReelOverlay params={{ zonePct: 0.3, difficulty: 0.4, minReelMs: 600000, seed: 7 }} rarity={3} onDone={() => setFrame(null)} />}
      {(frame === "bite" || frame === "busy") && (
        <button type="button" className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 animate-pulse px-6 py-3 text-3xl motion-reduce:animate-none">❗ Giật cần!</button>
      )}
      {frame === "busy" && (
        <>
          <div className="pch absolute bottom-48 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 px-2 py-1 font-vt text-base">🪓 Gỗ 3 · 🔥 Lửa trại</div>
          <div className="absolute bottom-36 left-1/2 z-10 -translate-x-1/2"><button type="button" className="pch-btn text-xl">🛵 Đi nhờ xe</button></div>
          <p className="pch absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-2 font-vt text-2xl leading-none">Chợ Lớn</p>
        </>
      )}
      {dialogue && (
        <DialogueBox typeMs={0} lines={[{ speaker: "bac_ba_lang", text: "Con về rồi đó hả? Lại đây bác dặn chút chuyện trong làng nè." }]}
          choices={[{ id: "ok", label: "Dạ, con nghe" }, { id: "later", label: "Để lát nữa" }]} onDone={() => setFrame(null)} />
      )}
      <TouchControls disabled={drawer || sheet !== null || dialogue} />
      {!drawer && sheet === null && <ChatFab onOpen={() => setSheet("chat")} />}

      <MobileDrawer open={drawer} items={items} onClose={() => setDrawer(false)} onPick={(id) => { setDrawer(false); setSheet(id); }} />
      <MobileSheet id="status" title="🧑 Trạng thái" open={sheet === "status"} onClose={closeSheet}>
        <div className="pch flex flex-col gap-1.5 p-1.5 font-vt leading-none" data-testid="player-hud">
          <span className="text-xl">⭐ 12 · Smew</span>
          <span className="text-base">🪙 99.800.000 xu · ☀️ 31°C</span>
          <div className="border-t-2 border-parchment-300 pt-1.5 text-sm"><VitalsHud state={null} nag={false} /></div>
          <span className="text-sm">🎣 Mồi 12 · Cá 3 · Ra Chợ Lớn ăn uống</span>
        </div>
      </MobileSheet>
      {GROUPS.map((g) => (
        <MobileSheet key={g.id} id={g.id} title={`${g.icon} ${g.label}`} open={sheet === g.id} onClose={closeSheet}>
          <div className="grid grid-cols-2 gap-1 text-lg">
            {["Mục 1", "Mục 2", "Mục 3", "Mục 4"].map((x) => <button key={x} type="button" className="pch-btn min-h-11">{x}</button>)}
          </div>
        </MobileSheet>
      ))}
      <MobileSheet id="ride" title="🚗 Phương tiện" open={sheet === "ride"} onClose={closeSheet}>
        {frame === "noride" ? <NoRide onMap={closeSheet} /> : (
          <div className="flex flex-wrap gap-1.5 text-lg">
            <button type="button" className="pch-btn min-h-11" onClick={closeSheet}>🛵 Xe máy</button>
            <button type="button" className="pch-btn min-h-11" onClick={closeSheet}>🚲 Xe đạp</button>
          </div>
        )}
      </MobileSheet>
      <MobileSheet id="chat" title="💬 Chat" open={sheet === "chat"} onClose={closeSheet}>
        <div className="flex justify-center pt-1">
          <HudChatBar onSend={async () => {}} onReact={() => {}} onOpenChat={() => {}} onOpenMembers={() => {}} onlineCount={3} onExitGame={() => {}} />
        </div>
      </MobileSheet>
    </div>
  );
}
