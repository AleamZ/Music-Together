"use client";

import { useEffect, useState } from "react";
import { questErrorMessage } from "@/lib/game/quests/model";
import { captureCanvas, findGameCanvas, type Shot } from "@/lib/game/quests/photo";
import { photoSave } from "@/lib/game/quests/rpc";
import { shutterClick } from "@/lib/game/river/beep";

/** v22: the shutter's white flash and the polaroid sliding in (reduced motion: neither moves). */
const PHOTO_FX = `
.photo-flash { position: fixed; inset: 0; z-index: 60; background: #fff; pointer-events: none; animation: photo-flash 420ms ease-out forwards; }
@keyframes photo-flash { 0% { opacity: .95; } 100% { opacity: 0; } }
.photo-slide { animation: photo-slide 650ms cubic-bezier(.2,.9,.25,1.15) both; }
@keyframes photo-slide { 0% { transform: translateY(70vh) rotate(-14deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: translateY(0) rotate(-2deg); } }
.photo-develop { animation: photo-develop 1.6s ease-out both; }
@keyframes photo-develop { 0% { filter: brightness(1.8) sepia(.8) blur(1px); } 100% { filter: none; } }
@media (prefers-reduced-motion: reduce) { .photo-flash { animation: none; opacity: 0; } .photo-slide, .photo-develop { animation: none; transform: rotate(-2deg); } }`;

/** 📷 Chế độ chụp ảnh (v21 #94): a full-screen layer over the HUD. First the clean world with a shutter, then the shot
 *  with Lưu vào album / Tải về. The capture is the world canvas only, so the HUD is never in it. */
export default function PhotoMode({ token, mapId, onSaved, onClose }: {
  token: string; mapId: string; onSaved?: () => void; onClose: () => void;
}) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [caption, setCaption] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [takenAt, setTakenAt] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // hide the HUD: every sibling of the world canvas (the shell's overlays) while the photo mode is open
  useEffect(() => {
    const c = findGameCanvas();
    const hidden: HTMLElement[] = [];
    for (const el of Array.from(c?.parentElement?.children ?? [])) {
      if (el === c || !(el instanceof HTMLElement) || el.style.visibility === "hidden") continue;
      if (el.matches("[data-photo-mode]") || el.querySelector("[data-photo-mode]")) continue;
      el.style.visibility = "hidden";
      hidden.push(el);
    }
    return () => { for (const el of hidden) el.style.visibility = ""; };
  }, []);

  const snap = () => {
    const c = findGameCanvas();
    const s = c ? captureCanvas(c) : null;
    if (!s) setMsg("Không chụp được khung hình.");
    setTakenAt(Date.now());
    shutterClick();
    setShot(s);
  };

  const save = async () => {
    if (!shot) return;
    setBusy(true);
    setMsg(null);
    try {
      await photoSave(token, shot.dataUrl, shot.w, shot.h, mapId, caption.trim().slice(0, 60));
      setMsg("Đã lưu vào album!");
      onSaved?.();
    } catch (e) {
      setMsg(questErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : ""));
    } finally {
      setBusy(false);
    }
  };

  if (!shot) {
    // the HUD is covered by a transparent layer; only the shutter shows
    return (
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Chế độ chụp ảnh" data-testid="photo-mode" data-photo-mode>
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <button type="button" className="pch-btn pch-btn-primary px-4 py-2 text-2xl" onClick={snap} aria-label="Chụp">📸</button>
          <button type="button" className="pch-btn" onClick={onClose}>✕ Thoát</button>
        </div>
        {msg && <p className="absolute inset-x-0 top-4 text-center font-vt text-lg text-white drop-shadow">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-3" role="dialog" aria-modal="true" aria-label="Ảnh vừa chụp" data-photo-mode>
      <style>{PHOTO_FX}</style>
      <span key={takenAt} className="photo-flash" aria-hidden="true" />
      <div className="pch flex max-h-[92vh] w-full max-w-2xl flex-col items-center gap-2 p-3 font-vt text-lg">
        {/* v22: the polaroid — a white card with a wide bottom margin, sliding in and developing */}
        <figure key={takenAt} className="photo-slide flex flex-col items-center bg-[#fbf8ef] p-2 pb-8 shadow-[0_6px_14px_rgba(0,0,0,.35)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- the shot's data URL */}
          <img src={shot.dataUrl} alt="Ảnh vừa chụp" className="photo-develop max-h-[52vh] max-w-full [image-rendering:pixelated]" />
          <figcaption className="mt-1 min-h-6 font-vt text-xl text-ink">{caption || " "}</figcaption>
        </figure>
        <input className="w-full max-w-sm rounded border border-gold-300 bg-parchment px-2" maxLength={60} placeholder="Chú thích (tuỳ chọn)"
          value={caption} onChange={(e) => setCaption(e.target.value)} />
        {msg && <p role="status" className="text-burgundy">{msg}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void save()}>🖼️ Lưu vào album</button>
          <a className="pch-btn" href={shot.dataUrl} download={`music-together-${takenAt}.jpg`}>💾 Tải về</a>
          <button type="button" className="pch-btn" onClick={() => { setShot(null); setMsg(null); }}>📷 Chụp lại</button>
          <button type="button" className="pch-btn" onClick={onClose}>✕ Đóng</button>
        </div>
      </div>
    </div>
  );
}
