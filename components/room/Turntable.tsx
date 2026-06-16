"use client";

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-56 w-56">
      <div
        className={`h-56 w-56 rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[33%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {thumbnail
            ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" />
            : <span className="text-2xl">🎼</span>}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      {/* tonearm */}
      <div className="absolute -right-1 -top-1 h-3 w-28 origin-right rotate-28">
        <div className="mt-1 h-1.5 rounded bg-linear-to-r from-gold to-[#8a6d2f] shadow" />
        <div className="absolute -right-1.5 -top-0.5 h-4 w-4 rounded-full bg-[#8a6d2f] shadow" />
      </div>
    </div>
  );
}
