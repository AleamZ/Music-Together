"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminAnticheatConfig, adminAnticheatStats, adminAnticheatStatsRun, adminBlacklistSet, adminStatReview,
  type AnticheatStats, type StatAccount, type StatFlag,
} from "@/lib/admin";
import { buildNumber, CLIENT_BUILD } from "@/lib/client-build";

// /admin "Chống gian lận" → "Thống kê & danh sách đen" (anti-cheat v2 part 3): the minimum client build, the
// auto-blacklist, the statistics job's outliers, and the blacklist by hand.

export const KIND_LABEL: Record<string, string> = {
  stat_win_rate: "Tỉ lệ thắng cao bất thường",
  stat_exact_rate: "Thao tác hoàn hảo bất thường",
  stat_earnings: "Thu nhập 24 giờ bất thường",
  stat_marathon: "Kiếm xu liên tục nhiều giờ",
};
export const GAME_LABEL: Record<string, string> = {
  reel: "câu cá", net: "quăng lưới", harvest: "gặt lúa", crab: "bắt cua", sling: "ná chuột", kata: "bài quyền",
  fight_pvp: "đấu võ đài", fight_exam: "thi đai", fight_ug_ladder: "hầm leo tầng", fight_ug_rated: "hầm xếp hạng",
  fight_ug_cup: "hầm cúp",
  sell: "bán cá", rice_sell: "bán lúa", produce_sell: "bán hoa màu", critter_sell: "bán cua ốc", rat_sell: "bán chuột",
  pet_find: "sóc nhặt xu", song: "thưởng bài hát", fight_win: "thắng cược võ", ug_prize: "thưởng hầm",
};

const time = (x: string | null): string => (x ? new Date(x).toLocaleString("vi-VN") : "—");
const pct = (x: number | null): string => (x === null ? "—" : `${Math.round(x * 1000) / 10}%`);
const BUTTON = "rounded border border-gold-200 px-2 py-0.5 text-burgundy disabled:opacity-50";

/** One flag in words. */
export function flagText(f: StatFlag): string {
  const what = KIND_LABEL[f.kind] ?? f.kind;
  const key = f.key ? ` (${GAME_LABEL[f.key] ?? f.key})` : "";
  if (f.kind === "stat_earnings") return `${what}${key}: ${f.value.toLocaleString("vi-VN")} xu — người khác p95 ${(f.baseline ?? 0).toLocaleString("vi-VN")} xu`;
  if (f.kind === "stat_marathon") return `${what}: ${f.value} giờ trong 24 giờ`;
  return `${what}${key}: ${pct(f.value)} trên ${f.n} lượt — người khác ${pct(f.baseline)}`;
}

function errorText(err: unknown): string {
  const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
  if (msg === "invalid config") return "Giá trị không hợp lệ.";
  return "Có lỗi, thử lại nhé.";
}

export default function StatsPanel({ token }: { token: string }) {
  const [stats, setStats] = useState<AnticheatStats | null>(null);
  const [minBuild, setMinBuild] = useState("");
  const [hard, setHard] = useState("");
  const [rateSoft, setRateSoft] = useState("");
  const [rateBlock, setRateBlock] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((s: AnticheatStats) => {
    setStats(s);
    setMinBuild(String(s.config.min_client_build));
    setHard(String(s.config.auto_blacklist_hard));
    setRateSoft(String(s.config.rate_soft_per_min ?? ""));
    setRateBlock(String(s.config.rate_block_per_min ?? ""));
  }, []);
  const load = useCallback(() => adminAnticheatStats(token).then(show), [token, show]);
  useEffect(() => {
    void load().catch((e: unknown) => setError(errorText(e)));
  }, [load]);

  const act = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = (patch: Parameters<typeof adminAnticheatConfig>[1]) => void act(() => adminAnticheatConfig(token, patch));
  const mine = buildNumber(CLIENT_BUILD);
  const blacklist = (a: StatAccount) => {
    const on = !a.blacklisted;
    const text = on
      ? `Đưa ${a.username} vào danh sách đen? Mọi lần được cộng xu của tài khoản này chỉ còn +1 xu.`
      : `Bỏ ${a.username} khỏi danh sách đen? Tự động đưa lại chỉ tính các vi phạm cứng từ giờ.`;
    if (window.confirm(text)) void act(() => adminBlacklistSet(token, a.account_id, on, on ? "admin: thống kê" : undefined));
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream p-3">
      <h3 className="font-bold text-burgundy">📊 Thống kê & danh sách đen</h3>
      {error && <p role="status" className="text-burgundy-accent">{error}</p>}
      {!stats ? <p>Đang tải thống kê…</p> : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <label htmlFor="ac-min-build">Bản tối thiểu (0 = tắt):</label>
            <input id="ac-min-build" inputMode="numeric" value={minBuild} onChange={(e) => setMinBuild(e.target.value.replace(/\D/g, "").slice(0, 12))}
              className="w-36 rounded border border-gold-200 px-1" />
            <button type="button" className={BUTTON} disabled={busy || mine === 0} onClick={() => setMinBuild(String(mine))}>
              {`Bằng bản của trang này (${mine || "dev"})`}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => saveConfig({ min_client_build: Number(minBuild || "0") })}>Lưu</button>
          </div>
          <p className="text-xs opacity-80">Trang cũ hơn bản tối thiểu không nhận thưởng nữa và được nhắc “Cập nhật trang”.</p>
          <div className="flex flex-wrap items-center gap-1">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={stats.config.auto_blacklist} disabled={busy}
                onChange={(e) => saveConfig({ auto_blacklist: e.target.checked })} />
              Tự động đưa vào danh sách đen khi có
            </label>
            <input aria-label="Số vi phạm cứng" inputMode="numeric" value={hard} onChange={(e) => setHard(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-14 rounded border border-gold-200 px-1" />
            <span>vi phạm cứng trong 30 ngày (≥ 2 ngày khác nhau)</span>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => saveConfig({ auto_blacklist_hard: Number(hard || "0") })}>Lưu</button>
          </div>
          {stats.config.rate_soft_per_min != null && (
            <div className="flex flex-wrap items-center gap-1">
              <span>Mỗi tài khoản gọi máy chủ quá</span>
              <input aria-label="Ngưỡng cảnh báo mỗi phút" inputMode="numeric" value={rateSoft}
                onChange={(e) => setRateSoft(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-16 rounded border border-gold-200 px-1" />
              <span>lần/phút thì ghi nhận, tới</span>
              <input aria-label="Ngưỡng chặn mỗi phút" inputMode="numeric" value={rateBlock}
                onChange={(e) => setRateBlock(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-16 rounded border border-gold-200 px-1" />
              <span>lần/phút thì chặn tới hết phút</span>
              <button type="button" className={BUTTON} disabled={busy}
                onClick={() => saveConfig({ rate_soft_per_min: Number(rateSoft || "0"), rate_block_per_min: Number(rateBlock || "0") })}>Lưu</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={stats.config.stats_enabled} disabled={busy}
                onChange={(e) => saveConfig({ stats_enabled: e.target.checked })} />
              {`Thống kê tự chạy mỗi ${stats.config.stats_every_min} phút`}
            </label>
            <span>{`· lần cuối ${time(stats.run_at)}`}</span>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void act(() => adminAnticheatStatsRun(token))}>Chạy ngay</button>
          </div>
          {stats.accounts.length === 0 ? <p>Không có tài khoản nào bất thường hay trong danh sách đen.</p> : (
            <ul className="flex flex-col gap-2">
              {stats.accounts.map((a) => (
                <li key={a.account_id} className="rounded border border-gold-200 p-2">
                  <p>
                    <b className="text-burgundy">{`${a.username}${a.is_root ? " 👑" : ""}`}</b>
                    {a.blacklisted && <span>{` · ⛔ Danh sách đen${a.blacklist_note ? ` (${a.blacklist_note})` : ""}`}</span>}
                    <span>{` · ${a.hard_30d} vi phạm cứng/30 ngày`}</span>
                  </p>
                  {a.flags.map((f) => <p key={`${f.kind}:${f.key}`}>{`• ${flagText(f)}`}</p>)}
                  {a.games.length > 0 && (
                    <p className="text-xs opacity-80">{a.games.map((g) => `${GAME_LABEL[g.game] ?? g.game}: ${g.wins}/${g.plays} thắng, ${g.exact} hoàn hảo`).join(" · ")}</p>
                  )}
                  {Object.keys(a.income).length > 0 && (
                    <p className="text-xs opacity-80">{`Thu 24 giờ: ${Object.entries(a.income).map(([k, v]) => `${GAME_LABEL[k] ?? k} ${v.toLocaleString("vi-VN")}`).join(" · ")}`}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button type="button" className={BUTTON} disabled={busy} onClick={() => blacklist(a)}>
                      {a.blacklisted ? "Bỏ khỏi danh sách đen" : "Đưa vào danh sách đen"}
                    </button>
                    {a.flags.length > 0 && (
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => void act(() => adminStatReview(token, a.account_id))}>Đã xem</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
