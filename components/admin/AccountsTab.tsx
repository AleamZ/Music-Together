"use client";

import { useCallback, useEffect, useState } from "react";
import { adminListAccounts, adminSetBan, adminDeleteAccount, type AdminAccount } from "@/lib/admin";
import { useAuth } from "@/hooks/useAuth";

export default function AccountsTab({ token }: { token: string }) {
  const { account } = useAuth();
  const [accs, setAccs] = useState<AdminAccount[]>([]);
  const refresh = useCallback(() => { adminListAccounts(token).then(setAccs).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="flex flex-col gap-2">
      {accs.map((a) => {
        const self = a.id === account?.accountId;
        return (
          <div key={a.id} className="flex items-center justify-between rounded-xl border border-gold-200 bg-cream p-3 text-sm">
            <span className="text-ink">
              <b className="text-burgundy">{a.username}</b>{a.is_root ? " 👑" : ""}{a.is_banned ? " 🚫" : ""} · {new Date(a.created_at).toLocaleDateString("vi-VN")}
            </span>
            {!self && (
              <span className="flex gap-1">
                <button onClick={async () => { await adminSetBan(token, a.id, !a.is_banned); refresh(); }}
                  className="rounded border border-gold-200 px-2 text-burgundy">{a.is_banned ? "Mở khóa" : "Khóa"}</button>
                <button onClick={async () => { if (confirm(`Xóa tài khoản ${a.username}?`)) { await adminDeleteAccount(token, a.id); refresh(); } }}
                  className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
