// Hòm thư and gift codes (0111). The player's calls go through the anti-cheat screen like every game RPC (a lock is
// reported); the admin's are root-only on the server.

import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import {
  parseAdminCodes, parseClaimAll, parseMailBox, parseRedeem, parseSendResult,
  type AdminCodes, type ClaimAll, type GiftItemInput, type MailBox, type RedeemResult, type SendResult,
} from "./model";

async function call<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  const ac = screenAnswer(data, error);
  if (error) throw error;
  if (ac) throw new AnticheatError(ac);
  const out = parse(data);
  if (out === null) throw new Error("bad answer");
  return out;
}

const T = (token: string) => ({ p_session_token: token });
const box = (fn: string, args: Record<string, unknown>) => call<MailBox>(fn, args, parseMailBox);

export const mailList = (token: string) => box("mail_list", T(token));
export const mailRead = (token: string, id: number) => box("mail_read", { ...T(token), p_id: id });
export const mailClaim = (token: string, id: number) => box("mail_claim", { ...T(token), p_id: id });
export const mailClaimAll = (token: string) =>
  call<{ box: MailBox; all: ClaimAll }>("mail_claim_all", T(token), (d) => {
    const b = parseMailBox(d), all = parseClaimAll(d);
    return b && all ? { box: b, all } : null;
  });
export const mailDelete = (token: string, id: number) => box("mail_delete", { ...T(token), p_id: id });
export const redeemCode = (token: string, code: string) =>
  call<RedeemResult>("redeem_code", { ...T(token), p_code: code }, parseRedeem);

// ---------------------------------------------------------------- admin (root)

export const adminMailSend = (token: string, target: { all: true } | { usernames: string[] }, title: string, body: string,
  xu: number, items: GiftItemInput[]) =>
  call<SendResult>("admin_mail_send", { ...T(token), p_target: target, p_title: title, p_body: body, p_xu: xu, p_items: items }, parseSendResult);
export const adminCodeList = (token: string) => call<AdminCodes>("admin_code_list", T(token), parseAdminCodes);
export const adminCodeCreate = (token: string, c: { code: string; title: string; xu: number; items: GiftItemInput[]; maxUses: number;
  startsAt: string | null; expiresAt: string }) =>
  call<AdminCodes>("admin_code_create", {
    ...T(token), p_code: c.code, p_title: c.title, p_xu: c.xu, p_items: c.items, p_max_uses: c.maxUses,
    p_starts_at: c.startsAt, p_expires_at: c.expiresAt,
  }, parseAdminCodes);
export const adminCodeDisable = (token: string, id: number) => call<AdminCodes>("admin_code_disable", { ...T(token), p_id: id }, parseAdminCodes);
