"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import type { FarmTask } from "@/lib/game/farm/actions";

/** The HUD button "🌾 Việc đồng áng"; a dot counts the urgent tasks (spec §13.1). */
export function FarmTasksButton({ urgent, onClick }: { urgent: number; onClick: () => void }) {
  return (
    <button type="button" className="pch-btn relative" onClick={onClick} aria-label={urgent > 0 ? `🌾 Việc đồng áng (${urgent} việc gấp)` : undefined}>
      🌾 Việc đồng áng
      {urgent > 0 && (
        <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-burgundy px-1 text-center text-sm leading-5 text-parchment">
          {urgent}
        </span>
      )}
    </button>
  );
}

/** What is due on the plots I farm, urgent first, and the way to the handbook. */
export default function FarmTasksPanel({ tasks, farming, onOpenHandbook, onClose }: {
  tasks: readonly FarmTask[];
  /** I farm at least one plot here. */
  farming: boolean;
  onOpenHandbook: () => void;
  onClose: () => void;
}) {
  return (
    <ParchmentModal title="🌾 Việc đồng áng" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {tasks.length === 0 ? (
          <p>{farming ? "Ruộng đang ổn, chưa cần làm gì." : "Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé."}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((t, i) => (
              // two lines may read the same: the list is rebuilt whole each time, so its order is the key
              <li key={i} className={t.urgent ? "text-burgundy" : ""}>{t.urgent ? "❗ " : "• "}{t.text}</li>
            ))}
          </ul>
        )}
        <button type="button" className="pch-btn self-start" onClick={onOpenHandbook}>📖 Sổ tay nhà nông</button>
      </div>
    </ParchmentModal>
  );
}
