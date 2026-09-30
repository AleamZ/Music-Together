"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminEconomy, compactXu, ECON_WINDOWS, GROUP_LABEL, groupFlows, inflationPerDay, reasonLabel,
  type EconDay, type EconomyReport, type EconWindow,
} from "@/lib/admin-economy";
import { formatXu } from "@/lib/game/fishing/catalog";

// /admin "Kinh tế" (0099_economy_watch.sql): how many xu exist, who holds them, and what created or destroyed them —
// the numbers to watch before and after any price change. Colors: xu in = blue, xu out = red (a diverging pair,
// validated on the cream surface); the money supply = burgundy (one series).

const IN = "#2a78d6", OUT = "#e34948", LINE = "#6e2233", GRID = "#e2d6bd", MUTED = "#7a6a55";
const xu = (n: number): string => n.toLocaleString("vi-VN");
const signed = (n: number): string => (n > 0 ? `+${xu(n)}` : n < 0 ? `−${xu(-n)}` : "0");
const dayText = (d: string): string => { const [, m, dd] = d.split("-"); return `${dd}/${m}`; };

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gold-200 bg-cream p-3">
      <div className="text-xs text-ink/70">{label}</div>
      <div className="font-playfair text-2xl text-burgundy">{value}</div>
      {sub && <div className="text-xs text-ink/60">{sub}</div>}
    </div>
  );
}

/** A rounded data-end, square at the baseline: a bar from y0 (baseline) to y1. */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y1 - y0), r = Math.min(4, h, w / 2), up = y1 < y0;
  if (h < 0.5) return "";
  return up
    ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
    : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

const W = 720, PAD_L = 64, PAD_R = 12, FS = 13;

/** Xu in (up) and out (down) per Vietnam day, one axis around zero; hover or focus a day for its numbers. */
function FlowChart({ days }: { days: EconDay[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const H = 218, mid = 100, plot = W - PAD_L - PAD_R, slot = plot / Math.max(1, days.length);
  const max = Math.max(1, ...days.map((d) => Math.max(d.in, -d.out)));
  const y = (v: number) => mid - (v / max) * (mid - 10);
  const bw = Math.min(14, slot * 0.6);
  const cur = hi !== null ? days[hi] : days[days.length - 1];
  return (
    <figure className="rounded-xl border border-gold-200 bg-cream p-3">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-burgundy">Xu vào / ra mỗi ngày (30 ngày)</span>
        <span className="flex gap-3 text-xs text-ink/70">
          <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" fill={IN} /></svg>Xu vào</span>
          <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" fill={OUT} /></svg>Xu ra</span>
        </span>
      </figcaption>
      <p className="mb-1 min-h-5 text-xs text-ink/80" aria-live="polite">
        {cur && <><strong className="text-ink">{dayText(cur.day)}</strong>: vào <strong>{signed(cur.in)}</strong> · ra <strong>{signed(cur.out)}</strong> · net <strong>{signed(cur.net)}</strong> · {cur.accounts} người chơi</>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Biểu đồ xu vào và ra mỗi ngày">
        <line x1={PAD_L} x2={W - PAD_R} y1={y(max)} y2={y(max)} stroke={GRID} strokeWidth={1} />
        <line x1={PAD_L} x2={W - PAD_R} y1={y(-max)} y2={y(-max)} stroke={GRID} strokeWidth={1} />
        <line x1={PAD_L} x2={W - PAD_R} y1={mid} y2={mid} stroke="#cdb98a" strokeWidth={1} />
        <text x={PAD_L - 6} y={y(max) + 4} textAnchor="end" fontSize={FS} fill={MUTED}>{compactXu(max)}</text>
        <text x={PAD_L - 6} y={mid + 4} textAnchor="end" fontSize={FS} fill={MUTED}>0</text>
        <text x={PAD_L - 6} y={y(-max) + 4} textAnchor="end" fontSize={FS} fill={MUTED}>{compactXu(-max)}</text>
        {days.map((d, i) => {
          const x = PAD_L + i * slot + (slot - bw) / 2;
          return (
            <g key={d.day} opacity={hi === null || hi === i ? 1 : 0.55}>
              <path d={barPath(x, bw, mid - 1, Math.min(mid - 1, y(d.in)))} fill={IN} />
              <path d={barPath(x, bw, mid + 1, Math.max(mid + 1, y(d.out)))} fill={OUT} />
              <rect x={PAD_L + i * slot} y={0} width={slot} height={H} fill="transparent" tabIndex={0}
                aria-label={`${dayText(d.day)}: vào ${xu(d.in)}, ra ${xu(-d.out)}, net ${signed(d.net)}`}
                onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)} />
            </g>
          );
        })}
        {days.length > 0 && <>
          <text x={PAD_L} y={H - 3} fontSize={FS} fill={MUTED}>{dayText(days[0].day)}</text>
          <text x={W - PAD_R} y={H - 3} textAnchor="end" fontSize={FS} fill={MUTED}>{dayText(days[days.length - 1].day)}</text>
        </>}
      </svg>
    </figure>
  );
}

/** The money supply at the end of each Vietnam day (today: now). */
function SupplyChart({ days }: { days: EconDay[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const H = 160, top = 14, bottom = H - 18, plot = W - PAD_L - PAD_R;
  const vals = days.map((d) => d.supply);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const x = (i: number) => PAD_L + (days.length <= 1 ? plot : (i / (days.length - 1)) * plot);
  const y = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const cur = hi !== null ? days[hi] : days[days.length - 1];
  const step = days.length > 1 ? plot / (days.length - 1) : plot;
  return (
    <figure className="rounded-xl border border-gold-200 bg-cream p-3">
      <figcaption className="mb-1 text-sm font-semibold text-burgundy">Tổng xu lưu hành cuối mỗi ngày</figcaption>
      <p className="mb-1 min-h-5 text-xs text-ink/80" aria-live="polite">
        {cur && <><strong className="text-ink">{dayText(cur.day)}</strong>: <strong>{xu(cur.supply)}</strong> xu ({signed(cur.net)} trong ngày)</>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Biểu đồ tổng xu lưu hành">
        <line x1={PAD_L} x2={W - PAD_R} y1={y(max)} y2={y(max)} stroke={GRID} strokeWidth={1} />
        <line x1={PAD_L} x2={W - PAD_R} y1={bottom} y2={bottom} stroke="#cdb98a" strokeWidth={1} />
        <text x={PAD_L - 6} y={y(max) + 4} textAnchor="end" fontSize={FS} fill={MUTED}>{compactXu(max)}</text>
        <text x={PAD_L - 6} y={bottom + 4} textAnchor="end" fontSize={FS} fill={MUTED}>{compactXu(min)}</text>
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={top} y2={bottom} stroke={GRID} strokeWidth={1} />}
        <polyline points={days.map((d, i) => `${x(i)},${y(d.supply)}`).join(" ")} fill="none" stroke={LINE} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {cur && <circle cx={x(hi ?? days.length - 1)} cy={y(cur.supply)} r={4} fill={LINE} stroke="#fff7e6" strokeWidth={2} />}
        {days.map((d, i) => (
          <rect key={d.day} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" tabIndex={0}
            aria-label={`${dayText(d.day)}: ${xu(d.supply)} xu`}
            onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)} />
        ))}
      </svg>
    </figure>
  );
}

export default function EconomyTab({ token }: { token: string }) {
  const [r, setR] = useState<EconomyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => adminEconomy(token).then((x) => { setR(x); setError(null); })
    .catch(() => setError("Chưa đọc được số liệu. Database cần chạy migration 0099_economy_watch.sql.")), [token]);
  useEffect(() => { void load(); }, [load]);
  const reload = () => { setBusy(true); void load().finally(() => setBusy(false)); };

  if (error && !r) return <p className="text-burgundy">{error}</p>;
  if (!r) return <p className="text-ink/60">Đang tải…</p>;
  return <EconomyView r={r} busy={busy} onReload={reload} />;
}

/** The report itself (no fetching): the window picker, the tiles, the two charts and the tables. */
export function EconomyView({ r, busy = false, onReload }: { r: EconomyReport; busy?: boolean; onReload?: () => void }) {
  const [win, setWin] = useState<EconWindow>("d7");

  const days = ECON_WINDOWS.find((w) => w.id === win)!.days;
  const g = groupFlows(r.flows[win]);
  const infl = inflationPerDay(g.net, r.supply.total + r.supply.frozen, days);
  const perActive = r.active[win] > 0 ? Math.round(g.in / r.active[win] / days) : 0;

  return (
    <div className={`flex flex-col gap-4 ${busy ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1 rounded-full border border-gold p-1">
          {ECON_WINDOWS.map((w) => (
            <button key={w.id} onClick={() => setWin(w.id)} aria-pressed={win === w.id}
              className={`rounded-full px-3 py-0.5 ${win === w.id ? "bg-burgundy text-cream" : "text-burgundy"}`}>{w.label}</button>
          ))}
        </div>
        {onReload && <button onClick={onReload} disabled={busy} className="rounded-full border border-gold-200 px-3 py-0.5 text-burgundy disabled:opacity-50">Làm mới</button>}
        <span className="text-xs text-ink/60">Cập nhật {r.serverNow ? new Date(r.serverNow).toLocaleString("vi-VN") : "—"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Tổng xu lưu hành" value={compactXu(r.supply.total)}
          sub={`${xu(r.supply.holders)} ví có xu${r.supply.frozen ? ` · ${compactXu(r.supply.frozen)} bị khoá` : ""}`} />
        <Tile label="Xu game trả ra" value={`+${compactXu(g.in)}`} sub={`≈ ${xu(perActive)} xu/người/ngày`} />
        <Tile label="Xu game thu về" value={compactXu(g.out)} sub={g.in > 0 ? `bằng ${Math.round((-g.out / g.in) * 100)}% xu trả ra` : undefined} />
        <Tile label="Cung tiền tăng/giảm" value={g.net >= 0 ? `+${compactXu(g.net)}` : compactXu(g.net)}
          sub={infl === null ? undefined : `${infl >= 0 ? "+" : ""}${infl.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%/ngày`} />
        <Tile label="Người chơi có giao dịch" value={xu(r.active[win])} sub={`24h ${r.active.d1} · 7 ngày ${r.active.d7} · 30 ngày ${r.active.d30}`} />
        <Tile label="Ví trung vị" value={compactXu(r.dist.p50)} sub={`${r.dist.n} người hoạt động 30 ngày`} />
        <Tile label="Ví top 10% / top 1%" value={compactXu(r.dist.p90)} sub={`top 1%: ${compactXu(r.dist.p99)}`} />
        <Tile label="10 ví giàu nhất nắm" value={`${r.dist.top10Share.toLocaleString("vi-VN")}%`} sub={`ví lớn nhất ${compactXu(r.dist.max)}`} />
      </div>

      <FlowChart days={r.daily} />
      <SupplyChart days={r.daily} />

      <section className="rounded-xl border border-gold-200 bg-cream p-3">
        <h3 className="mb-2 text-sm font-semibold text-burgundy">Dòng xu theo lý do ({ECON_WINDOWS.find((w) => w.id === win)!.label})</h3>
        {g.groups.length === 0 && <p className="text-sm text-ink/60">Chưa có giao dịch nào.</p>}
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-ink/60"><th className="py-1">Lý do</th><th className="text-right">Vào</th><th className="text-right">Ra</th><th className="text-right">Net</th><th className="text-right">Lượt</th></tr>
          </thead>
          {g.groups.map((grp) => (
            <tbody key={grp.group}>
              <tr className="border-t border-gold-200 font-semibold text-burgundy">
                <td className="py-1">{GROUP_LABEL[grp.group]}</td><td className="text-right">{xu(grp.in)}</td>
                <td className="text-right">{xu(Math.abs(grp.out))}</td><td className="text-right">{signed(grp.net)}</td><td />
              </tr>
              {grp.flows.map((f) => (
                <tr key={f.reason} className="text-ink/90">
                  <td className="py-0.5 pl-3" title={f.reason}>{reasonLabel(f.reason)}</td><td className="text-right">{f.in ? xu(f.in) : ""}</td>
                  <td className="text-right">{f.out ? xu(-f.out) : ""}</td><td className="text-right">{signed(f.in + f.out)}</td>
                  <td className="text-right text-ink/60">{xu(f.n)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-gold font-semibold"><td className="py-1">Tổng</td><td className="text-right">{xu(g.in)}</td>
              <td className="text-right">{xu(Math.abs(g.out))}</td><td className="text-right">{signed(g.net)}</td><td /></tr>
          </tfoot>
        </table>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-gold-200 bg-cream p-3">
          <h3 className="mb-2 text-sm font-semibold text-burgundy">10 ví lớn nhất</h3>
          <ol className="text-sm tabular-nums">
            {r.top.map((t, i) => (
              <li key={t.username + i} className="flex justify-between border-b border-gold-200/60 py-0.5">
                <span>{i + 1}. {t.username}{t.isRoot ? " (root)" : ""}</span><span>{formatXu(t.coins)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-gold-200 bg-cream p-3">
          <h3 className="mb-2 text-sm font-semibold text-burgundy">Hệ số giá cá cao nhất (theo phòng)</h3>
          {r.rooms.length === 0 && <p className="text-sm text-ink/60">Chưa có phòng nào tính hệ số.</p>}
          <ol className="text-sm tabular-nums">
            {r.rooms.map((m, i) => (
              <li key={m.name + i} className="flex justify-between border-b border-gold-200/60 py-0.5">
                <span className="truncate">{m.name}</span><span>×{m.mult.toLocaleString("vi-VN")} · TB {compactXu(m.wealth)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <details className="rounded-xl border border-gold-200 bg-cream p-3 text-sm">
        <summary className="cursor-pointer text-burgundy">Bảng số liệu theo ngày</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead><tr className="text-left text-xs text-ink/60"><th>Ngày</th><th className="text-right">Vào</th><th className="text-right">Ra</th><th className="text-right">Net</th><th className="text-right">Tổng xu</th><th className="text-right">Người chơi</th></tr></thead>
          <tbody>
            {[...r.daily].reverse().map((d) => (
              <tr key={d.day} className="border-t border-gold-200/60"><td>{dayText(d.day)}</td><td className="text-right">{xu(d.in)}</td>
                <td className="text-right">{xu(Math.abs(d.out))}</td><td className="text-right">{signed(d.net)}</td><td className="text-right">{xu(d.supply)}</td>
                <td className="text-right">{d.accounts}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
