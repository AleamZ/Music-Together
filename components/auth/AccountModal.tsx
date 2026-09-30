"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  changeEmail, changeEmailPassword, changeLegacyPassword, emailAuthErrorText, fetchAuthState, linkEmailStart,
  MIN_PASSWORD, type AuthState,
} from "@/lib/email-auth";

const input = "rounded-lg border border-gold bg-cream px-3 py-2 text-ink";
const primary = "rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream disabled:opacity-60";
const box = "flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3";
const errText = (e: unknown) => emailAuthErrorText((e as { message?: string })?.message ?? "");

export const LINK_SENT = "Đã gửi thư xác nhận (nếu email hợp lệ). Mở thư trên trình duyệt này và bấm liên kết để hoàn tất liên kết.";

type Msg = { ok: boolean; text: string } | null;
function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink" : "text-burgundy-accent"}`}>{msg.text}</p>;
}

/** "Tài khoản": an email account changes its password / email through Supabase Auth; a legacy account links an email
 *  ("Liên kết email") and changes its game password (change_password). */
export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { account, token } = useAuth();
  const [state, setState] = useState<AuthState | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: "", pw: "", pw2: "", cur: "", next: "", next2: "", newEmail: "" });
  const [linkMsg, setLinkMsg] = useState<Msg>(null);
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [emailMsg, setEmailMsg] = useState<Msg>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  useEffect(() => {
    let active = true;
    if (token) fetchAuthState(token).then((s) => { if (active) setState(s); }, () => { if (active) setState(null); });
    return () => { active = false; };
  }, [token]);

  async function run(fn: () => Promise<void>, show: (m: Msg) => void, okText: string) {
    show(null); setBusy(true);
    try { await fn(); show({ ok: true, text: okText }); }
    catch (err) { show({ ok: false, text: errText(err) }); }
    setBusy(false);
  }

  function link(e: React.FormEvent) {
    e.preventDefault();
    if (f.pw !== f.pw2) { setLinkMsg({ ok: false, text: "Hai mật khẩu không khớp." }); return; }
    void run(() => linkEmailStart(account!.accountId, f.email, f.pw), setLinkMsg, LINK_SENT);
  }
  function changePw(e: React.FormEvent) {
    e.preventDefault();
    if (f.next !== f.next2) { setPwMsg({ ok: false, text: "Hai mật khẩu mới không khớp." }); return; }
    const fn = state?.linked ? () => changeEmailPassword(state.email ?? "", f.cur, f.next) : () => changeLegacyPassword(token!, f.cur, f.next);
    void run(async () => { await fn(); setF((v) => ({ ...v, cur: "", next: "", next2: "" })); }, setPwMsg, "Đã đổi mật khẩu.");
  }
  function changeMail(e: React.FormEvent) {
    e.preventDefault();
    void run(() => changeEmail(state?.email ?? "", f.newEmail), setEmailMsg, "Đã gửi thư xác nhận tới email mới (và có thể cả email cũ). Email chỉ đổi sau khi bạn xác nhận.");
  }

  const canChangePw = state && (state.linked || state.legacyPassword);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Tài khoản" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">👤 Tài khoản — {account?.username}</h3>
        {state === undefined ? <p className="text-ink/70">Đang tải…</p>
          : state === null ? <p className="text-burgundy-accent">Không tải được thông tin tài khoản.</p>
          : (
            <div className="flex flex-col gap-3">
              {state.linked ? (
                <p className="text-sm text-ink">📧 Email: <b>{state.email}</b></p>
              ) : (
                <form onSubmit={link} className={box}>
                  <h4 className="font-cormorant text-lg font-bold text-burgundy">Liên kết email</h4>
                  <p className="text-xs text-ink/80">Để lấy lại mật khẩu khi quên. Sau khi liên kết, bạn đăng nhập bằng email và mật khẩu này (không dùng tên đăng nhập cũ nữa).</p>
                  <input required type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="Email" className={input} />
                  <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={f.pw} onChange={set("pw")} placeholder={`Mật khẩu cho email (ít nhất ${MIN_PASSWORD} ký tự)`} className={input} />
                  <input required type="password" autoComplete="new-password" value={f.pw2} onChange={set("pw2")} placeholder="Nhập lại mật khẩu" className={input} />
                  <Note msg={linkMsg} />
                  <button type="submit" disabled={busy} className={primary}>Gửi thư xác nhận</button>
                </form>
              )}

              {canChangePw && (
                <form onSubmit={changePw} className={box}>
                  <h4 className="font-cormorant text-lg font-bold text-burgundy">Đổi mật khẩu</h4>
                  <input required type="password" autoComplete="current-password" value={f.cur} onChange={set("cur")} placeholder="Mật khẩu hiện tại" className={input} />
                  <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={f.next} onChange={set("next")} placeholder={`Mật khẩu mới (ít nhất ${MIN_PASSWORD} ký tự)`} className={input} />
                  <input required type="password" autoComplete="new-password" value={f.next2} onChange={set("next2")} placeholder="Nhập lại mật khẩu mới" className={input} />
                  <Note msg={pwMsg} />
                  <button type="submit" disabled={busy} className={primary}>Đổi mật khẩu</button>
                </form>
              )}

              {state.linked && (
                <form onSubmit={changeMail} className={box}>
                  <h4 className="font-cormorant text-lg font-bold text-burgundy">Đổi email</h4>
                  <input required type="email" autoComplete="email" value={f.newEmail} onChange={set("newEmail")} placeholder="Email mới" className={input} />
                  <Note msg={emailMsg} />
                  <button type="submit" disabled={busy} className={primary}>Gửi thư xác nhận</button>
                </form>
              )}
            </div>
          )}
        <button onClick={onClose} className="mt-3 w-full rounded-lg border border-gold py-2 text-burgundy">Đóng</button>
      </div>
    </div>
  );
}
