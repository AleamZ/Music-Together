"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import {
  CHANGELOG_2026_09_28, CHANGELOG_SECTIONS, CHANGELOG_TITLE, NEW_LABEL, OLD_LABEL, changelogImg,
  type ChangelogCard,
} from "@/lib/game/news/changelog";

/** A drag farther than this (px) turns the card. */
const SWIPE_PX = 50;

function Picture({ file, alt, emoji }: { file?: string; alt: string; emoji: string }) {
  const [broken, setBroken] = useState(false);
  if (!file || broken) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-sm border-2 border-dashed border-ink/30 bg-[#efe0b8] text-5xl"
        data-testid="changelog-placeholder" aria-hidden="true">
        {emoji}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static pixel art, drawn nearest-neighbour
    <img src={changelogImg(file)} alt={alt} draggable={false} loading="lazy" onError={() => setBroken(true)}
      className="max-h-[38vh] w-full rounded-sm border-2 border-ink/40 bg-[#efe0b8] object-contain"
      style={{ imageRendering: "pixelated" }} />
  );
}

function CardBody({ card }: { card: ChangelogCard }) {
  return (
    <article className="flex flex-col gap-2" data-testid="changelog-card" data-card-id={card.id}>
      <div className="flex flex-wrap items-center gap-2">
        {card.kind === "new"
          ? <span className="rounded-sm bg-burgundy px-1.5 text-sm text-parchment" data-testid="changelog-new">✨ Tính năng mới</span>
          : <span className="rounded-sm bg-ink px-1.5 text-sm text-parchment">🔄 Thay đổi</span>}
        <span className="text-sm opacity-70">{card.date}</span>
      </div>
      <h3 className="flex items-start gap-2 font-playfair text-2xl font-bold leading-tight text-ink">
        <span aria-hidden="true">{card.emoji}</span><span>{card.title}</span>
      </h3>
      {card.kind === "changed" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="changelog-compare">
          <figure className="flex flex-col gap-1">
            <figcaption className="text-sm font-bold uppercase tracking-wide opacity-70">{card.oldLabel ?? OLD_LABEL}</figcaption>
            <Picture file={card.oldImg} alt={`${card.title}: trước`} emoji="🕰️" />
            <p>{card.oldText}</p>
          </figure>
          <figure className="flex flex-col gap-1">
            <figcaption className="text-sm font-bold uppercase tracking-wide text-burgundy">{NEW_LABEL}</figcaption>
            <Picture file={card.newImg} alt={`${card.title}: bây giờ`} emoji={card.emoji} />
            <p>{card.newText}</p>
          </figure>
        </div>
      ) : (
        <>
          <Picture file={card.img} alt={card.title} emoji={card.emoji} />
          <p><strong>Mục đích:</strong> {card.purpose}</p>
        </>
      )}
      {card.howTo.length > 0 && (
        <div>
          <p className="font-bold">Cách dùng:</p>
          <ol className="list-decimal pl-5">{card.howTo.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      )}
    </article>
  );
}

/** The 25–28/9 bulletin as a swipeable card deck: drag, ←/→, buttons, dots, section chips. */
export function ChangelogCarousel({ cards = CHANGELOG_2026_09_28, onDone }: {
  cards?: readonly ChangelogCard[];
  /** Shown on the last card ("Đã xem hết"). */
  onDone?: () => void;
}) {
  const [at, setAt] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);
  const n = cards.length;
  const i = Math.min(at, n - 1);
  const card = cards[i];
  const go = (to: number) => setAt(Math.max(0, Math.min(n - 1, to)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setAt((a) => Math.min(n - 1, a + 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (start.current?.id === e.pointerId) setDrag(e.clientX - start.current.x);
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (dx <= -SWIPE_PX) go(i + 1);
    else if (dx >= SWIPE_PX) go(i - 1);
  };

  if (!card) return <p className="opacity-70">Chưa có bản tin.</p>;
  return (
    <div className="flex flex-col gap-2 font-vt text-lg leading-snug" data-testid="changelog">
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Mục">
        {CHANGELOG_SECTIONS.filter((s) => cards.some((c) => c.section === s.id)).map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={card.section === s.id}
            onClick={() => go(cards.findIndex((c) => c.section === s.id))}
            className={`shrink-0 rounded-sm border-2 px-2 py-0.5 text-sm ${card.section === s.id ? "border-ink bg-[#fff4d6]" : "border-ink/30"}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="touch-pan-y select-none overflow-hidden rounded-sm border border-ink/30 bg-[#f7ecd0] p-3"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(0); }}
        aria-roledescription="carousel" aria-live="polite">
        <div className="motion-safe:transition-transform motion-reduce:!transform-none"
          style={{ transform: drag ? `translateX(${drag * 0.4}px)` : undefined }}>
          <CardBody key={card.id} card={card} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="pch-btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Thẻ trước">←</button>
        <span className="text-sm" data-testid="changelog-count">{i + 1}/{n}</span>
        {i === n - 1 && onDone
          ? <button type="button" className="pch-btn pch-btn-primary" onClick={onDone}>Đã xem hết</button>
          : <button type="button" className="pch-btn" onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Thẻ sau">→</button>}
      </div>
      <div className="flex flex-wrap justify-center gap-1" aria-hidden="true">
        {cards.map((c, k) => (
          <button key={c.id} type="button" tabIndex={-1} onClick={() => go(k)} title={c.title}
            className={`h-2 w-2 rounded-full ${k === i ? "bg-burgundy" : "bg-ink/25"}`} />
        ))}
      </div>
    </div>
  );
}

/** The bulletin in its own parchment window (the stand's pinned item and the first-visit popup). */
export default function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <ParchmentModal title={`📰 ${CHANGELOG_TITLE}`} onClose={onClose} className="sm:max-w-3xl">
      <ChangelogCarousel onDone={onClose} />
    </ParchmentModal>
  );
}
