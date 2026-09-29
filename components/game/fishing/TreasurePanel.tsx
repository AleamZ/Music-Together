"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { hintRect, MAP_NAMES, MAP_SIZES, type ExtrasState, type TreasureMap } from "@/lib/game/fishing/extras";

const SOURCE: Record<TreasureMap["source"], string> = { fishing: "câu được", boat: "câu trên sông", dig: "đào trùn được" };

/** The hint image: an old map of the whole place, torn edges, a 4 × 3 grid and the quarter inked with an X — never the
 *  spot itself (the server keeps it). Original SVG art. */
function HintImage({ m }: { m: TreasureMap }) {
  const s = MAP_SIZES[m.map] ?? { w: 640, h: 400 };
  const r = hintRect(m.map, m.cell);
  const W = 240, H = Math.round((W * s.h) / s.w), k = W / s.w;
  const edge = Array.from({ length: 13 }, (_, i) => `${(i * W) / 12},${i % 2 ? 3 : 0}`).join(" ");
  return (
    <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} width={W + 12} height={H + 12} role="img" aria-label={`Bản đồ ${MAP_NAMES[m.map] ?? m.map}`}
      className="shrink-0" style={{ imageRendering: "pixelated" }}>
      <rect x={-4} y={-4} width={W + 8} height={H + 8} fill="#d9c28f" stroke="#6e4424" strokeWidth={2} />
      <polyline points={edge} fill="none" stroke="#a8743f" strokeWidth={2} />
      {m.map === "pond" && <ellipse cx={300 * k} cy={180 * k} rx={180 * k} ry={105 * k} fill="#6fb2cf" stroke="#2f6e8f" strokeWidth={1.5} />}
      {m.map === "field" && (
        <>
          <rect x={56 * k} y={176 * k} width={708 * k} height={32 * k} fill="#6fb2cf" />
          {[72, 224, 376, 528].map((x) => <rect key={x} x={x * k} y={52 * k} width={128 * k} height={96 * k} fill="#b8c96a" stroke="#6a9a38" />)}
          {[228, 328].flatMap((y) => [72, 224, 376].map((x) => <rect key={`${x}-${y}`} x={x * k} y={y * k} width={128 * k} height={76 * k} fill="#b8c96a" stroke="#6a9a38" />))}
        </>
      )}
      {[1, 2, 3].map((i) => <line key={`v${i}`} x1={(i * W) / 4} y1={0} x2={(i * W) / 4} y2={H} stroke="#8b5a33" strokeDasharray="3 3" strokeWidth={0.8} />)}
      {[1, 2].map((i) => <line key={`h${i}`} x1={0} y1={(i * H) / 3} x2={W} y2={(i * H) / 3} stroke="#8b5a33" strokeDasharray="3 3" strokeWidth={0.8} />)}
      {r && (
        <>
          <rect x={r.x * k} y={r.y * k} width={r.w * k} height={r.h * k} fill="#c0392b" fillOpacity={0.18} stroke="#8e2a1f" strokeWidth={1.5} />
          <path d={`M ${(r.x + r.w / 2) * k - 7} ${(r.y + r.h / 2) * k - 7} l 14 14 m -14 0 l 14 -14`} stroke="#8e2a1f" strokeWidth={3} />
        </>
      )}
      <g transform={`translate(${W - 16} 16)`}>
        <circle r={10} fill="#f4efe0" stroke="#6e4424" />
        <path d="M 0 -8 L 3 0 L 0 8 L -3 0 Z" fill="#8e2a1f" />
        <text y={-11} textAnchor="middle" fontSize={7} fill="#3a2418">B</text>
      </g>
    </svg>
  );
}

/** v21 (0076) 🗺️ Bản đồ kho báu: each map shows its place, a landmark and the quarter it points to; "Đào ở đây" digs
 *  where I stand (the server checks the spot and my position; a miss says hot, warm or cold). */
export default function TreasurePanel({ state, mapId, busy, notes, onDig, onClose }: {
  state: ExtrasState | null;
  /** The map I am on (null: none shown). */
  mapId: string | null;
  busy: boolean;
  notes: Record<string, string>;
  onDig: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <ParchmentModal title="🗺️ Bản đồ kho báu" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state ? <p>Đang tải…</p> : state.maps.length === 0 ? (
          <p>Chưa có tấm bản đồ nào. Câu cá (nhất là trên Sông Cái) hoặc đào trùn, thỉnh thoảng sẽ nhặt được một tấm!{state.found > 0 ? ` Bạn đã tìm được ${state.found} kho báu.` : ""}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.maps.map((m) => {
              const here = mapId === m.map;
              return (
                <li key={m.id} className="pch flex flex-col gap-2 p-2 sm:flex-row">
                  <HintImage m={m} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xl text-burgundy">{MAP_NAMES[m.map] ?? m.map}</span>
                    <span>📍 {m.landmark}</span>
                    <span className="text-base opacity-80">Tấm bản đồ {SOURCE[m.source]} · đã đào {m.digs} lần</span>
                    {notes[m.id] && <span>{notes[m.id]}</span>}
                    <button type="button" className="pch-btn pch-btn-primary self-start" disabled={busy || !here} onClick={() => onDig(m.id)}>
                      {here ? "📡 Bật máy dò kho báu" : `Tới ${MAP_NAMES[m.map] ?? m.map} để đào`}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ParchmentModal>
  );
}
