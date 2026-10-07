"use client";

// 0121: the forest's side of the bag (🎒 B) — the tools (axe, bow, pan with their durability), the logs, the wild goods
// and the dishes, read from forest_state when the bag opens. Before this they showed only at the hunter's stall, so a
// player could not see what they carried. Selling, repairing and buying stay at the stall (Bãi đất trống).
import { useEffect, useState } from "react";
import { DAILY_FULL_LOGS, LOG_NAME, QUALITY_NAME, bowBonus, logPrice, panBonus, recipeById, toolById, dishPrice, type LogId } from "@/lib/game/forest/catalog";
import { forestState, type ForestState } from "@/lib/game/forest/rpc";
import { WILD_ITEMS, isWildItem } from "@/lib/game/realm/model";

const KIND_ICON: Readonly<Record<string, string>> = { axe: "🪓", bow: "🏹", pan: "🍳" };

export default function ForestBag({ token }: { token: string }) {
  const [s, setS] = useState<ForestState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    forestState(token).then((x) => { if (live) setS(x); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token]);

  if (failed) return null;
  const tools = (s?.tools ?? []).flatMap((t) => {
    const d = toolById(t.item);
    return d && KIND_ICON[d.kind] ? [{ ...t, d }] : [];
  });
  const meat = Object.entries(s?.meat ?? {}).filter(([, n]) => n > 0);
  return (
    <section aria-label="Đồ rừng">
      <h3 className="text-xl text-burgundy">🌲 Đồ rừng</h3>
      {!s ? <p className="text-base opacity-75">Đang tải…</p> : (
        <ul className="text-base">
          {tools.length === 0 && <li className="py-0.5">Chưa có rìu, cung hay nồi chảo — Sạp thợ săn ở Bãi đất trống có bán.</li>}
          {tools.map((t) => (
            <li key={t.item} className="py-0.5">
              {KIND_ICON[t.d.kind]} {t.d.name} · bền {t.durability}/{t.max}
              {t.d.kind === "bow" && bowBonus(t.d.power) > 0 ? ` · săn trúng +${bowBonus(t.d.power)}%` : ""}
              {t.d.kind === "pan" && panBonus(t.d.power) > 0 ? ` · món +${panBonus(t.d.power)} điểm` : ""}
              {t.d.kind === "axe" ? ` · sức chặt ${t.d.power}` : ""}
              {t.durability === 0 ? " — hư rồi, đem sửa ở Sạp thợ săn" : ""}
            </li>
          ))}
          {s.wood.filter((w) => w.qty + w.half > 0).map((w) => (
            <li key={w.item} className="py-0.5">
              🪵 {LOG_NAME[w.item as LogId] ?? w.item} × {w.qty + w.half}{w.half > 0 ? ` (${w.half} nửa giá)` : ""} · {logPrice(w.item)} xu/khúc
            </li>
          ))}
          {meat.map(([id, n]) => (
            <li key={id} className="py-0.5">
              {isWildItem(id) ? `${WILD_ITEMS[id].icon} ${WILD_ITEMS[id].name}` : id} × {n}{isWildItem(id) ? ` · ${WILD_ITEMS[id].price} xu` : ""}
            </li>
          ))}
          {s.dishes.filter((d) => d.qty > 0).map((d) => {
            const r = recipeById(d.dish);
            return (
              <li key={`${d.dish}${d.quality}`} className="py-0.5">
                🍲 {r?.name ?? d.dish} ({QUALITY_NAME[d.quality] ?? ""}) × {d.qty}{r ? ` · ${dishPrice(r, d.quality)} xu` : ""}
              </li>
            );
          })}
          {s.wood.length + meat.length + s.dishes.length > 0 && (
            <li className="py-0.5 opacity-75">Bán ở Sạp thợ săn (Bãi đất trống): gỗ, món ăn ở nút 🪵, đồ săn ở tab 🏹 Săn bắt. Gỗ hôm nay đủ giá {s.logsToday}/{DAILY_FULL_LOGS} khúc.</li>
          )}
        </ul>
      )}
    </section>
  );
}
