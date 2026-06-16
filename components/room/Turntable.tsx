"use client";

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80">
      {/* disc */}
      <div
        className={`absolute left-3 top-3.5 h-[230px] w-[230px] rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[34%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" /> : <span className="text-2xl">🎼</span>}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      {/* parked rest puck */}
      <div className="absolute bottom-[92px] right-[22px] h-3 w-6 rounded-full bg-[#8a6d2f] opacity-40" />
      {/* tonearm: pivot top-right; 0deg = vertical/parked, 36deg = needle on mid-groove */}
      <div
        className="absolute right-[26px] top-2 h-[150px] w-[18px] origin-[9px_9px] transition-transform duration-[900ms] ease-in-out"
        style={{ transform: spinning ? "rotate(36deg)" : "rotate(0deg)" }}
      >
        <div className="absolute left-0 top-0 h-5 w-5 rounded-full bg-[#8a6d2f] shadow" />
        <div className="absolute left-2 top-[9px] h-[130px] w-1 rounded bg-linear-to-b from-[#c8a86a] to-[#8a6d2f]" />
        <div className="absolute bottom-0 left-px h-4 w-[18px] rounded bg-burgundy" />
      </div>
    </div>
  );
}
