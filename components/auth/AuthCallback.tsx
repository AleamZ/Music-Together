"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { loginAccount, logoutAccount } from "@/lib/auth";
import { loadSession } from "@/lib/session";
import {
  clearPendingLink, createAccountForAuth, currentAuthUser, emailAuthErrorText, gameSessionFromAuth,
  handleAuthRedirect, linkWithGameToken, loadPendingLink, markRecovery, normEmail, type RedirectParams,
} from "@/lib/email-auth";

type Phase = { kind: "working" } | { kind: "error"; text: string } | { kind: "choose"; email: string } | { kind: "done"; text: string };

const input = "rounded-lg border border-gold bg-cream px-3 py-2 text-ink";
const primary = "rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60";
const errText = (e: unknown) => emailAuthErrorText((e as { message?: string })?.message ?? "");

/** /auth/callback: signs in from the mail's link, then
 *  - a "Liên kết email" started in THIS browser for the game account logged in here: links them (both proofs);
 *  - an email with a game account: its game session;
 *  - a confirmed email without one: the player picks the in-game name (sign-up's wish prefilled), or links an old
 *    account by logging into it (a link from another device or browser never links on its own). */
export default function AuthCallback({ params }: { params: RedirectParams }) {
  const { adoptSession } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const [username, setUsername] = useState("");
  const [legacyName, setLegacyName] = useState("");
  const [legacyPw, setLegacyPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;   // a code can be exchanged once (React's dev double effect)
    started.current = true;
    (async () => {
      try {
        const type = await handleAuthRedirect(params);
        if (type === "recovery") { markRecovery(); router.replace("/auth/reset"); return; }
        const user = await currentAuthUser();
        if (!user) throw new Error("link invalid");
        const pending = loadPendingLink();
        const game = loadSession();
        if (pending && game && pending.accountId === game.accountId && pending.email === normEmail(user.email)) {
          clearPendingLink();
          await linkWithGameToken(game.token);
        }
        const r = await gameSessionFromAuth();
        if (r) {
          await adoptSession(r);
          setPhase({ kind: "done", text: type === "email_change" ? "Đã xác nhận email mới." : "Xác nhận email thành công!" });
          router.replace("/");
          return;
        }
        setUsername(user.linkIntent ? "" : user.username ?? "");
        setPhase({ kind: "choose", email: user.email });
      } catch (e) {
        setPhase({ kind: "error", text: errText(e) });
      }
    })();
  }, [params, router, adoptSession]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      await adoptSession(await createAccountForAuth(username));
      router.replace("/");
    } catch (err) { setError(errText(err)); setBusy(false); }
  }

  async function linkOld(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const legacy = await loginAccount(legacyName.trim(), legacyPw);
      try { await linkWithGameToken(legacy.token); }
      finally { void logoutAccount(legacy.token).catch(() => {}); }   // only a proof: the email session is the one kept
      const r = await gameSessionFromAuth();
      if (!r) throw new Error("unknown");
      await adoptSession(r);
      router.replace("/");
    } catch (err) {
      const m = (err as { message?: string })?.message ?? "";
      setError(m.includes("invalid username or password") ? "Sai tên đăng nhập hoặc mật khẩu."
        : m.includes("email login required") ? "Tài khoản này đã liên kết với một email khác." : errText(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-center font-playfair text-2xl text-burgundy">Xác nhận email</h1>
      {phase.kind === "working" && <p className="text-center text-ink">Đang xác nhận…</p>}
      {phase.kind === "done" && <p role="status" className="text-center text-ink">{phase.text} Đang vào game…</p>}
      {phase.kind === "error" && (
        <div className="flex flex-col gap-3 text-center">
          <p role="alert" className="text-burgundy-accent">{phase.text}</p>
          <p className="text-sm text-ink/80">Nếu bạn vừa bấm liên kết xác nhận, email có thể đã được xác nhận — hãy thử đăng nhập bằng email.</p>
          <Link href="/" className="text-burgundy-accent underline">Về trang đăng nhập</Link>
        </div>
      )}
      {phase.kind === "choose" && (
        <>
          <p className="text-center text-sm text-ink">Email <b>{phase.email}</b> đã được xác nhận. Chọn cách vào game:</p>
          <form onSubmit={create} className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3">
            <h2 className="font-cormorant text-lg font-bold text-burgundy">Tạo nhân vật mới</h2>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên nhân vật (hiện trong game)" className={input} />
            <button type="submit" disabled={busy} className={primary}>{busy ? "Đang xử lý…" : "Tạo nhân vật"}</button>
          </form>
          <form onSubmit={linkOld} className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3">
            <h2 className="font-cormorant text-lg font-bold text-burgundy">Hoặc liên kết tài khoản cũ</h2>
            <input required value={legacyName} onChange={(e) => setLegacyName(e.target.value)} placeholder="Tên đăng nhập cũ" className={input} />
            <input required type="password" value={legacyPw} onChange={(e) => setLegacyPw(e.target.value)} placeholder="Mật khẩu cũ" className={input} />
            <button type="submit" disabled={busy} className={primary}>{busy ? "Đang xử lý…" : "Liên kết"}</button>
            <p className="text-xs text-ink/70">Sau khi liên kết, tài khoản cũ chỉ đăng nhập bằng email này.</p>
          </form>
          {error && <p role="alert" className="text-sm text-burgundy-accent">{error}</p>}
        </>
      )}
    </main>
  );
}
