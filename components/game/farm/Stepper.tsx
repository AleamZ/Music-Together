"use client";

/** − n + and "Tối đa" for a quantity in [min, max]; − and + move it by `by` (v17: pellets go by 10). */
export default function Stepper({ value, min = 1, max, by = 1, label, unit = "", onChange }: {
  value: number;
  min?: number;
  max: number;
  by?: number;
  /** What is counted, for screen readers ("Số lượng Phân urê"). */
  label: string;
  unit?: string;
  onChange: (n: number) => void;
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="pch-btn px-2" onClick={() => step(-by)} disabled={value <= min} aria-label="Bớt">−</button>
      <span className="min-w-12 text-center" aria-live="polite">{value}{unit}</span>
      <button type="button" className="pch-btn px-2" onClick={() => step(by)} disabled={value >= max} aria-label="Thêm">+</button>
      <button type="button" className="pch-btn text-base" onClick={() => onChange(max)} disabled={value >= max}>Tối đa</button>
    </div>
  );
}
