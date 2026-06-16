"use client";
export default function Reactions() {
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      {["😍", "🔥", "👏", "🕺", "❤️"].map((e) => (
        <span key={e} className="cursor-default rounded-full border border-gold-200 bg-cream px-2 py-1 text-lg opacity-60">{e}</span>
      ))}
      <span className="rounded-full border border-gold-200 bg-cream px-2 text-[9px] uppercase text-[#8a6d2f]">Thả cảm xúc · Sắp ra mắt</span>
    </div>
  );
}
