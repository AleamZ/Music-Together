"use client";

import { HOTKEY_GROUPS, HOTKEYS } from "@/lib/game/hotkeys";
import { ParchmentModal } from "./Parchment";

/** "⌨️ Phím tắt": every key, grouped (H or ? opens and closes it). */
export default function HotkeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <ParchmentModal title="⌨️ Phím tắt" onClose={onClose}>
      <HotkeysList testId="hotkeys-help" />
      <p className="mt-2 font-vt text-base opacity-80">Phím tắt tạm nghỉ khi đang gõ chữ, khi có bảng hay minigame đang mở.</p>
    </ParchmentModal>
  );
}

/** Every key, grouped: the modal above and the HUD's ⚙️ Cài đặt → Phím tắt tab. */
export function HotkeysList({ testId = "hotkeys-list" }: { testId?: string }) {
  return (
      <div className="grid gap-3 font-vt text-lg leading-tight sm:grid-cols-2" data-testid={testId}>
        {HOTKEY_GROUPS.map(({ group, title }) => (
          <section key={group}>
            <h3 className="mb-1 text-xl">{title}</h3>
            <ul className="flex flex-col gap-0.5">
              {HOTKEYS.filter((h) => h.group === group).map((h) => (
                <li key={`${h.label}-${h.desc}`} className="flex gap-2">
                  <kbd className="min-w-10 shrink-0 rounded-sm border border-gold-200 bg-parchment px-1 text-center">{h.label}</kbd>
                  <span>{h.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
  );
}
