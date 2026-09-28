"use client";

import { useEffect, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import ItemIcon from "@/components/game/ItemIcon";
import { formatWeight, formatXu, RARITY_COLOR, RARITY_NAME, type Rarity } from "@/lib/game/fishing/catalog";
import { CITY_PLACES } from "@/lib/game/maps/city";
import { MAP_IDS } from "@/lib/game/maps/types";
import { BOARDS, levelProgress, levelReward, MAX_LEVEL, XP_CAPS, type BoardId } from "@/lib/game/progression/model";
import { leaderboard, titleText, type BoardRow, type ProgressState } from "@/lib/game/progression/rpc";

export type ProfileTab = "level" | "achievements" | "titles" | "dex" | "boards";
const TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: "level", label: "⭐ Cấp độ" },
  { id: "achievements", label: "🏆 Thành tựu" },
  { id: "titles", label: "🎖️ Danh hiệu" },
  { id: "dex", label: "📖 Fishdex" },
  { id: "boards", label: "📊 Xếp hạng" },
];

const STAT_OF: Record<string, (s: ProgressState["stats"]) => number> = {
  fish_total: (s) => s.fishTotal, species: (s) => s.species, biggest_g: (s) => s.biggestG, earned_total: (s) => s.earnedTotal,
  farm_earned: (s) => s.farmEarned, fight_wins: (s) => s.fightWins, level: (s) => s.level,
};

function Bar({ frac, label }: { frac: number; label: string }) {
  return (
    <div className="relative h-4 w-full border-2 border-ink/60 bg-parchment" role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)} aria-label={label}>
      <div className="h-full bg-gold-400" style={{ width: `${Math.round(frac * 100)}%` }} />
      <span className="absolute inset-0 text-center text-xs leading-3 tabular-nums">{label}</span>
    </div>
  );
}

function LevelTab({ s, busy, onTravel }: { s: ProgressState; busy: boolean; onTravel: (id: string) => void }) {
  const p = levelProgress(s.xp);
  const at = s.waypoints.find((w) => w.id === s.atWaypoint) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <section className="flex items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center border-4 border-gold-400 bg-burgundy font-vt text-3xl text-parchment" aria-label={`Cấp ${s.level}`}>
          {s.level}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-bold">Cấp {s.level}{titleText(s) ? ` · «${titleText(s)}»` : ""}</p>
          <Bar frac={p.frac} label={s.level >= MAX_LEVEL ? "Tối đa" : `${p.into} / ${p.span} XP`} />
          {s.level < MAX_LEVEL && <p className="text-xs opacity-80">Lên cấp {s.level + 1}: thưởng {formatXu(levelReward(s.level + 1))}</p>}
        </div>
      </section>
      <section>
        <h3 className="font-bold">XP hôm nay</h3>
        <ul className="grid grid-cols-2 gap-x-3 text-sm tabular-nums">
          <li>🎣 Câu cá: {s.today.fish}/{XP_CAPS.fish}</li>
          <li>💼 Làm ăn: {s.today.earn}/{XP_CAPS.earn}</li>
          <li>🥊 Đấu võ: {s.today.fight}/{XP_CAPS.fight}</li>
          <li>✨ Nhiệm vụ & khác: {s.today.grant}/{XP_CAPS.grant}</li>
        </ul>
      </section>
      <section>
        <h3 className="font-bold">Thống kê</h3>
        <ul className="grid grid-cols-2 gap-x-3 text-sm tabular-nums">
          <li>Cá đã câu: {s.stats.fishTotal}</li>
          <li>Loài cá: {s.stats.species}</li>
          <li>Cá to nhất: {s.stats.biggestG > 0 ? formatWeight(s.stats.biggestG) : "—"}</li>
          <li>Thắng đấu: {s.stats.fightWins}</li>
          <li>Kiếm được: {formatXu(s.stats.earnedTotal)}</li>
          <li>Nông sản: {formatXu(s.stats.farmEarned)}</li>
        </ul>
      </section>
      <section>
        <h3 className="font-bold">🌀 Trạm dịch chuyển</h3>
        <p className="text-xs opacity-80">
          Tự đi tới một khu để khám phá trạm của nó. Đứng ở một trạm đã khám phá thì đi nhanh tới trạm khác ({formatXu(s.teleportFee)} / lần).
        </p>
        <p className="text-sm">{at ? `Bạn đang ở trạm: ${at.name}` : "Bạn không đứng ở trạm nào (trạm nằm ở lối vào mỗi khu)."}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {s.waypoints.map((w) => {
            const locked = s.level < w.minLevel;
            return (
              <li key={w.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{w.found ? "🌀" : "❔"} {w.found ? w.name : "Chưa khám phá"}{locked ? ` · cần cấp ${w.minLevel}` : ""}</span>
                <button type="button" className="pch-btn px-2 py-0.5 text-sm" disabled={busy || !at || !w.found || locked || w.id === at?.id}
                  onClick={() => onTravel(w.id)}>Đi</button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="font-bold">🗺️ Khu vực theo cấp</h3>
        <ul className="grid grid-cols-2 gap-x-3 text-sm">
          {MAP_IDS.filter((id) => !CITY_PLACES[id].hidden).map((id) => {
            const need = s.mapLevels[id] ?? 1;
            return <li key={id}>{s.level >= need ? "✅" : "🔒"} {CITY_PLACES[id].name}{need > 1 ? ` (cấp ${need})` : ""}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}

function AchievementsTab({ s }: { s: ProgressState }) {
  const done = s.achievements.filter((a) => a.at).length;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">Đã mở {done}/{s.achievements.length} thành tựu</p>
      <ul className="flex flex-col gap-1.5">
        {s.achievements.map((a) => {
          const v = Math.min(a.goal, STAT_OF[a.stat]?.(s.stats) ?? 0);
          return (
            <li key={a.id} className={`border-2 p-1.5 ${a.at ? "border-gold-400 bg-gold-100" : "border-ink/30 opacity-90"}`}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true">{a.at ? "🏆" : "🔒"}</span>
                <span className="flex-1 font-bold">{a.name}</span>
                <span className="text-xs tabular-nums">+{formatXu(a.reward)}</span>
              </div>
              <p className="text-xs">{a.descr}{a.title ? ` · mở danh hiệu «${a.title}»` : ""}</p>
              {!a.at && <Bar frac={a.goal > 0 ? v / a.goal : 0} label={`${v} / ${a.goal}`} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TitlesTab({ s, busy, onPick }: { s: ProgressState; busy: boolean; onPick: (id: string | null) => void }) {
  const titled = s.achievements.filter((a) => a.title);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">Danh hiệu hiện dưới tên của bạn trên bảng tên. Mở khoá bằng thành tựu.</p>
      <ul className="flex flex-col gap-1">
        <li>
          <button type="button" className="pch-btn w-full text-left" disabled={busy || s.title === null} aria-pressed={s.title === null}
            onClick={() => onPick(null)}>Không đeo danh hiệu</button>
        </li>
        {titled.map((a) => (
          <li key={a.id}>
            <button type="button" className="pch-btn flex w-full items-center gap-2 text-left" disabled={busy || !a.at || s.title === a.id}
              aria-pressed={s.title === a.id} onClick={() => onPick(a.id)}>
              <span aria-hidden="true">{s.title === a.id ? "🎖️" : a.at ? "▫️" : "🔒"}</span>
              <span className="flex-1">«{a.title}»</span>
              <span className="text-xs opacity-80">{a.at ? (s.title === a.id ? "Đang đeo" : "Đeo") : a.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DexTab({ s }: { s: ProgressState }) {
  const caught = s.fishdex.filter((f) => f.caught > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <section>
        <h3 className="font-bold">📖 Fishdex · {caught}/{s.fishdex.length} loài</h3>
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {s.fishdex.map((f) => {
            const r = (Math.min(5, Math.max(1, f.rarity)) as Rarity);
            return (
              <li key={f.species} className="flex items-center gap-1.5 border border-ink/30 p-1 text-sm">
                <span style={f.caught > 0 ? undefined : { filter: "brightness(0)", opacity: 0.35 }}><ItemIcon id={f.species} scale={2} /></span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate">{f.caught > 0 ? f.name : "???"}</span>
                  <span className="block text-xs" style={{ color: RARITY_COLOR[r] }}>{RARITY_NAME[r]}</span>
                  {f.caught > 0 && <span className="block text-xs tabular-nums opacity-80">×{f.caught} · {formatWeight(f.bestG)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="font-bold">🗂️ Bộ sưu tập</h3>
        <ul className="flex flex-col gap-1">
          {s.collections.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span aria-hidden="true">{c.at ? "✅" : "📦"}</span>
              <span className="w-40 shrink-0 truncate">{c.name}</span>
              <div className="flex-1"><Bar frac={c.total > 0 ? c.have / c.total : 0} label={`${c.have}/${c.total}`} /></div>
              <span className="text-xs tabular-nums">+{formatXu(c.reward)}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-sm"><span aria-hidden="true">🐾</span><span className="w-40 shrink-0">Thú cưng</span>
            <div className="flex-1"><Bar frac={s.other.pets.total ? s.other.pets.have / s.other.pets.total : 0} label={`${s.other.pets.have}/${s.other.pets.total}`} /></div></li>
          <li className="flex items-center gap-2 text-sm"><span aria-hidden="true">👗</span><span className="w-40 shrink-0">Thời trang</span>
            <div className="flex-1"><Bar frac={s.other.outfits.total ? s.other.outfits.have / s.other.outfits.total : 0} label={`${s.other.outfits.have}/${s.other.outfits.total}`} /></div></li>
          <li className="flex items-center gap-2 text-sm"><span aria-hidden="true">🌾</span><span className="w-40 shrink-0">Nông sản</span>
            <div className="flex-1"><Bar frac={s.other.crops.total ? s.other.crops.have / s.other.crops.total : 0} label={`${s.other.crops.have}/${s.other.crops.total}`} /></div></li>
        </ul>
      </section>
    </div>
  );
}

function BoardsTab({ token, fishName }: { token: string; fishName: (id: string) => string }) {
  const [board, setBoard] = useState<BoardId>("level");
  const [data, setData] = useState<{ board: BoardId; rows: BoardRow[]; me: string | null } | null>(null);
  const [failed, setFailed] = useState<BoardId | null>(null);
  useEffect(() => {
    let live = true;
    leaderboard(token, board)
      .then((r) => { if (live) setData({ board, ...r }); })
      .catch(() => { if (live) setFailed(board); });
    return () => { live = false; };
  }, [token, board]);
  const def = BOARDS.find((b) => b.id === board)!;
  const rows = data?.board === board ? data.rows : null;
  const fmt = (r: BoardRow) => board === "biggest" ? `${formatWeight(r.value)}${r.extra ? ` · ${fishName(r.extra)}` : ""}`
    : board === "rich" || board === "farmer" ? formatXu(r.value)
    : board === "level" ? `Cấp ${r.level} · ${r.value} XP` : `${r.value} ${def.unit}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Bảng xếp hạng">
        {BOARDS.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={board === b.id} className={`pch-btn px-1.5 py-0.5 text-sm ${board === b.id ? "bg-gold-200" : ""}`}
            onClick={() => { setBoard(b.id); setFailed(null); }}>{b.label}</button>
        ))}
      </div>
      {failed === board ? <p className="text-sm">Không tải được bảng — thử lại sau.</p>
        : rows === null ? <p className="text-sm opacity-80">Đang tải…</p>
        : rows.length === 0 ? <p className="text-sm">Chưa có ai trên bảng này.</p>
        : (
          <ol className="flex flex-col">
            {rows.map((r, i) => (
              <li key={r.id} className={`flex items-center gap-2 border-b border-dashed border-ink/30 py-0.5 text-sm ${r.id === data?.me ? "font-bold text-burgundy" : ""}`}>
                <span className="w-6 text-right tabular-nums">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
                <span className="min-w-0 flex-1 truncate">Lv{r.level} {r.name}</span>
                <span className="tabular-nums">{fmt(r)}</span>
              </li>
            ))}
          </ol>
        )}
      <p className="text-xs opacity-70">Cập nhật mỗi phút · top 20</p>
    </div>
  );
}

/** v21 "Hồ sơ": level & XP, achievements, titles, the Fishdex & collections, the leaderboards, and the waypoints. */
export default function ProfileModal({ token, state, busy, onSetTitle, onTravel, onClose, initialTab = "level" }: {
  token: string;
  state: ProgressState | null;
  busy: boolean;
  onSetTitle: (achievement: string | null) => void;
  onTravel: (waypoint: string) => void;
  onClose: () => void;
  initialTab?: ProfileTab;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const fishName = (id: string) => state?.fishdex.find((f) => f.species === id)?.name ?? id;
  return (
    <ParchmentModal title="Hồ sơ" onClose={onClose} className="sm:max-w-2xl">
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Hồ sơ">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pch-btn px-2 py-0.5 text-sm ${tab === t.id ? "bg-gold-200" : ""}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "boards" ? <BoardsTab token={token} fishName={fishName} />
        : state === null ? <p className="text-sm opacity-80">Đang tải hồ sơ…</p>
        : tab === "level" ? <LevelTab s={state} busy={busy} onTravel={onTravel} />
        : tab === "achievements" ? <AchievementsTab s={state} />
        : tab === "titles" ? <TitlesTab s={state} busy={busy} onPick={onSetTitle} />
        : <DexTab s={state} />}
    </ParchmentModal>
  );
}
