"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXT_H, EXT_W, INT_H, INT_W, paintHouseExterior, paintHouseInterior } from "@/lib/game/art/house";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  buildCost, CELLS, checkDesign, EMPTY_DESIGN, HOUSE_MAX_ROOMS, HOUSE_TEMPLATES, houseBuild, houseErrorMessage, houseErrText, LOT_COLS,
  LOT_ROWS, LOT_TILE, ROOFS, roomsOf, TILE_PRICES, type Cell, type HouseList, type Roof,
} from "@/lib/game/housing/house";
import { ParchmentModal } from "../Parchment";

interface HouseBuilderProps {
  token: string;
  lot: number;
  /** The house as built now (null: bare land). */
  grid: string | null;
  roof: Roof;
  coins: number | null;
  /** A room is rented: only the roof can change. */
  hasTenants: boolean;
  onState: (s: HouseList) => void;
  onClose: () => void;
}

/** 🏗️ The house builder (v19.3): paint the lot's 20 × 14 cells with floor, walls, doors and windows (or start from a
 *  ready design), pick a roof, see the rooms, the price of the change and whether the house is valid (the server
 *  re-checks and re-prices on save). No build time: the save is the house. */
export default function HouseBuilder({ token, lot, grid, roof: roof0, coins, hasTenants, onState, onClose }: HouseBuilderProps) {
  const [draft, setDraft] = useState(grid ?? EMPTY_DESIGN);
  const [roof, setRoof] = useState<Roof>(roof0);
  const [tool, setTool] = useState<Cell>("w");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const extRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  useEffect(() => {
    const fit = () => setScale(Math.max(1, Math.min(3, Math.floor((Math.min(window.innerWidth, 1100) - 60) / INT_W))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // the plan (the interior's shell with a grid and the room numbers) and the street view
  const { cells: rooms, count } = useMemo(() => roomsOf(draft), [draft]);
  useEffect(() => {
    const c = canvasRef.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, INT_W, INT_H);
    paintHouseInterior(c, draft, null, null);
    c.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = 0; x <= INT_W; x += LOT_TILE) c.fillRect(x, 0, 1, INT_H);
    for (let y = 0; y <= INT_H; y += LOT_TILE) c.fillRect(0, y, INT_W, 1);
    // each room's number on its first cell
    c.font = "bold 10px monospace"; c.textAlign = "center"; c.fillStyle = "#3a2418";
    const seen = new Set<number>();
    rooms.forEach((k, i) => {
      if (!k || seen.has(k)) return;
      seen.add(k);
      c.fillText(String(k), (i % LOT_COLS) * LOT_TILE + 8, Math.floor(i / LOT_COLS) * LOT_TILE + 12);
    });
    const e = extRef.current?.getContext("2d");
    if (e) {
      e.imageSmoothingEnabled = false;
      e.fillStyle = "#9a7a4e"; e.fillRect(0, 0, EXT_W, EXT_H + 1);
      paintHouseExterior(e, draft, roof, 0, 0);
    }
  }, [draft, roof, rooms]);

  const paintAt = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const q = Math.floor(((ev.clientX - r.left) / r.width) * LOT_COLS), row = Math.floor(((ev.clientY - r.top) / r.height) * LOT_ROWS);
    if (q < 0 || q >= LOT_COLS || row < 0 || row >= LOT_ROWS) return;
    const i = row * LOT_COLS + q;
    if (draft.charAt(i) === tool) return;
    setDraft(draft.slice(0, i) + tool + draft.slice(i + 1));
  };

  const refusal = checkDesign(draft);
  const cost = buildCost(grid, draft);
  const changed = draft !== (grid ?? EMPTY_DESIGN);
  const poor = coins !== null && coins < cost;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onState(await houseBuild(token, draft, roof));
      onClose();
    } catch (e) {
      setError(houseErrText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParchmentModal title={`🏗️ Xây nhà · Lô ${lot}`} onClose={onClose} className="sm:max-w-5xl">
      <div className="flex flex-col gap-2 overflow-y-auto font-vt text-lg leading-tight" data-testid="house-builder">
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Công cụ">
          {CELLS.map((c) => (
            <button key={c.id} type="button" aria-pressed={tool === c.id} disabled={hasTenants}
              className={`pch-btn px-2 py-0.5 text-base ${tool === c.id ? "pch-btn-primary" : ""}`} onClick={() => setTool(c.id)}>
              {c.icon} {c.name}{c.id !== "." && <span className="opacity-70"> · {TILE_PRICES[c.id]}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <canvas ref={canvasRef} width={INT_W} height={INT_H} data-testid="builder-canvas"
            className={`max-w-full touch-none rounded-sm border-4 border-[#5a381e] [image-rendering:pixelated] ${hasTenants ? "opacity-70" : "cursor-crosshair"}`}
            style={{ width: INT_W * scale, height: INT_H * scale }}
            onPointerDown={(e) => { if (hasTenants) return; painting.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); paintAt(e); }}
            onPointerMove={(e) => { if (painting.current) paintAt(e); }}
            onPointerUp={() => { painting.current = false; }}
            onPointerCancel={() => { painting.current = false; }} />
          <aside className="flex min-w-0 flex-col gap-2 text-base lg:w-64">
            <div>
              <p>Nhìn từ phố:</p>
              <canvas ref={extRef} width={EXT_W} height={EXT_H + 1} className="rounded-sm border-2 border-[#5a381e] [image-rendering:pixelated]"
                style={{ width: EXT_W * 2, height: (EXT_H + 1) * 2 }} />
            </div>
            <label className="flex flex-wrap items-center gap-1">
              <span>Mái:</span>
              <select className="max-w-full rounded border border-gold-300 bg-cream px-1" value={roof} onChange={(e) => setRoof(e.target.value as Roof)}>
                {ROOFS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {!hasTenants && (
              <div className="flex flex-wrap gap-1">
                {HOUSE_TEMPLATES.map((t) => (
                  <button key={t.id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setDraft(t.design)}>📐 {t.name}</button>
                ))}
                <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setDraft(EMPTY_DESIGN)}>🧹 Xoá hết</button>
                {grid && <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setDraft(grid)}>↩ Như cũ</button>}
              </div>
            )}
            <p data-testid="builder-status">
              {refusal ? <>⚠️ {houseErrorMessage(refusal)}</> : count > 0 ? <>✅ {count} phòng (tối đa {HOUSE_MAX_ROOMS})</> : <>Đất trống</>}
            </p>
            <p>Chi phí thay đổi: <b>{formatXu(cost)}</b>{coins !== null && <> · Bạn có {formatXu(coins)}</>}</p>
            {hasTenants && <p>🔒 Đang có người thuê phòng: chỉ đổi được mái nhà.</p>}
            <p className="text-sm opacity-80">
              Sàn phải được bao kín; cửa nằm trong tường nối hai bên; cửa sổ ở tường ngoài; mỗi phòng ≥ 4 ô; cần cửa chính ra sân.
              Xoá ô không được hoàn tiền. Xây xong là ở được ngay.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy || refusal !== null || poor || (!changed && roof === roof0)}
                onClick={() => void save()}>💾 Lưu{cost > 0 ? ` · ${formatXu(cost)}` : ""}</button>
              <button type="button" className="pch-btn" onClick={onClose}>Huỷ</button>
            </div>
            {error && <p role="alert" className="text-red-700">{error}</p>}
          </aside>
        </div>
      </div>
    </ParchmentModal>
  );
}
