"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { producePrice, ricePrice, type FarmCatalog, type UplandCrop, type Variety } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

/** One stock line: a variety, wet or dry, with "Bán" for the chosen kg and "Bán hết". */
function StockRow({ v, dry, kg, busy, onSell }: { v: Variety; dry: boolean; kg: number; busy: boolean; onSell: (variety: string, dry: boolean, kg: number) => void }) {
  const [amount, setAmount] = useState(Math.min(10, kg));
  const n = Math.min(Math.max(1, amount), kg);
  const perKg = dry ? v.pricePerKg : ricePrice(10, v.pricePerKg, false) / 10;
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={dry ? "rice_dry" : "rice_wet"} scale={3} />
        <div className="flex flex-col leading-none">
          <span className="text-xl">{v.name} {dry ? "khô" : "ướt"} · {kg} kg</span>
          <span className="text-base">{perKg.toLocaleString("vi-VN")} xu/kg{dry ? "" : " (lúa ướt 70%)"}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Stepper value={n} max={kg} label={`Số kg ${v.name} ${dry ? "khô" : "ướt"}`} unit=" kg" onChange={setAmount} />
        <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(v.id, dry, n)}>
          Bán · {formatXu(ricePrice(n, v.pricePerKg, dry))}
        </button>
      </div>
      <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(v.id, dry, kg)}>
        Bán hết · {formatXu(ricePrice(kg, v.pricePerKg, dry))}
      </button>
    </li>
  );
}

/** One hoa-màu line (v15.2 §13.5): sold fresh, some or all. */
function ProduceRow({ u, kg, busy, onSell }: { u: UplandCrop; kg: number; busy: boolean; onSell: (upland: string, kg: number) => void }) {
  const [amount, setAmount] = useState(Math.min(10, kg));
  const n = Math.min(Math.max(1, amount), kg);
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={`produce_${u.id}`} scale={3} />
        <div className="flex flex-col leading-none">
          <span className="text-xl">{u.name} · {kg} kg</span>
          <span className="text-base">{u.pricePerKg.toLocaleString("vi-VN")} xu/kg · bán tươi</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Stepper value={n} max={kg} label={`Số kg ${u.name}`} unit=" kg" onChange={setAmount} />
        <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(u.id, n)}>Bán · {formatXu(producePrice(n, u))}</button>
      </div>
      <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(u.id, kg)}>
        Bán hết · {formatXu(producePrice(kg, u))}
      </button>
    </li>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5): sell wet or dry rice per variety — dry rice pays the full price —
 *  and hoa màu, fresh. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose }: {
  mine: FarmMine | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  busy: boolean;
  onSell: (variety: string, dry: boolean, kg: number) => void;
  onSellProduce: (upland: string, kg: number) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const lines = (catalog?.varieties ?? []).flatMap((v) => {
    const stock = mine?.rice[v.id];
    return [
      ...(stock && stock.dry > 0 ? [{ v, dry: true, kg: stock.dry }] : []),
      ...(stock && stock.wet > 0 ? [{ v, dry: false, kg: stock.wet }] : []),
    ];
  });
  const produce = (catalog?.uplands ?? []).flatMap((u) => ((mine?.produce[u.id] ?? 0) > 0 ? [{ u, kg: mine!.produce[u.id] }] : []));
  return (
    <ParchmentModal title="🌾 Vựa lúa · cô Út" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!mine || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : lines.length + produce.length === 0 ? (
          <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
        ) : (
          <>
            <p>{lines.length > 0 ? "“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”" : "“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”"}</p>
            <ul className="flex flex-col gap-2">
              {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
              {produce.map((x) => <ProduceRow key={x.u.id} u={x.u} kg={x.kg} busy={busy} onSell={onSellProduce} />)}
            </ul>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
