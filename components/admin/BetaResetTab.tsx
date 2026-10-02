"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminBetaReset, adminBetaSnapshot, adminBetaStatus, betaErrText, type BetaStatus,
} from "@/lib/game/beta/rpc";

const CONFIRM = "RESET BETA";
const xu = (n: number | null | undefined): string => `${(n ?? 0).toLocaleString("vi-VN")} xu`;
const time = (x: string | null | undefined): string => (x ? new Date(x).toLocaleString("vi-VN") : "—");
const TIER_NAMES = ["< 10k", "≥ 10k", "≥ 50k", "≥ 100k", "≥ 200k", "≥ 500k"];
const ITEM_NAMES: Record<string, string> = {
  beta_dep: "Dép", beta_non: "Nón", beta_quan: "Quần", beta_ao: "Áo", beta_set: "Set đồ",
};
const PART_NAMES: Record<string, string> = {
  xu: "Ví", items: "Túi đồ", rods: "Cần + linh kiện", fish: "Cá", fashion: "Thời trang", furniture: "Nội thất",
  vehicles: "Xe", pets: "Thú cưng", land: "Ruộng", houses: "Nhà / căn hộ", produce: "Nông sản",
};

/** Reset Beta (0118): phase 1 snapshot (re-runnable), the preview, the confirm phrase, phase 2 reset, the status. */
export default function BetaResetTab({ token }: { token: string }) {
  const [st, setSt] = useState<BetaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => { adminBetaStatus(token).then(setSt, (e) => setError(betaErrText(e))); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(betaErrText(e)); } finally { setBusy(false); }
  };

  const players = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (st?.players ?? []).filter((p) => !q || p.username.toLowerCase().includes(q)).slice(0, 300);
  }, [st, filter]);

  const applied = !!st?.applied_at;
  const canReset = !!st?.snapshot_at && !applied && phrase === CONFIRM && (st?.unclassified.length ?? 0) === 0;

  return (
    <section className="flex flex-col gap-4 text-sm" data-testid="beta-reset-tab">
      <div className="rounded border-2 border-red-300 bg-red-50 p-3">
        <p className="font-bold text-red-800">Reset kết thúc Beta — KHÔNG THỂ HOÀN TÁC</p>
        <p>Giữ lại: tài khoản (tên, mật khẩu / liên kết email, root, trạng thái khoá), lịch sử chat, bằng chứng chống gian lận.
          Xoá sạch: xu, túi đồ, cần câu, cá, tủ lạnh, ruộng, nhà, nội thất, thời trang và ngoại hình, cấp độ, nghề, thành tựu,
          nhiệm vụ, thú cưng, xe, chợ, thư, thống kê. Người chơi cũ (trừ root và tài khoản bị khoá) nhận quà Kỷ niệm Beta theo
          bậc tài sản lúc chốt sổ.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span>Chốt sổ: <b>{time(st?.snapshot_at)}</b> (lần {st?.snapshot_runs ?? 0})</span>
        <span>· Reset: <b>{time(st?.applied_at)}</b></span>
        <button type="button" className="rounded border border-gold px-2 py-1" onClick={refresh} disabled={busy}>Làm mới</button>
      </div>

      {(st?.unclassified.length ?? 0) > 0 && (
        <p role="alert" className="text-red-700">Bảng chưa phân loại (reset bị chặn): {st?.unclassified.join(", ")}</p>
      )}

      <div className="flex flex-col gap-2 rounded border border-gold p-3">
        <p className="font-bold text-burgundy">Bước 1 — Chốt sổ (chỉ đọc, chạy lại được trước khi reset)</p>
        <button type="button" className="self-start rounded bg-burgundy px-3 py-1 text-cream disabled:opacity-50" disabled={busy || applied}
          onClick={() => void run(async () => { setSt(await adminBetaSnapshot(token)); setNotice("Đã chốt sổ."); })}>
          {st?.snapshot_at ? "Chốt sổ lại" : "Chốt sổ"}
        </button>
        {st && st.new_since_snapshot > 0 && st.snapshot_at && !applied && (
          <p className="text-amber-800">{st.new_since_snapshot} tài khoản tạo sau lần chốt sổ (sẽ bị reset nhưng không có quà) — nên chốt sổ lại ngay trước khi reset.</p>
        )}
      </div>

      {st?.snapshot_at && (
        <div className="flex flex-col gap-2">
          <p className="font-bold text-burgundy">Xem trước</p>
          <p>{st.totals.accounts} tài khoản · nhận quà {st.totals.eligible} · loại trừ {st.totals.excluded} (root / bị khoá / blacklist)
            · tổng tài sản {xu(st.totals.net_worth)} · tổng xu khởi nghiệp {xu(st.totals.starter_xu)}</p>
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b border-gold"><th>Bậc</th><th>Tài sản</th><th>Nhận quà</th><th>Loại trừ</th><th>Xu</th><th>Đồ Kỷ niệm Beta</th></tr></thead>
            <tbody>
              {st.tiers.map((t) => (
                <tr key={t.tier} className="border-b border-gold/30">
                  <td>{t.tier}</td><td>{TIER_NAMES[t.tier]}</td><td>{t.eligible}</td><td>{t.excluded}</td><td>{xu(t.xu)}</td>
                  <td>{t.items.map((i) => ITEM_NAMES[i] ?? i).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="opacity-80">Mọi người nhận quà còn có: cần tre lắp sẵn (lưỡi + dây), 20 mồi tép, 5 thính cám, linh vật Kỷ niệm Beta,
            danh hiệu “Người khai hoang Beta”, khung tên β, 7 ngày +50% KN và +25% hạn mức thương lái.</p>

          <p className="font-bold text-burgundy">Top tài sản</p>
          <ol className="list-decimal pl-6">
            {st.top.map((p) => (
              <li key={p.username}>{p.username} — {xu(p.net_worth)} (bậc {p.tier}){p.eligible ? "" : " · không nhận quà"}</li>
            ))}
          </ol>

          <p className="font-bold text-burgundy">Từng người chơi</p>
          <input className="rounded border border-gold px-2 py-1" placeholder="Lọc theo tên…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="flex max-h-96 flex-col gap-1 overflow-auto" data-testid="beta-players">
            {players.map((p) => (
              <li key={p.username} className="rounded border border-gold/40 px-2 py-1">
                <button type="button" className="w-full text-left" onClick={() => setOpen(open === p.username ? null : p.username)}>
                  <b>{p.username}</b> · {xu(p.net_worth)} · bậc {p.tier}
                  {p.eligible ? ` · quà ${xu(p.xu)}${p.items.length ? ` + ${p.items.map((i) => ITEM_NAMES[i] ?? i).join(", ")}` : ""}`
                    : ` · không nhận quà${p.is_root ? " (root)" : p.is_banned ? " (bị khoá)" : ""}`}
                  {p.granted ? " · ✓ đã phát" : ""}
                </button>
                {open === p.username && (
                  <ul className="mt-1 grid grid-cols-2 gap-x-4 opacity-80 sm:grid-cols-3">
                    {Object.entries(p.breakdown).filter(([k]) => k !== "total").map(([k, v]) => (
                      <li key={k}>{PART_NAMES[k] ?? k}: {xu(v)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded border-2 border-red-300 p-3">
        <p className="font-bold text-red-800">Bước 2 — Reset (một giao dịch duy nhất; gọi lại không có tác dụng)</p>
        <label className="flex flex-col gap-1">
          Gõ <code className="font-bold">{CONFIRM}</code> để xác nhận
          <input className="rounded border border-red-300 px-2 py-1" value={phrase} onChange={(e) => setPhrase(e.target.value)} disabled={applied}
            data-testid="beta-confirm" />
        </label>
        <button type="button" className="self-start rounded bg-red-700 px-3 py-1 text-white disabled:opacity-50" disabled={busy || !canReset}
          onClick={() => void run(async () => {
            const r = await adminBetaReset(token, phrase);
            setNotice(r.already ? "Đã reset từ trước — không có gì thay đổi." : "Reset xong. Quà đã vào hòm thư người chơi.");
            setPhrase("");
            refresh();
          })}>
          Reset Beta
        </button>
      </div>

      {applied && st?.summary && (
        <div className="flex flex-col gap-1">
          <p className="font-bold text-burgundy">Kết quả</p>
          <p>Đã phát quà: {String(st.summary.rewarded ?? 0)} · xu bị xoá: {xu(Number(st.summary.supply_burned ?? 0))}
            · tăng tốc đến {time(String(st.summary.boost_until ?? ""))}</p>
          <details>
            <summary>Số dòng đã xoá theo bảng</summary>
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(st.summary.wiped ?? {}, null, 1)}</pre>
          </details>
          <p className="opacity-80">Bài Bản tin: chạy <code>scripts/db/beta-reset-news.sql</code> sau khi reset.</p>
        </div>
      )}

      {notice && <p role="status" className="text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </section>
  );
}
