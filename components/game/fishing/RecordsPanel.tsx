"use client";

import { useEffect, useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { formatWeight, formatXu, RARITY_COLOR, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingBoard } from "@/lib/game/fishing/rpc";

type Tab = "records" | "richest";

/** 🏆 Bảng kỷ lục (spec §10.2): the room's record per species next to my best, and the room's richest members. */
export default function RecordsPanel({ catalog, load, onClose }: {
  catalog: FishingCatalog | null;
  /** fishing_board for this room. */
  load: () => Promise<FishingBoard>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("records");
  const [board, setBoard] = useState<FishingBoard | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    load()
      .then((b) => {
        if (!active) return;
        setBoard(b);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const tabButton = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} className={`pch-btn ${tab === t ? "pch-btn-primary" : ""}`} onClick={() => setTab(t)}>
      {label}
    </button>
  );

  return (
    <ParchmentModal title="🏆 Bảng kỷ lục" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div className="flex gap-1.5" role="tablist">
          {tabButton("records", "Kỷ lục câu cá")}
          {tabButton("richest", "Đại gia")}
        </div>
        {error && (
          <p>
            Không tải được bảng.{" "}
            <button type="button" className="pch-btn" onClick={() => setAttempt((a) => a + 1)}>Thử lại</button>
          </p>
        )}
        {!board && !error && <p>Đang tải…</p>}
        {board && tab === "records" && (
          <table className="w-full text-left">
            <thead className="text-base opacity-80">
              <tr><th>Loài</th><th>Kỷ lục phòng</th><th>Của bạn</th></tr>
            </thead>
            <tbody>
              {(catalog?.species ?? []).map((s) => {
                const top = board.records.find((r) => r.speciesId === s.id);
                const mine = board.mine.find((r) => r.speciesId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="flex items-center gap-1.5 py-0.5">
                      <ItemIcon id={s.id} scale={2} />
                      <span style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                    </td>
                    <td>{top ? `${top.username} · ${formatWeight(top.weightG)}` : "—"}</td>
                    <td>{mine ? formatWeight(mine.weightG) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {board && tab === "richest" && (
          <>
            {board.richest.length === 0 ? (
              <p className="opacity-70">Chưa ai có xu.</p>
            ) : (
              <ol className="list-decimal pl-8">
                {board.richest.map((r, i) => <li key={`${r.username}-${i}`}>{r.username} — {formatXu(r.coins)}</li>)}
              </ol>
            )}
            <p className="text-burgundy">Bạn: hạng {board.myRank} · {formatXu(board.myCoins)}</p>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
