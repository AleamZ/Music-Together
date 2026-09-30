"use client";

// The loading bar while the 3D world is built (WorldView.build's steps: the land, each zone, the water, the forest…),
// over the game: switching from 2D to 3D, or entering the game in 3D.

export default function World3dLoading({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#1f3a4a]/95 p-4" role="status" aria-live="polite" data-testid="world3d-loading">
      <div className="pch flex w-full max-w-sm flex-col gap-3 p-4 font-vt">
        <p className="text-2xl leading-none text-burgundy">🌏 Đang dựng thế giới 3D…</p>
        <div className="h-4 w-full overflow-hidden rounded-sm border-2 border-burgundy bg-parchment-200"
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-burgundy transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
        <p className="flex justify-between text-lg leading-none opacity-80">
          <span>{label || "Chuẩn bị…"}</span>
          <span>{pct}%</span>
        </p>
      </div>
    </div>
  );
}
