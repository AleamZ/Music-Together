"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { producePrice, ricePrice, type FarmCatalog, type UplandCrop, type Variety } from "@/lib/game/farm/catalog";
import { critterPrice, lowerFirst } from "@/lib/game/farm/gather";
import type { CritterPrices, FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import { formatMult } from "@/lib/game/fishing/prices";
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

/** cô Út's cua & ốc once 0018 has critters (v15.3 §13.4): today's prices, and the sale of a kind or of all (null). */
export interface DepotCritters { prices: CritterPrices | null; onSell: (kind: string | null) => void }

/** 🦀 Cua & ốc: today's prices from the room's M, a row per kind held at the prices fixed at the catch, and Bán hết. */
function CritterSection({ mine, catalog, critters, busy }: { mine: FarmMine; catalog: FarmCatalog; critters: DepotCritters; busy: boolean }) {
  const held = catalog.critters.flatMap((k) => ((mine.critters[k.id]?.n ?? 0) > 0 ? [{ k, s: mine.critters[k.id] }] : []));
  const total = held.reduce((xu, h) => xu + h.s.xu, 0);
  const { prices, onSell } = critters;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xl text-burgundy">🦀 Cua & ốc</h3>
      {prices && (
        <p>
          Giá hôm nay {formatMult(prices.mult)}: {catalog.critters.map((k) => `${lowerFirst(k.name)} ${critterPrice(k.basePrice, prices.mult)}`).join(" · ")} xu/con
        </p>
      )}
      {held.length > 0 && (
        <ul className="flex flex-col gap-2">
          {held.map(({ k, s }) => (
            <li key={k.id} className="pch flex flex-wrap items-center justify-between gap-2 p-2">
              <span className="flex items-center gap-2"><ItemIcon id={k.id} scale={3} />{k.name} × {s.n} · {formatXu(s.xu)}</span>
              <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(k.id)}>Bán {s.n} con · {formatXu(s.xu)}</button>
            </li>
          ))}
        </ul>
      )}
      {held.length > 0 && (
        <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(null)}>
          Bán hết cua ốc · {formatXu(total)}
        </button>
      )}
      <p className="text-base opacity-80">Giá chốt lúc bắt được; bán sau vẫn giữ giá đó.</p>
    </section>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5; v15.3 §13.4): sell wet or dry rice per variety — dry rice pays the
 *  full price — hoa màu, fresh, and cua & ốc once 0018 has critters. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose, critters = null }: {
  mine: FarmMine | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  busy: boolean;
  onSell: (variety: string, dry: boolean, kg: number) => void;
  onSellProduce: (upland: string, kg: number) => void;
  onReload: () => void;
  onClose: () => void;
  critters?: DepotCritters | null;
}) {
  const lines = (catalog?.varieties ?? []).flatMap((v) => {
    const stock = mine?.rice[v.id];
    return [
      ...(stock && stock.dry > 0 ? [{ v, dry: true, kg: stock.dry }] : []),
      ...(stock && stock.wet > 0 ? [{ v, dry: false, kg: stock.wet }] : []),
    ];
  });
  const produce = (catalog?.uplands ?? []).flatMap((u) => ((mine?.produce[u.id] ?? 0) > 0 ? [{ u, kg: mine!.produce[u.id] }] : []));
  const caught = Object.values(mine?.critters ?? {}).some((s) => s.n > 0);
  return (
    <ParchmentModal title="🌾 Vựa lúa · cô Út" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!mine || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            {lines.length + produce.length > 0 ? (
              <>
                <p>{lines.length > 0 ? "“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”" : "“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”"}</p>
                <ul className="flex flex-col gap-2">
                  {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
                  {produce.map((x) => <ProduceRow key={x.u.id} u={x.u} kg={x.kg} busy={busy} onSell={onSellProduce} />)}
                </ul>
              </>
            ) : !critters ? (
              <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
            ) : !caught && (
              <p>“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”</p>
            )}
            {critters && <CritterSection mine={mine} catalog={catalog} critters={critters} busy={busy} />}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
