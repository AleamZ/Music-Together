"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// The HUD's grouped menu: a handful of entry buttons (⚙️ Cài đặt, 🎒 Túi đồ, 🧭 Hoạt động, 📜 Nhiệm vụ…), at most one
// group open at a time, every group closed for a newcomer. The open group is remembered per browser (storage guarded).
//
// A closed group's buttons stay in the DOM (hidden), so a hotkey still finds and clicks its `data-hotkey` element
// (hooks/useHotkeys). A hotkey whose control lives in place inside a group (the camera zoom) sends `hud-reveal`, which
// opens that group and its tab (see `revealFor`).

export const HUD_GROUP_KEY = "mt.hud.group";
export const HUD_REVEAL = "hud-reveal";

const noSubscribe = () => () => {};

export function readHudGroup(): string | null {
  try {
    const v = window.localStorage.getItem(HUD_GROUP_KEY);
    return v ? v : null;
  } catch {
    return null;
  }
}

/** The open group (null: all closed — the default) and its setter, remembered per browser. */
export function useHudGroup(): [string | null, (g: string | null) => void] {
  const stored = useSyncExternalStore(noSubscribe, readHudGroup, () => null);
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const set = (g: string | null) => {
    setChoice(g);
    try {
      if (g) window.localStorage.setItem(HUD_GROUP_KEY, g);
      else window.localStorage.removeItem(HUD_GROUP_KEY);
    } catch { /* storage blocked: this page only */ }
  };
  return [choice === undefined ? stored : choice, set];
}

/** Opens the group (and tab) around an element a hotkey is about to use, when it sits in a `data-hud-reveal` part. */
export function revealFor(el: Element): void {
  const at = el.closest("[data-hud-reveal]");
  if (at) at.dispatchEvent(new Event(HUD_REVEAL, { bubbles: true }));
}

function useReveal(onReveal: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(onReveal);
  useEffect(() => { live.current = onReveal; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => live.current();
    el.addEventListener(HUD_REVEAL, on);
    return () => el.removeEventListener(HUD_REVEAL, on);
  }, []);
  return ref;
}

export interface HudGroup {
  id: string;
  icon: string;
  label: string;
  /** A red count (or dot for `true`) on the entry button. */
  badge?: number | boolean;
  /** The group button's hotkey id (clicking it toggles the group). */
  hotkey?: string;
  hotkeyBadge?: ReactNode;
  content: ReactNode;
}

function Badge({ badge }: { badge?: number | boolean }) {
  if (!badge) return null;
  return typeof badge === "number"
    ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-0.5 text-center font-sans text-[10px] leading-4 text-white">{Math.min(99, badge)}</span>
    : <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />;
}

function GroupPanel({ group, open, onOpen, onClose }: { group: HudGroup; open: boolean; onOpen: () => void; onClose: () => void }) {
  const ref = useReveal(onOpen);
  return (
    <div ref={ref} id={`hud-group-${group.id}`} role="region" aria-label={group.label} hidden={!open}
      data-testid={`hud-group-${group.id}`}
      className="pch pointer-events-auto flex max-h-[min(70vh,calc(100dvh-8rem))] flex-col gap-1.5 overflow-y-auto p-1.5 font-vt pointer-coarse:fixed pointer-coarse:inset-x-0 pointer-coarse:bottom-0 pointer-coarse:z-50 pointer-coarse:max-h-[80dvh] pointer-coarse:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl leading-none">{group.icon} {group.label}</h2>
        <button type="button" className="pch-btn inline-flex h-9 min-w-9 items-center justify-center pointer-coarse:h-11 pointer-coarse:min-w-11" aria-label="Đóng" onClick={onClose}>✕</button>
      </div>
      {group.content}
    </div>
  );
}

/** The entry row and the open group's panel under it. */
export function HudMenu({ groups, open, onOpen }: { groups: readonly HudGroup[]; open: string | null; onOpen: (g: string | null) => void }) {
  return (
    <div className="pointer-events-none flex flex-col gap-1.5" data-testid="hud-menu">
      <nav className="pch pointer-events-auto flex flex-wrap items-center gap-1 self-start p-1 font-vt text-lg leading-none" aria-label="Menu" data-testid="hud-toolbar">
        {groups.map((g) => (
          <button key={g.id} type="button" data-testid={`hud-open-${g.id}`} data-hotkey={g.hotkey}
            className={`pch-btn relative inline-flex h-9 min-w-9 items-center justify-center gap-1 px-1.5 py-0 pointer-coarse:h-11 pointer-coarse:min-w-11 ${open === g.id ? "pch-btn-primary" : ""}`}
            aria-expanded={open === g.id} aria-controls={`hud-group-${g.id}`} title={g.label}
            onClick={() => onOpen(open === g.id ? null : g.id)}>
            <span aria-hidden="true">{g.icon}</span><span className="sr-only">{g.label}</span>
            <Badge badge={g.badge} />{g.hotkeyBadge}
          </button>
        ))}
      </nav>
      {groups.map((g) => (
        <GroupPanel key={g.id} group={g} open={open === g.id} onOpen={() => onOpen(g.id)} onClose={() => onOpen(null)} />
      ))}
    </div>
  );
}

/** A row of labelled buttons inside a group: the icon buttons show their (screen-reader) label as text. */
export function HudGroupItems({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-1 text-lg leading-none sm:grid-cols-3 [&_.pch-btn]:relative [&_.pch-btn]:inline-flex [&_.pch-btn]:min-h-10 [&_.pch-btn]:w-full [&_.pch-btn]:items-center [&_.pch-btn]:justify-start [&_.pch-btn]:gap-1 [&_.pch-btn]:px-2 [&_.pch-btn]:py-1 [&_.pch-btn]:pointer-coarse:min-h-11 [&_.pch-btn]:max-w-none [&_.sr-only]:not-sr-only [&_.sr-only]:text-base [&_.sr-only]:whitespace-nowrap">
      {children}
    </div>
  );
}

export interface HudTab { id: string; label: string; reveal?: boolean; content: ReactNode }

/** Tabs inside a group (Cài đặt: Chung / Camera / Phím tắt); every tab stays in the DOM, the others hidden. */
export function HudTabs({ tabs, initial }: { tabs: readonly HudTab[]; initial?: string }) {
  const [tab, setTab] = useState(initial ?? tabs[0]?.id);
  return (
    <div className="flex flex-col gap-1.5">
      <div role="tablist" className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`hud-tab-${t.id}`}
            className={`pch-btn min-h-9 px-2 text-base pointer-coarse:min-h-11 ${tab === t.id ? "pch-btn-primary" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => <TabPanel key={t.id} tab={t} shown={tab === t.id} onReveal={() => setTab(t.id)} />)}
    </div>
  );
}

function TabPanel({ tab, shown, onReveal }: { tab: HudTab; shown: boolean; onReveal: () => void }) {
  const ref = useReveal(onReveal);
  return (
    <div ref={ref} role="tabpanel" aria-label={tab.label} hidden={!shown} data-hud-reveal={tab.reveal ? "" : undefined}
      data-testid={`hud-tabpanel-${tab.id}`}>
      {tab.content}
    </div>
  );
}
