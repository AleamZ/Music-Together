"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchAuthState } from "@/lib/email-auth";

const dismissKey = (accountId: string) => `music-together:link-banner-off:${accountId}`;

function isDismissed(accountId: string): boolean {
  try { return localStorage.getItem(dismissKey(accountId)) === "1"; } catch { return false; }
}

/** A legacy account without an email is nudged to link one (it cannot recover its password otherwise). Dismissable,
 *  per account, in this browser. */
export default function LinkEmailBanner({ onLink }: { onLink: () => void }) {
  const { account, token } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    if (!account || !token || isDismissed(account.accountId)) return;
    (async () => {
      try {
        const s = await fetchAuthState(token);
        if (active && s && !s.linked) setShow(true);
      } catch { /* no banner */ }
    })();
    return () => { active = false; };
  }, [account, token]);

  if (!show || !account) return null;
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gold bg-cream px-3 py-2 text-sm text-ink">
      <span className="flex-1">📧 Tài khoản của bạn chưa có email. Liên kết email để lấy lại mật khẩu khi quên.</span>
      <button onClick={onLink} className="rounded-lg bg-burgundy px-3 py-1 font-cormorant font-bold text-cream">Liên kết ngay</button>
      <button aria-label="Ẩn thông báo" onClick={() => {
        try { localStorage.setItem(dismissKey(account.accountId), "1"); } catch { /* private mode */ }
        setShow(false);
      }} className="px-2 text-burgundy">✕</button>
    </div>
  );
}
