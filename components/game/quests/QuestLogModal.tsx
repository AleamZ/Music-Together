"use client";

import { useCallback, useEffect, useState } from "react";
import { questErrorMessage, type QuestCat } from "@/lib/game/quests/model";
import { questAccept, questClaim, questCompanyClaim, questState, type Quest, type QuestState } from "@/lib/game/quests/rpc";
import { ParchmentModal } from "../Parchment";
import { FillBar, RewardPop } from "../celebrate/Fx";

type Tab = QuestCat | "company";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["daily", "📅 Ngày"], ["weekly", "🗓️ Tuần"], ["company", "🤝 Cả làng"], ["npc", "👴 Bác Ba"], ["explore", "🧭 Khám phá"],
];
const AREA_NAME: Record<string, string> = {
  hall: "Sảnh", pond: "Ao câu", field: "Đồng ruộng", market: "Chợ Lớn", khu_nha: "Khu nhà", bai_dat: "Bãi đất trống", ham_ngam: "Hầm ngầm",
};

function errText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return questErrorMessage(msg);
}

function Bar({ v, goal }: { v: number; goal: number }) {
  const pct = Math.max(0, Math.min(100, (v / Math.max(1, goal)) * 100));
  return (
    <span className="flex items-center gap-2">
      <FillBar pct={pct} />
      <span className="tabular-nums text-base">{v.toLocaleString("vi-VN")}/{goal.toLocaleString("vi-VN")}</span>
    </span>
  );
}

interface Props {
  token: string;
  /** Where I stand when the panel was opened at bác Ba Làng (the use point), else null. */
  at: { x: number; y: number } | null;
  initialTab?: Tab;
  onCoins: () => void;
  onOpenLogin: () => void;
  onOpenAlbum: () => void;
  onOpenArena: () => void;
  onClose: () => void;
}

/** 📜 Nhiệm vụ (v21 #50–#53, #91): the log. Progress is counted by the server from what really happened. */
export default function QuestLogModal({ token, at, initialTab, onCoins, onOpenLogin, onOpenAlbum, onOpenArena, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (at ? "npc" : "daily"));
  const [state, setState] = useState<QuestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reward, setReward] = useState<{ coins: number; xp: number; k: number } | null>(null);   // v22: the chest pop

  useEffect(() => {
    let live = true;
    questState(token).then((s) => { if (live) setState(s); }, (e) => { if (live) setMsg(errText(e)); });
    return () => { live = false; };
  }, [token]);

  const run = useCallback(async (f: () => Promise<QuestState>) => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await f();
      setState(s);
      if (s.paid !== undefined) {
        setMsg(`Nhận ${s.paid.toLocaleString("vi-VN")} xu${s.xp ? ` và ${s.xp} XP` : ""}!`);
        setReward({ coins: s.paid, xp: s.xp ?? 0, k: Date.now() });
        onCoins();
      }
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [onCoins]);

  const list = (state?.quests ?? []).filter((q) => q.cat === tab);

  const row = (q: Quest) => (
    <li key={q.id} className={`rounded border border-gold-300 p-2 ${q.status === "claimed" || q.status === "locked" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xl text-burgundy">{q.status === "claimed" ? "✅ " : q.status === "locked" ? "🔒 " : ""}{q.title}</span>
        <span className="text-base">🪙 {q.coins} · ✨ {q.xp} XP</span>
      </div>
      <p className="text-base">{q.descr}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        {q.status === "available" || q.status === "locked" ? <span /> : <Bar v={q.progress} goal={q.goal} />}
        {q.status === "available" && (
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || !at}
            title={at ? undefined : "Đến gặp bác Ba Làng ở Sảnh để nhận"} onClick={() => at && void run(() => questAccept(token, q.id, at))}>
            Nhận nhiệm vụ
          </button>
        )}
        {q.status === "done" && (
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || (q.cat === "npc" && !at)}
            title={q.cat === "npc" && !at ? "Về gặp bác Ba Làng ở Sảnh để trả" : undefined}
            onClick={() => void run(() => questClaim(token, q.id, q.cat === "npc" ? at : null))}>
            🎁 Nhận thưởng
          </button>
        )}
      </div>
    </li>
  );

  const company = state?.company ?? null;
  return (
    <ParchmentModal title="📜 Nhiệm vụ" onClose={onClose} className="sm:max-w-[720px]">
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 font-vt text-lg" data-testid="quest-log">
        {reward && <RewardPop key={reward.k} coins={reward.coins} xp={reward.xp} title="Hoàn thành nhiệm vụ!" onDone={() => setReward(null)} />}
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => { setTab(id); setMsg(null); }}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 text-base">
          <button type="button" className="pch-btn" onClick={onOpenLogin}>🎁 Quà đăng nhập</button>
          <button type="button" className="pch-btn" onClick={onOpenAlbum}>🖼️ Album ảnh</button>
          <button type="button" className="pch-btn" onClick={onOpenArena}>⚔️ Đấu đội 2v2</button>
        </div>
        {msg && <p role="status" className="rounded bg-gold-100 px-2 text-burgundy">{msg}</p>}
        {!state && !msg && <p>Đang tải…</p>}
        {state && tab === "daily" && <p className="text-base opacity-80">Làm mới lúc 0 giờ (giờ Việt Nam).</p>}
        {state && tab === "weekly" && <p className="text-base opacity-80">Làm mới mỗi thứ Hai.</p>}
        {state && tab === "npc" && (
          <p className="text-base opacity-80">
            {at ? "Bác Ba Làng: “Giúp bác mấy việc nhé, cháu!”" : "Nhận và trả nhiệm vụ khi đứng cạnh bác Ba Làng ở Sảnh."}
          </p>
        )}
        {state && tab === "explore" && (
          <p className="text-base opacity-80">
            Đã đến: {state.visited.map((a) => AREA_NAME[a] ?? a).join(", ") || "—"}
          </p>
        )}
        {state && tab === "company" && (
          <div className="flex flex-col gap-2">
            {company ? (
              <div className="rounded border border-gold-300 p-2">
                <div className="text-xl text-burgundy">{company.title}</div>
                <p className="text-base">{company.descr} Ai góp sức đều nhận 🪙 {company.coins} · ✨ {company.xp} XP khi xong.</p>
                <FillBar pct={Math.min(100, (company.progress / Math.max(1, company.goal)) * 100)} className="block h-4 w-full" color="bg-amber-500" />
                <p className="text-base tabular-nums">
                  {company.progress.toLocaleString("vi-VN")}/{company.goal.toLocaleString("vi-VN")} · {company.contributors} người góp ·
                  bạn góp {company.mine.toLocaleString("vi-VN")}
                </p>
              </div>
            ) : <p>Chưa có mục tiêu chung.</p>}
            {state.companyClaimable.length > 0 && (
              <button type="button" className="pch-btn pch-btn-primary self-start" disabled={busy}
                onClick={() => void run(() => questCompanyClaim(token))}>
                🎁 Nhận thưởng cả làng ({state.companyClaimable.map((c) => c.title).join(", ")})
              </button>
            )}
          </div>
        )}
        {state && tab !== "company" && (
          <ul className="flex flex-col gap-2">{list.length ? list.map(row) : <li>Không có nhiệm vụ.</li>}</ul>
        )}
      </div>
    </ParchmentModal>
  );
}
