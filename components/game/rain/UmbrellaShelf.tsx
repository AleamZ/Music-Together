"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { RainView } from "@/hooks/useRain";
import { drawUmbrella } from "@/lib/game/art/rain";
import { formatXu } from "@/lib/game/fishing/catalog";
import { leftText, MAX_UMBRELLAS, UMBRELLAS, umbrellaSpec, type UmbrellaKind } from "@/lib/game/rain/model";
import { ParchmentModal } from "../Parchment";

// v18.9: the umbrellas on sale (chú Tư's and anh Hai's shops, cô Sáu's clothes shop, cô Chín's stall) and the "Cầm tay"
// slot: the umbrellas I own, the one I hold. The game shell provides the rain layer; without it nothing shows.

export const UmbrellaContext = createContext<{ rain: RainView; coins: number | null } | null>(null);

/** The umbrella's canopy as a small pixel icon. */
export function UmbrellaIcon({ kind, scale = 2 }: { kind: UmbrellaKind; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, 28, 30);
    drawUmbrella(c, { x: 13, y: 60 }, "down", kind, 0, true, "front");
    // a short stick with a grip under the canopy
    c.fillStyle = "#3a2418";
    c.fillRect(14, 11, 1, 14);
    c.fillRect(15, 25, 1, 2);
    c.fillRect(13, 26, 2, 1);
  }, [kind]);
  return <canvas ref={ref} width={28} height={30} aria-hidden="true" className="shrink-0 [image-rendering:pixelated]" style={{ width: 28 * scale, height: 30 * scale }} />;
}

/** The umbrellas I own: the held one, and "Cầm" / "Cất ô". */
function MyUmbrellas({ rain }: { rain: RainView }) {
  const mine = rain.state?.umbrellas ?? [];
  if (mine.length === 0) return <p className="opacity-80">Bạn chưa có cây ô nào.</p>;
  return (
    <ul className="flex flex-col gap-1" data-testid="my-umbrellas">
      {mine.map((u) => (
        <li key={u.id} className="flex items-center gap-2">
          <UmbrellaIcon kind={u.kind} scale={1} />
          <span className="min-w-0 flex-1 truncate">{umbrellaSpec(u.kind).name} · còn {leftText(u.leftS)}</span>
          {u.held
            ? <button type="button" className="pch-btn" disabled={rain.busy} onClick={() => rain.hold(null)}>Cất ô</button>
            : <button type="button" className="pch-btn" disabled={rain.busy} onClick={() => rain.hold(u.id)}>Cầm</button>}
        </li>
      ))}
    </ul>
  );
}

/** The umbrellas on sale, and my own ("Cầm tay"). */
export function UmbrellaShelf({ title = "☂️ Ô che mưa" }: { title?: string }) {
  const ctx = useContext(UmbrellaContext);
  if (!ctx) return null;
  const { rain, coins } = ctx;
  const count = rain.state?.umbrellas.length ?? 0;
  return (
    <section className="flex flex-col gap-1" data-testid="umbrella-shelf">
      <h3 className="text-xl text-burgundy">{title}</h3>
      <p className="text-base opacity-80">Mưa mà ra đường không ô là ướt sũng, đói nhanh rồi cảm lạnh. Ô chỉ hao khi che mưa ngoài trời (bão hao gấp 3). Ô không đỡ được sét!</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {UMBRELLAS.map((u) => {
          const poor = coins !== null && coins < u.price;
          return (
            <li key={u.kind} className="pch flex items-center gap-2 p-2">
              <UmbrellaIcon kind={u.kind} />
              <div className="flex min-w-0 flex-1 flex-col">
                <b>{u.name}</b>
                <span className="text-base">{formatXu(u.price)} · {u.minutes} phút mưa</span>
                <span className="text-sm opacity-80">{u.blurb}</span>
              </div>
              <button type="button" className="pch-btn pch-btn-primary" disabled={rain.busy || poor || count >= MAX_UMBRELLAS}
                onClick={() => void rain.buy(u.kind)} aria-label={`Mua ${u.name}`}>Mua</button>
            </li>
          );
        })}
      </ul>
      <h4 className="text-lg">✋ Cầm tay ({count}/{MAX_UMBRELLAS})</h4>
      <MyUmbrellas rain={rain} />
    </section>
  );
}

/** cô Chín's umbrella stall at Chợ Lớn (`shop`), or my umbrellas from the HUD. */
export function UmbrellaModal({ shop, onClose }: { shop: boolean; onClose: () => void }) {
  const ctx = useContext(UmbrellaContext);
  return (
    <ParchmentModal title={shop ? "☂️ Sạp ô dù · cô Chín" : "☂️ Ô của tôi"} onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {ctx && coins(ctx.coins)}
        {shop ? <UmbrellaShelf title="Ô bán hôm nay" /> : ctx ? <MyUmbrellas rain={ctx.rain} /> : null}
      </div>
    </ParchmentModal>
  );
}

function coins(c: number | null) {
  return c === null ? null : <p>Bạn có <b>{formatXu(c)}</b>.</p>;
}
