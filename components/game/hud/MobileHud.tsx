"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useTouchDevice } from "./TouchHud";

// The compact HUD for phones held sideways (a touch screen, or any viewport ≤ 900×500): the play area stays clear.
// Out of the box only a ☰ button (with a micro vitals strip), the stick, the action buttons and a 💬 button show; every
// other HUD part lives in a sheet opened from the ☰ drawer. Sheets stay mounted (hidden) so `data-hotkey` elements in
// them still exist; one sheet at a time; tapping the backdrop or ✕ closes it.

const SMALL_QUERY = "(max-width: 900px) and (max-height: 500px)";
const smallSubscribe = (cb: () => void) => {
  try {
    const m = window.matchMedia(SMALL_QUERY);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => {};
  }
};
const smallGet = () => {
  try { return window.matchMedia(SMALL_QUERY).matches; } catch { return false; }
};

/** True when the compact (phone) HUD applies: a coarse pointer or a small landscape viewport. False on the server. */
export function useCompactHud(): boolean {
  const touch = useTouchDevice();
  const small = useSyncExternalStore(smallSubscribe, smallGet, () => false);
  return touch || small;
}

/** 99 800 000 → "99,8Tr"; 12 500 → "12,5N"; 1 200 000 000 → "1,2Tỷ". */
export function shortXu(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const fmt = (v: number, unit: string) => `${(Math.floor(v * 10) / 10).toString().replace(".", ",")}${unit}`;
  if (a >= 1e9) return fmt(n / 1e9, "Tỷ");
  if (a >= 1e6) return fmt(n / 1e6, "Tr");
  if (a >= 1e4) return fmt(n / 1e3, "N");
  return String(Math.floor(n));
}

function MicroBar({ value, color, label }: { value: number | null; color: string; label: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="block h-1.5 w-10 overflow-hidden rounded-full bg-black/40" role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(pct)}>
      <span className="block h-full" style={{ width: `${pct}%`, background: pct < 25 ? "#d23b3b" : color }} />
    </span>
  );
}

export interface MobileVitals { hunger: number | null; thirst: number | null; stamina: number | null; coins: number | null }

/** The ☰ button plus the always-visible micro strip (3 bars + coins). Top-left, inside the safe area. */
export function MobileMenuButton({ vitals, badge, open, onOpen }: { vitals: MobileVitals; badge?: boolean; open: boolean; onOpen: () => void }) {
  return (
    <div className="pointer-events-none fixed left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex items-center gap-1.5"
      data-testid="mobile-hud-top">
      <button type="button" data-testid="mobile-menu-button" aria-label="Mở menu" aria-expanded={open} aria-controls="mobile-drawer"
        className="pch-btn pointer-events-auto relative inline-flex h-11 w-11 items-center justify-center p-0 font-vt text-2xl leading-none"
        onClick={onOpen}>
        ☰
        {badge && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />}
      </button>
      <div className="flex flex-col gap-0.5 rounded-sm bg-black/35 px-1.5 py-1 font-vt text-sm leading-none text-cream" data-testid="mobile-vitals">
        <MicroBar value={vitals.hunger} color="#d9a441" label="Đói" />
        <MicroBar value={vitals.thirst} color="#3d8fd1" label="Khát" />
        <MicroBar value={vitals.stamina} color="#5bb04a" label="Thể lực" />
        <span className="tabular-nums" data-testid="mobile-coins">🪙{shortXu(vitals.coins)}</span>
      </div>
    </div>
  );
}

export interface DrawerItem { id: string; icon: string; label: string; badge?: boolean | number; onPick?: () => void }

/** The ☰ drawer: a full-height list sliding in from the left; tapping outside closes it. */
export function MobileDrawer({ open, items, onPick, onClose }: { open: boolean; items: readonly DrawerItem[]; onPick: (id: string) => void; onClose: () => void }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" data-testid="mobile-drawer-layer">
      <button type="button" aria-label="Đóng menu" className="absolute inset-0 h-full w-full cursor-default bg-black/40" data-testid="mobile-drawer-backdrop" onClick={onClose} />
      <nav id="mobile-drawer" aria-label="Menu" data-testid="mobile-drawer"
        className="pch absolute inset-y-0 left-0 flex w-[min(16rem,80vw)] flex-col gap-1 overflow-y-auto p-2 pl-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] font-vt">
        <div className="flex items-center justify-between">
          <h2 className="text-xl leading-none">☰ Menu</h2>
          <button type="button" className="pch-btn inline-flex h-11 w-11 items-center justify-center" aria-label="Đóng" onClick={onClose}>✕</button>
        </div>
        {items.map((it) => (
          <button key={it.id} type="button" data-testid={`mobile-item-${it.id}`}
            className="pch-btn relative flex min-h-11 w-full items-center gap-2 px-2 text-left text-lg leading-none"
            onClick={() => { if (it.onPick) { onClose(); it.onPick(); } else onPick(it.id); }}>
            <span aria-hidden="true">{it.icon}</span><span className="flex-1">{it.label}</span>
            {it.badge ? <span className="min-w-5 rounded-full bg-red-600 px-1 text-center font-sans text-xs leading-5 text-white">{typeof it.badge === "number" ? Math.min(99, it.badge) : "•"}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** One panel as a bottom sheet (near full height); always mounted, hidden while closed. */
export function MobileSheet({ id, title, open, onClose, children }: { id: string; title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEscape(open, onClose);
  return (
    <div className="fixed inset-0 z-[60]" hidden={!open} data-testid={`mobile-sheet-${id}`}>
      <button type="button" aria-label="Đóng" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/40" data-testid={`mobile-sheet-backdrop-${id}`} onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={title}
        className="pch absolute inset-x-[max(0.5rem,env(safe-area-inset-left))] bottom-0 top-[max(0.5rem,env(safe-area-inset-top))] mx-auto flex max-w-[40rem] flex-col gap-1.5 overflow-hidden p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] font-vt">
        <header className="flex shrink-0 items-center justify-between gap-2">
          <h2 className="truncate text-xl leading-none">{title}</h2>
          <button type="button" className="pch-btn inline-flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng" data-testid={`mobile-sheet-close-${id}`} onClick={onClose}>✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      </section>
    </div>
  );
}

/** The small 💬 button (bottom-center): opens the chat sheet. */
export function ChatFab({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" data-testid="mobile-chat-button" aria-label="Mở chat"
      className="pch-btn pointer-events-auto fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex h-11 w-11 -translate-x-1/2 items-center justify-center p-0 text-xl opacity-85"
      onClick={onOpen}>💬</button>
  );
}

/** The ride sheet when I own no vehicle: where to buy one. */
export function NoRide({ onMap }: { onMap: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 text-lg" data-testid="no-ride">
      <p>Bạn chưa có xe — mua ở tiệm xe (ông Tám, Chợ Lớn).</p>
      <button type="button" className="pch-btn min-h-11 px-3" onClick={onMap}>🗺️ Xem đường đến tiệm xe</button>
    </div>
  );
}

function useEscape(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [on, close]);
}
