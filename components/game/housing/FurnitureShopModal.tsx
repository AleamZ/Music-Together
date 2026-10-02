"use client";

import { useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import { errText, FURNITURE, furnitureBuy, STYLE_NAMES, type AptList, type FurnitureKind } from "@/lib/game/housing/apartment";
import { ParchmentModal } from "../Parchment";
import FurnitureIcon from "./FurnitureIcon";

const TABS: ReadonlyArray<{ id: string; name: string; kinds: readonly FurnitureKind[] }> = [
  { id: "bed", name: "🛏️ Giường", kinds: ["bed"] },
  { id: "sit", name: "🪑 Bàn ghế", kinds: ["table", "chair", "sofa"] },
  { id: "deco", name: "🪴 Đèn, cây", kinds: ["lamp", "plant"] },
  { id: "rug", name: "🧺 Thảm, kệ, tủ", kinds: ["rug", "shelf", "cabinet"] },
  { id: "art", name: "🖼️ Tranh", kinds: ["painting"] },                     // v21
  { id: "aqua", name: "🐠 Bể cá", kinds: ["aquarium"] },                    // v21
  { id: "tech", name: "📺 Điện máy", kinds: ["tv", "fridge"] },
  { id: "surface", name: "🎨 Tường, sàn", kinds: ["wall", "floor"] },
];

const NOTES: Partial<Record<string, string>> = {
  tv: "Xem YouTube cùng khách trong nhà",
  fridge: "Giữ 20 con cá, không tính vào giỏ",
  fridge_big: "Giữ 50 con cá, không tính vào giỏ",
  aquarium: "Nuôi 4 con cá sống, khách đến chơi ngắm được",                 // v21
  aquarium_big: "Nuôi 8 con cá sống, khách đến chơi ngắm được",             // v21
};

/** 🛋️ Nội thất cô Năm (v19.2): the furniture catalogue by kind; a purchase goes to my storage, to place at home. */
export default function FurnitureShopModal({ token, coins, storage, onState, onClose }: {
  token: string;
  coins: number | null;
  storage: AptList["storage"];
  onState: (s: AptList) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(TABS[0].id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kinds = TABS.find((t) => t.id === tab)!.kinds;
  const buy = async (id: string, name: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      onState(await furnitureBuy(token, id));
      setMsg({ ok: true, text: `Đã mua ${name} — cất trong kho, về nhà bấm 🛠️ Trang trí để đặt.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <ParchmentModal title="🛋️ Nội thất cô Năm" onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <p>“Giường, bàn ghế, đèn, cây kiểng, tivi, tủ lạnh… đủ kiểu gỗ, hiện đại, mây tre. Mua xong đồ nằm trong kho, về nhà mà bày!”</p>
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`pch-btn px-2 py-0.5 text-base ${tab === t.id ? "pch-btn-primary" : ""}`} onClick={() => setTab(t.id)}>{t.name}</button>
          ))}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="furniture-list">
          {FURNITURE.filter((f) => kinds.includes(f.kind)).map((f) => {
            const have = storage.filter((s) => s.item === f.id).length;
            if (f.exclusive && have === 0) return null;                                       // 0118: never sold
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-sm border-2 border-gold-200 bg-cream p-1.5">
                <FurnitureIcon item={f.id} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xl font-bold text-burgundy">{f.name}</span>
                  <span className="text-sm opacity-80">
                    {STYLE_NAMES[f.style]}{f.w > 0 ? ` · ${f.w}×${f.h} ô` : ""}{have > 0 ? ` · kho: ${have}` : ""}
                  </span>
                  {NOTES[f.id] && <span className="text-sm">{NOTES[f.id]}</span>}
                  {f.exclusive ? <span className="text-sm font-bold text-gold-700">β Kỷ niệm Beta · không bán, không tặng</span> : (
                    <button type="button" className="pch-btn pch-btn-primary self-start" disabled={busy || (coins !== null && coins < f.price)}
                      onClick={() => void buy(f.id, f.name)}>Mua · {formatXu(f.price)}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {coins !== null && <p className="opacity-80">Bạn có {formatXu(coins)}</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "" : "text-red-700"}>{msg.text}</p>}
      </div>
    </ParchmentModal>
  );
}
