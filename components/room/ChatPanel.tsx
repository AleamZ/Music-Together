"use client";
export default function ChatPanel() {
  return (
    <div className="mt-4">
      <h3 className="mb-2 flex items-center gap-2 font-cormorant text-lg text-burgundy">
        Trò chuyện <span className="rounded-full border border-gold-200 bg-cream px-2 text-[9px] uppercase text-[#8a6d2f]">Sắp ra mắt</span>
      </h3>
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-gold-200 text-center text-xs text-ink/50">
        Khu vực chat — giao diện đã sẵn, logic Phase 2
      </div>
      <div className="mt-2 flex gap-2">
        <input disabled placeholder="Nhắn gì đó… (chưa hoạt động)"
          className="flex-1 rounded-lg border border-gold-200 bg-cream/60 px-2 py-1.5 text-sm text-ink/50" />
        <button disabled className="rounded-lg border border-gold-200 bg-cream/60 px-3 text-burgundy/50">Gửi</button>
      </div>
    </div>
  );
}
