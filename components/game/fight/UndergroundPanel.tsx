"use client";

import { useEffect } from "react";
import type { UndergroundHook } from "@/hooks/useUnderground";
import { myCup } from "@/hooks/useUnderground";
import { martialByKey } from "@/lib/game/fight/dojo";
import {
  CUP_TIERS, CUPS_DAY, LADDER_DAY, QUEUE_TIERS, RATED_DAY, UG_FEE_PCT, cupPayout, ladderPrize, ratedWin, tierOf, windowFor,
} from "@/lib/game/fight/underground";
import type { UgBoardRow, UgCup, UgSlot } from "@/lib/game/fight/ug-rpc";
import { formatXu } from "@/lib/game/fishing/catalog";
import { ParchmentModal } from "../Parchment";

export type UgTab = "queue" | "ladder" | "cup" | "board";
const TABS: ReadonlyArray<{ id: UgTab; label: string }> = [
  { id: "queue", label: "🎲 Kèo ngầm" }, { id: "ladder", label: "🚪 Tầng hầm" }, { id: "cup", label: "🌙 Giải đêm" }, { id: "board", label: "🏅 Bảng xếp hạng" },
];

const styleName = (key: string): string => martialByKey(key)?.name ?? key;
const clockText = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function TierBadge({ rating }: { rating: number }) {
  const t = tierOf(rating);
  return <span className="rounded-sm border border-ink/40 bg-ink/10 px-1" data-testid="ug-tier">{t.icon} {t.name} · {rating}</span>;
}

function Slot({ s, names, label }: { s: UgSlot; names: Map<string, string>; label: string }) {
  const n = (id: string | null) => (id ? names.get(id) ?? "?" : "…");
  const mark = (id: string | null) => (id && s.winner === id ? " ✅" : "");
  return (
    <div className="rounded border border-ink/30 p-1 text-base" data-testid="ug-slot">
      <p className="opacity-70">{label}{s.match && !s.winner ? " · đang đấu" : ""}</p>
      <p>{n(s.a)}{mark(s.a)} <span className="text-burgundy">vs</span> {n(s.b)}{mark(s.b)}</p>
    </div>
  );
}

function CupView({ cup, me }: { cup: UgCup; me: string }) {
  const names = new Map(cup.entries.map((e) => [e.id, e.name]));
  const pay = cupPayout(cup.tier);
  return (
    <div className="flex flex-col gap-1 rounded border border-ink/30 p-2" data-testid="ug-cup">
      <p>
        <b>Giải {formatXu(cup.tier)}</b> · {cup.status === "open" ? `đang gom người (${cup.entries.length}/4)` : cup.status === "running" ? "đang đấu" : cup.status === "done" ? "đã xong" : "đã hủy · hoàn phí"}
      </p>
      <p className="text-base opacity-80">Quỹ {formatXu(pay.pool)} (4 × phí − {UG_FEE_PCT}%): vô địch {formatXu(pay.champion)}, á quân {formatXu(pay.runnerUp)}</p>
      {cup.bracket ? (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          <Slot s={cup.bracket.semis[0]} names={names} label="Bán kết 1 (hạt 1 v 4)" />
          <Slot s={cup.bracket.semis[1]} names={names} label="Bán kết 2 (hạt 2 v 3)" />
          <Slot s={cup.bracket.final} names={names} label="Chung kết" />
        </div>
      ) : (
        <ul className="text-base">
          {cup.entries.map((e) => <li key={e.id}>{e.id === me ? "⭐ " : ""}{e.name} · {e.rating}</li>)}
        </ul>
      )}
    </div>
  );
}

function BoardList({ title, rows }: { title: string; rows: UgBoardRow[] }) {
  return (
    <div className="flex-1">
      <p className="text-xl">{title}</p>
      {rows.length === 0 ? <p className="opacity-70">Chưa ai đấu mùa này.</p> : (
        <ol className="text-base">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={r.me ? "text-burgundy" : ""}>
              {i + 1}. {r.name} · {tierOf(r.rating).icon} {r.rating}{i === 0 && title.includes("hầm này") ? " · 👑 Trùm hầm" : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** v20.4 anh Tư Sẹo's panel (spec §v20.4 "Client modules and UI"): Kèo ngầm (the queue, the entry tiers, the window,
 *  my rating and tier), Tầng hầm (the 10 bosses, cleared marks, prizes), Giải đêm (sign-up, the bracket, the called
 *  match) and Bảng xếp hạng (the season's top 10, room and town). Presentational over the hook's state. */
export default function UndergroundPanel({ ug, accountId, tab, onTab, nowMs, onClose }: {
  ug: UndergroundHook;
  accountId: string;
  tab: UgTab;
  onTab: (t: UgTab) => void;
  nowMs: number;
  onClose: () => void;
}) {
  const s = ug.state;
  const { loadBoard } = ug;
  useEffect(() => {
    if (tab === "board") void loadBoard();
  }, [tab, loadBoard]);
  const me = s?.me ?? null;
  const cup = myCup(s, accountId);
  const cleared = new Set((s?.bosses ?? []).filter((b) => b.cleared).map((b) => b.floor));
  return (
    <ParchmentModal title="🕳️ Hầm đấu ngầm · anh Tư Sẹo" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight" data-testid="ug-panel">
        {me && (
          <p className="flex flex-wrap items-center gap-2">
            <TierBadge rating={me.rating} />
            <span className="text-base opacity-80">Mùa {(s?.season ?? 0) + 1}{me.titles.length > 0 ? ` · ${me.titles[me.titles.length - 1]}` : ""}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pch-btn px-2 py-0.5 text-base ${tab === t.id ? "pch-btn-primary" : ""}`} onClick={() => onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "queue" && (
          <div className="flex flex-col gap-2" role="tabpanel" data-testid="ug-queue">
            <p className="text-base opacity-80">Kèo xếp theo hạng, cùng phòng, cùng mức phí. Thắng nhận 2 × phí − {UG_FEE_PCT}%, hòa hoàn phí. Hôm nay: {me?.ratedToday ?? 0}/{RATED_DAY} trận.</p>
            {s?.queue ? (
              <>
                <p>⏳ Đang chờ kèo <b>{formatXu(s.queue.tier)}</b> · đã chờ {clockText(nowMs - s.queue.joinedAtMs)} · hạng ±{windowFor(nowMs - s.queue.joinedAtMs)}</p>
                <div className="flex justify-end"><button type="button" className="pch-btn" disabled={ug.busy} onClick={() => void ug.queueLeave()}>Rời hàng · hoàn phí</button></div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {QUEUE_TIERS.map((t) => (
                  <button key={t} type="button" className="pch-btn" disabled={ug.busy || !!s?.mine || !!cup} onClick={() => void ug.queueJoin(t)}>
                    Vào kèo · {formatXu(t)} <span className="text-base opacity-70">(thắng +{formatXu(ratedWin(t).won - t)} · chờ {s?.queued[String(t)] ?? 0})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "ladder" && (
          <div className="flex flex-col gap-1" role="tabpanel" data-testid="ug-ladder">
            <p className="text-base opacity-80">Mỗi mùa hạ từng tầng một. Lần đầu hạ trùm trả đủ thưởng, lần sau 10%. Hôm nay: {me?.ladderToday ?? 0}/{LADDER_DAY} lượt.</p>
            <ol className="flex flex-col gap-1">
              {(s?.bosses ?? []).map((b) => {
                const open = b.floor === 1 || cleared.has(b.floor - 1);
                return (
                  <li key={b.floor} className={`flex flex-wrap items-center justify-between gap-1 rounded border border-ink/30 px-2 py-1 ${open ? "" : "opacity-50"}`} data-testid={`ug-floor-${b.floor}`}>
                    <span>
                      <b>Tầng {b.floor}</b> · {b.name} · {b.styleByRound ? b.styleByRound.slice(0, 3).map(styleName).join(" → ") : styleName(b.style)} · máy {b.level} · {b.hpPct}% máu
                      {b.cleared && " · ✅"}
                    </span>
                    <span className="flex items-center gap-2 text-base">
                      <span>{b.cleared ? `lần sau +${formatXu(ladderPrize(b.floor, false))}` : `lần đầu +${formatXu(b.prize)}`}</span>
                      <button type="button" className="pch-btn px-2 py-0.5" disabled={!open || ug.busy || !!s?.mine} onClick={() => void ug.ladderStart(b.floor)}>
                        {open ? `Thách đấu · ${formatXu(b.entry)}` : "🔒 Hạ tầng dưới trước"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {tab === "cup" && (
          <div className="flex flex-col gap-2" role="tabpanel" data-testid="ug-cup-tab">
            <p className="text-base opacity-80">Đủ 4 người cùng mức phí là bốc thăm theo hạng; đấu lần lượt trong lồng, tới lượt thì có 60 giây để bấm Sẵn sàng. Hôm nay: {me?.cupsToday ?? 0}/{CUPS_DAY} giải.</p>
            {cup ? (
              <div className="flex justify-end">
                {cup.status === "open" && <button type="button" className="pch-btn" disabled={ug.busy} onClick={() => void ug.cupLeave()}>Rút tên · hoàn phí</button>}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {CUP_TIERS.map((t) => (
                  <button key={t} type="button" className="pch-btn" disabled={ug.busy || !!s?.queue || !!s?.mine} onClick={() => void ug.cupJoin(t)}>
                    Đăng ký · {formatXu(t)}
                  </button>
                ))}
              </div>
            )}
            {(s?.cups ?? []).length === 0 ? <p className="opacity-70">Chưa có giải nào tối nay.</p> : (s?.cups ?? []).map((c) => <CupView key={c.id} cup={c} me={accountId} />)}
          </div>
        )}

        {tab === "board" && (
          <div className="flex flex-col gap-2 sm:flex-row" role="tabpanel" data-testid="ug-board">
            <BoardList title="Hầm này" rows={ug.board?.room ?? []} />
            <BoardList title="Cả thành phố" rows={ug.board?.global ?? []} />
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
