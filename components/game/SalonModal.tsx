"use client";

import { useState } from "react";
import { HAIR_COLOR, HAIR_COLOR_LABEL, HAIR_STYLE_LABEL } from "@/lib/game/art/palettes";
import { formatXu } from "@/lib/game/fishing/catalog";
import { salonErrorMessage, salonPrice, salonStyle } from "@/lib/game/salon";
import { HAIR_COLORS, HAIR_STYLES_BY_GENDER, type HairColor, type HairStyle, type Look } from "@/lib/game/types";
import { ParchmentModal } from "./Parchment";
import SpritePreview from "./SpritePreview";

interface SalonModalProps {
  token: string;
  look: Look;
  coins: number | null;
  onStyled: (newLook: Look) => void;
  onClose: () => void;
}

/** ✂️ Salon · anh Ba (v18.6): pick a style and a colour, see it in the mirror, pay once. The prices shown are a display
 *  copy of salon_style's; the server decides what is charged. */
export default function SalonModal({ token, look, coins, onStyled, onClose }: SalonModalProps) {
  const gender = look.gender === "nu" ? "nu" : "nam";
  const [hair, setHair] = useState<HairStyle>(look.hair);
  const [hairColor, setHairColor] = useState<HairColor>(look.hairColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the body's styles are offered; a style worn from before the split stays listed (as "đang để") so a dye-only
  // visit keeps it — salon_style (0035) accepts the current style whatever the body.
  const offered = HAIR_STYLES_BY_GENDER[gender];
  const styles = offered.includes(look.hair) ? offered : [look.hair, ...offered];
  const preview: Look = { ...look, hair, hairColor };
  const price = salonPrice({ hair: look.hair, hairColor: look.hairColor }, { hair, hairColor });
  const short = price !== null && coins !== null && coins < price;

  const pay = async () => {
    if (busy || price === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await salonStyle(token, hair, hairColor);
      onStyled({ ...look, hair: r.hair, hairColor: r.hairColor });
    } catch (e) {
      setError(salonErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const what = price === null ? null
    : hair !== look.hair && hairColor !== look.hairColor ? "Cắt kiểu mới + nhuộm màu"
    : hair !== look.hair ? "Cắt kiểu mới" : "Nhuộm màu";

  return (
    <ParchmentModal title="✂️ Salon · anh Ba" onClose={onClose} className="sm:max-w-[860px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 font-vt text-lg">
        <p className="leading-tight">“Ngồi đi em! Muốn cắt kiểu nào, nhuộm màu gì cứ chọn, anh làm liền.”</p>
        <div className="flex flex-col gap-3 md:flex-row">
          {/* the mirror */}
          <div className="flex shrink-0 flex-col items-center gap-2 md:w-60">
            <div className="relative rounded-[40%_40%_8px_8px] border-4 border-gold-400 bg-linear-to-b from-sky-100 to-sky-200 px-6 pb-3 pt-6 shadow-md">
              <span aria-hidden="true" className="absolute left-1/2 top-1 flex -translate-x-1/2 gap-3">
                {[0, 1, 2, 3, 4].map((k) => <span key={k} className="h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_4px_#fde68a]" />)}
              </span>
              <SpritePreview look={preview} mode="walk" scale={5} />
            </div>
            <span className="text-base font-bold uppercase tracking-wide opacity-80">Gương</span>
            <div className="flex items-center gap-2 text-base" aria-label="Trước và sau">
              <span className="flex flex-col items-center">
                <SpritePreview look={look} scale={2} className="rounded-sm border border-gold-300 bg-parchment" />
                <span className="opacity-75">Trước</span>
              </span>
              <span aria-hidden="true">→</span>
              <span className="flex flex-col items-center">
                <SpritePreview look={preview} scale={2} className="rounded-sm border border-gold-300 bg-parchment" />
                <span className="opacity-75">Sau</span>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <section>
              <h3 className="mb-1 text-xl text-burgundy">
                {gender === "nu" ? "Kiểu tóc nữ" : "Kiểu tóc nam"} <span className="text-base opacity-70">· {formatXu(300)}</span>
              </h3>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {styles.map((s) => {
                  const on = s === hair;
                  return (
                    <button key={s} type="button" aria-pressed={on} onClick={() => { setHair(s); setError(null); }}
                      className={`flex flex-col items-center gap-0.5 rounded-sm border-2 p-1 text-base leading-tight transition-colors ${
                        on ? "border-burgundy bg-gold-200 font-bold text-burgundy" : "border-gold-200 bg-cream hover:border-gold-400"}`}>
                      <SpritePreview look={{ ...look, hat: null, hair: s, hairColor }} scale={2} className="rounded-sm bg-parchment" />
                      <span>{HAIR_STYLE_LABEL[s]}</span>
                      {s === look.hair && <span className="text-sm opacity-70">(đang để)</span>}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-xl text-burgundy">Màu tóc <span className="text-base opacity-70">· {formatXu(500)}</span></h3>
              <div className="flex flex-wrap gap-2">
                {HAIR_COLORS.map((c) => {
                  const on = c === hairColor, tone = HAIR_COLOR[c];
                  return (
                    <button key={c} type="button" aria-pressed={on} aria-label={HAIR_COLOR_LABEL[c]} title={HAIR_COLOR_LABEL[c]}
                      onClick={() => { setHairColor(c); setError(null); }}
                      className={`flex w-14 flex-col items-center gap-0.5 text-sm leading-tight ${on ? "font-bold text-burgundy" : ""}`}>
                      <span aria-hidden="true"
                        className={`h-9 w-9 rounded-full border-2 ${on ? "border-burgundy ring-2 ring-gold-400" : "border-ink/40"}`}
                        style={{ background: `linear-gradient(135deg, ${tone.H} 0%, ${tone.h} 45%, ${tone.d} 100%)` }} />
                      <span>{HAIR_COLOR_LABEL[c]}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border-2 border-gold-300 bg-cream px-3 py-2">
              <span data-testid="salon-price">
                {price === null
                  ? "Chọn kiểu hoặc màu mới nhé."
                  : <>{what}: <b className="text-xl text-amber-800">{formatXu(price)}</b></>}
              </span>
              {coins !== null && <span className={`text-base ${short ? "text-burgundy-accent" : "opacity-80"}`}>Trong túi: {formatXu(coins)}</span>}
            </div>
            <p className="text-sm opacity-70">Chỉ cắt: 300 xu · Chỉ nhuộm: 500 xu · Cắt + nhuộm: 700 xu</p>
          </div>
        </div>

        {error && <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">{error}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t-2 border-gold-200 pt-2">
          <button type="button" className="pch-btn" onClick={() => { setHair(look.hair); setHairColor(look.hairColor); setError(null); }}
            disabled={busy || price === null}>
            🔄 Như cũ
          </button>
          <button type="button" className="pch-btn pch-btn-primary text-xl" disabled={busy || price === null} onClick={() => void pay()}
            title={short ? "Chưa đủ xu" : undefined}>
            {busy ? "Đang làm…" : `✂️ Làm tóc${price === null ? "" : ` (${price} xu)`}`}
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
