"use client";

import type { HeatView } from "@/hooks/useHeat";

// v18.10: the heat's HUD chips (🥵 sốc nhiệt, 🏊 miễn nhiệt m:ss, 🧘 đã khởi động) and the pond-edge actions.

const TIPS: Record<"shock" | "immune" | "warm", string> = {
  shock: "Sốc nhiệt: ngoài nắng gắt quá 10 phút — khát nhanh gấp đôi. Vào bóng râm (quán, tiệm) hoặc nhảy xuống ao cho mát.",
  immune: "Vừa tắm ao xong: không bị sốc nhiệt trong thời gian này.",
  warm: "Đã khởi động: xuống nước ít bị chuột rút hơn hẳn (5 phút).",
};

export function HeatChips({ chips }: { chips: HeatView["chips"] }) {
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((c) => (
        <span
          key={c.key}
          data-testid={`heat-${c.key}`}
          title={TIPS[c.key]}
          className={`whitespace-nowrap tabular-nums ${c.key === "shock" ? "text-red-700 motion-safe:animate-pulse" : ""}`}
        >
          {c.text}
        </span>
      ))}
    </>
  );
}

/** The actions at the pond's edge ("Nhảy xuống ao", "Khởi động") and "Cứu" next to a cramping member. */
export function HeatActions({ heat, hidden, onNet = null }: {
  heat: HeatView;
  hidden: boolean;
  /** v18.2: "🕸️ Quăng lưới" from this edge cell (only while a net with throws is owned). */
  onNet?: ((cell: { col: number; row: number }) => void) | null;
}) {
  const p = heat.probe;
  if (hidden || !p) return null;
  if (p.rescue) {
    return (
      <button
        type="button"
        onClick={heat.rescue}
        className="pch-btn pch-btn-primary absolute bottom-36 left-1/2 z-10 -translate-x-1/2 text-xl motion-safe:animate-pulse"
      >
        <span className="pointer-coarse:hidden">E · </span>🛟 Cứu {p.rescue.name || "bạn ấy"}
      </button>
    );
  }
  if (!p.edge) return null;
  return (
    <div className="absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 gap-2">
      <button type="button" className="pch-btn text-base" data-hotkey="jump" title="Nhảy xuống ao (J)" disabled={heat.busy} onClick={heat.jump}>
        <span className="pointer-coarse:hidden">J · </span>🌊 Nhảy xuống ao
      </button>
      <button type="button" className="pch-btn text-base" data-hotkey="warmUp" title="Khởi động (K)" disabled={heat.busy} onClick={heat.warmUp}>
        <span className="pointer-coarse:hidden">K · </span>🧘 Khởi động
      </button>
      {onNet && (
        <button type="button" className="pch-btn text-base" data-hotkey="net" title="Quăng lưới (L)" onClick={() => p.edge && onNet({ col: p.edge.col, row: p.edge.row })}>
          <span className="pointer-coarse:hidden">L · </span>🕸️ Quăng lưới
        </button>
      )}
    </div>
  );
}
