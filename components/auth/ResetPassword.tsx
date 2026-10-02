"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { emailAuthErrorText, gameSessionFromAuth, handleAuthRedirect, MIN_PASSWORD, setNewPassword, takeRecoveryMark, type RedirectParams } from "@/lib/email-auth";

type Phase = "working" | "form" | "error" | "done";
const input = "rounded-lg border border-gold bg-cream px-3 py-2 text-ink";

/** /auth/reset: the password-reset mail's link signs in (recovery), then the player sets a new password. */
export default function ResetPassword({ params }: { params: RedirectParams }) {
  const { adoptSession } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("working");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // without a mail's link, only a recovery the callback just handled (a signed-in session alone is no proof)
    const fromLink = typeof params.token_hash === "string" || typeof params.code === "string";
    const allowed = fromLink || takeRecoveryMark();
    (allowed ? handleAuthRedirect(params) : Promise.reject(new Error("link invalid")))
      .then(() => setPhase("form"), () => setPhase("error"));
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (password !== confirm) { setError("Hai mật khẩu không khớp."); return; }
    setBusy(true);
    try {
      await setNewPassword(password);
      setPhase("done");
      try {
        const r = await gameSessionFromAuth();
        if (r) { await adoptSession(r); router.replace("/"); }
      } catch { /* the password is set; the player logs in from the home page */ }
    } catch (err) {
      setError(emailAuthErrorText((err as { message?: string })?.message ?? ""));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-center font-playfair text-2xl text-burgundy">Đặt lại mật khẩu</h1>
      {phase === "working" && <p className="text-center text-ink">Đang kiểm tra liên kết…</p>}
      {phase === "error" && (
        <div className="flex flex-col gap-3 text-center">
          <p role="alert" className="text-burgundy-accent">Liên kết không hợp lệ hoặc đã hết hạn.</p>
          <p className="text-sm text-ink/80">Hãy yêu cầu thư mới ở mục “Quên mật khẩu?” trên trang đăng nhập (và mở liên kết trong thư mới nhất).</p>
          <Link href="/" className="text-burgundy-accent underline">Về trang đăng nhập</Link>
        </div>
      )}
      {phase === "done" && (
        <div className="flex flex-col gap-3 text-center">
          <p role="status" className="text-ink">Đã đặt mật khẩu mới.</p>
          <Link href="/" className="text-burgundy-accent underline">Vào game</Link>
        </div>
      )}
      {phase === "form" && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder={`Mật khẩu mới (ít nhất ${MIN_PASSWORD} ký tự)`} className={input} />
          <input required type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} placeholder="Nhập lại mật khẩu mới" className={input} />
          {error && <p role="alert" className="text-sm text-burgundy-accent">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
            {busy ? "Đang xử lý…" : "Lưu mật khẩu mới"}
          </button>
        </form>
      )}
    </main>
  );
}
