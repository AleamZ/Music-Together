"use client";

import { useEffect, useState } from "react";
import {
  attachmentText, claimable, deletable, expiresText, itemIcon, MAIL_DAYS, mailErrText, normalizeCode, redeemText, senderText,
  type Mail, type MailBox,
} from "@/lib/game/mail/model";
import { mailClaim, mailClaimAll, mailDelete, mailList, mailRead, redeemCode } from "@/lib/game/mail/rpc";
import { ParchmentModal } from "../Parchment";

const KIND_ICON: Record<Mail["kind"], string> = { trade: "🤝", gift: "🎁", admin: "📣", code: "🎟️", market: "🏪", return: "↩️" };

/** 📬 Hòm thư (0111): trades, market purchases and sales, admin gifts and gift codes arrive here; "Nhận" moves the
 *  xu and the things into the wallet and the bag (the server checks the room first), "Nhận tất cả" claims every mail it
 *  can. The code box turns a gift code into a mail. */
export default function MailboxModal({ token, box, onBox, onChanged, onClose }: {
  token: string;
  box: MailBox | null;
  onBox: (b: MailBox) => void;
  /** Something was claimed: the shell reloads the wallet and the bag. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    mailList(token).then((b) => { if (live) onBox(b); }, () => {});
    return () => { live = false; };
  }, [token, onBox]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(mailErrText(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (m: Mail) => {
    setOpenId(openId === m.id ? null : m.id);
    setError(null);
    if (!m.read) void mailRead(token, m.id).then(onBox, () => {});
  };
  const claim = (m: Mail) => run(async () => {
    onBox(await mailClaim(token, m.id));
    setNotice(`Đã nhận: ${attachmentText(m)}.`);
    onChanged();
  });
  const claimAll = () => run(async () => {
    const r = await mailClaimAll(token);
    onBox(r.box);
    if (r.all.n > 0) onChanged();
    const parts = [r.all.n > 0 ? `Đã nhận ${r.all.n} thư${r.all.xu > 0 ? ` (${r.all.xu.toLocaleString("vi-VN")} xu)` : ""}.` : "Không có thư nào nhận được."];
    if (r.all.failed.length > 0) parts.push(`${r.all.failed.length} thư chưa nhận được: ${mailErrText({ message: r.all.failed[0].error })}`);
    setNotice(parts.join(" "));
  });
  const remove = (m: Mail) => run(async () => {
    onBox(await mailDelete(token, m.id));
    setOpenId(null);
  });
  const redeem = () => {
    const c = normalizeCode(code);
    if (!c) { setCodeMsg("Code gồm 3–32 ký tự chữ, số, _ hoặc -."); return; }
    void run(async () => {
      const r = await redeemCode(token, c);
      setCodeMsg(redeemText(r));
      if (r.ok) {
        setCode("");
        if (r.box) onBox(r.box);
      }
    });
  };

  const mails = box?.mails ?? [];
  const now = box?.serverNowMs ?? 0;

  return (
    <ParchmentModal title="📬 Hòm thư" onClose={onClose} className="sm:max-w-xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight" data-testid="mailbox">
        <p className="text-base">
          Đồ và xu từ giao dịch, chợ, đấu giá và quà tặng đều gửi về đây. Thư giữ {MAIL_DAYS} ngày: thư giao dịch không nhận sẽ
          trả lại người gửi, các thư khác bị huỷ.
        </p>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); redeem(); }}>
          <label htmlFor="mail-code" className="text-base">🎟️ Nhập code:</label>
          <input id="mail-code" aria-label="Nhập code" value={code} maxLength={32} autoComplete="off" spellCheck={false}
            onChange={(e) => { setCode(e.target.value); setCodeMsg(null); }}
            className="min-w-0 flex-1 rounded border border-gold-300 bg-cream px-1 uppercase" placeholder="VD: TETVUIVE" />
          <button type="submit" className="pch-btn" disabled={busy || code.trim() === ""}>Đổi quà</button>
        </form>
        {codeMsg && <p className="text-base" role="status" data-testid="code-msg">{codeMsg}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base">{box ? `${box.unread} thư chưa đọc · ${box.claimable} thư có quà` : "Đang mở hòm thư…"}</span>
          <button type="button" className="pch-btn pch-btn-primary ml-auto" disabled={busy || (box?.claimable ?? 0) === 0} onClick={() => void claimAll()}>
            Nhận tất cả
          </button>
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {notice && <p className="text-emerald-800">{notice}</p>}
        {box && mails.length === 0 && <p>Hòm thư trống.</p>}
        <ul className="flex flex-col gap-1.5">
          {mails.map((m) => (
            <li key={m.id} className={`rounded-sm border-2 p-2 ${m.read ? "border-gold-200 bg-cream/60" : "border-burgundy bg-cream"}`} data-testid={`mail-${m.id}`}>
              <button type="button" className="flex w-full items-start gap-2 text-left" aria-expanded={openId === m.id} onClick={() => open(m)}>
                <span aria-hidden="true">{KIND_ICON[m.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${m.read ? "" : "font-bold text-burgundy"}`}>{m.title}</span>
                  <span className="block text-sm opacity-80">
                    {senderText(m)} · {m.claimed ? "đã nhận" : claimable(m) ? `🎁 ${attachmentText(m)}` : "thư"} · {expiresText(m.expiresMs, now)}
                  </span>
                </span>
                {!m.read && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="chưa đọc" />}
              </button>
              {openId === m.id && (
                <div className="mt-2 flex flex-col gap-2 border-t border-dashed border-ink/30 pt-2 text-base">
                  {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                  {(m.xu > 0 || m.items.length > 0) && (
                    <ul className="flex flex-col gap-0.5">
                      {m.xu > 0 && <li>💰 {m.xu.toLocaleString("vi-VN")} xu</li>}
                      {m.items.map((i) => <li key={`${i.kind}:${i.ref}`}>{itemIcon(i.kind)} {i.name}{i.kind === "item" && i.qty > 1 ? ` ×${i.qty}` : ""}</li>)}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {claimable(m) && <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void claim(m)}>Nhận</button>}
                    {deletable(m) && <button type="button" className="pch-btn" disabled={busy} onClick={() => void remove(m)}>Xoá thư</button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </ParchmentModal>
  );
}
