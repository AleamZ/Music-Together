"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ShareButtonsProps = { code: string; title?: string };
type ToastTone = "ok" | "warn";
type Toast = { msg: string; tone: ToastTone };

function roomUrl(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-9999px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function ShareButtons({ code, title }: ShareButtonsProps) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string, tone: ToastTone = "ok") => {
    setToast({ msg, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleCopyCode = useCallback(async () => {
    const ok = await copyText(code);
    flash(ok ? `Đã sao chép mã ${code}!` : `Sao chép thủ công: ${code}`, ok ? "ok" : "warn");
  }, [code, flash]);

  const handleShare = useCallback(async () => {
    const url = roomUrl(code);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ title: title ?? "Music Together", text: `Tham gia phòng nhạc ${code}`, url }); return; }
      catch (err) { if (err instanceof DOMException && err.name === "AbortError") return; }
    }
    const ok = await copyText(url);
    flash(ok ? "Đã sao chép liên kết!" : `Sao chép thủ công: ${url}`, ok ? "ok" : "warn");
  }, [code, title, flash]);

  return (
    <div className="relative inline-flex items-center gap-2">
      <button type="button" onClick={handleCopyCode} className="rounded-lg border border-dashed border-gold bg-cream px-2 py-1 text-xs text-ink transition hover:bg-parchment-200">🔗 {code} · 📋</button>
      <button type="button" onClick={handleShare} className="rounded-lg border border-gold bg-cream px-3 py-1 text-xs text-burgundy transition hover:bg-parchment-200">📤 Chia sẻ</button>
      {toast && (
        <span role="status" aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] shadow ${toast.tone === "ok" ? "border-gold-200 bg-cream text-burgundy" : "border-burgundy-accent bg-cream text-burgundy-accent"}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}
