"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GIFT_MAX_ITEMS, GIFT_MAX_XU, mailErrText, normalizeCode, parseGiftItems, parseUsernames,
  type AdminCodes, type GiftItemInput,
} from "@/lib/game/mail/model";
import { adminCodeCreate, adminCodeDisable, adminCodeList, adminMailSend } from "@/lib/game/mail/rpc";

const ITEMS_HELP = "Món: mã vật phẩm, cách nhau bởi dấu phẩy, số lượng sau x (vd: bait_worm x20, fert_urea x5, fashion:hat_red). "
  + `Tối đa ${GIFT_MAX_ITEMS} món; mồi, hạt giống, phân, thuốc, đạn, thức ăn thú 1–99; đồ thời trang 1.`;
const time = (x: string): string => (x ? new Date(x).toLocaleString("vi-VN") : "—");
const itemsText = (items: GiftItemInput[]): string =>
  items.map((i) => (i.kind === "fashion" ? `fashion:${i.ref}` : `${i.ref}${i.qty > 1 ? ` x${i.qty}` : ""}`)).join(", ");
/** A datetime-local value ("2026-10-01T08:00") as an ISO instant in the browser's zone; null when empty or invalid. */
export const localToIso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Quà & code (0111): root sends a gift into the mailbox of everyone or of listed players (each one mail; xu are paid
 *  when claimed, ledger 'admin_gift' — a faucet), and manages the gift codes players type in the mailbox. */
export default function MailTab({ token }: { token: string }) {
  const [data, setData] = useState<AdminCodes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // the gift
  const [toAll, setToAll] = useState(false);
  const [names, setNames] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [xu, setXu] = useState("0");
  const [items, setItems] = useState("");
  // the code
  const [code, setCode] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cXu, setCXu] = useState("0");
  const [cItems, setCItems] = useState("");
  const [cUses, setCUses] = useState("100");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");

  const refresh = useCallback(() => { adminCodeList(token).then(setData, (e) => setError(mailErrText(e))); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

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

  const gift = parseGiftItems(items);
  const giftXu = Math.floor(Number(xu) || 0);
  const users = parseUsernames(names);
  const send = () => run(async () => {
    if (gift.bad.length > 0) throw new Error("bad items");
    if (!toAll && users.length === 0) throw new Error("bad target");
    if (toAll && !confirm(`Gửi "${title}" (${giftXu.toLocaleString("vi-VN")} xu, ${gift.items.length} món) cho TẤT CẢ người chơi?`)) return;
    const r = await adminMailSend(token, toAll ? { all: true } : { usernames: users }, title, body, giftXu, gift.items);
    setNotice(`Đã gửi ${r.sent} thư.${r.missing.length > 0 ? ` Không tìm thấy: ${r.missing.join(", ")}.` : ""}`);
    setTitle(""); setBody(""); setXu("0"); setItems("");
    refresh();
  });

  const codeGift = parseGiftItems(cItems);
  const create = () => run(async () => {
    const c = normalizeCode(code);
    if (!c) throw new Error("bad code");
    if (codeGift.bad.length > 0) throw new Error("bad items");
    const end = localToIso(cEnd);
    if (!end) throw new Error("bad dates");
    setData(await adminCodeCreate(token, {
      code: c, title: cTitle, xu: Math.floor(Number(cXu) || 0), items: codeGift.items, maxUses: Math.floor(Number(cUses) || 0),
      startsAt: localToIso(cStart), expiresAt: end,
    }));
    setNotice(`Đã tạo code ${c}.`);
    setCode(""); setCTitle(""); setCXu("0"); setCItems("");
  });

  const input = "rounded border border-gold-200 px-2";
  return (
    <div className="flex flex-col gap-4" data-testid="admin-mail">
      {error && <p className="text-sm text-burgundy-accent" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-800" role="status">{notice}</p>}

      <form className="flex flex-col gap-2 rounded-xl border border-gold bg-cream p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <p className="font-playfair text-lg font-bold text-burgundy">🎁 Gửi quà vào hòm thư</p>
        <div className="flex flex-wrap gap-3 text-sm text-burgundy">
          <label className="flex items-center gap-1"><input type="radio" name="gift-to" checked={!toAll} onChange={() => setToAll(false)} /> Theo tên</label>
          <label className="flex items-center gap-1"><input type="radio" name="gift-to" checked={toAll} onChange={() => setToAll(true)} /> Tất cả người chơi</label>
        </div>
        {!toAll && (
          <textarea aria-label="Tên người nhận" rows={2} value={names} placeholder="tên1, tên2 (tối đa 500)"
            onChange={(e) => setNames(e.target.value)} className={`${input} font-mono text-sm`} />
        )}
        <input aria-label="Tiêu đề thư" placeholder="Tiêu đề" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} />
        <textarea aria-label="Nội dung thư" rows={3} placeholder="Nội dung" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} className={input} />
        <label className="flex items-center gap-2 text-sm text-burgundy">
          Xu <input aria-label="Xu quà" type="number" min={0} max={GIFT_MAX_XU} value={xu} onChange={(e) => setXu(e.target.value)} className={`${input} w-32`} />
        </label>
        <input aria-label="Món quà" placeholder="bait_worm x20, fashion:hat_red" value={items} onChange={(e) => setItems(e.target.value)} className={`${input} font-mono text-sm`} />
        <p className="text-xs text-ink/70">{ITEMS_HELP}</p>
        {gift.bad.length > 0 && <p className="text-xs text-burgundy-accent">Không hiểu: {gift.bad.join(", ")}</p>}
        <p className="text-xs text-ink/70">Xu chỉ vào ví khi người chơi bấm nhận (sổ xu ghi &quot;admin_gift&quot; — nguồn xu mới). Thư giữ 30 ngày.</p>
        <div>
          <button type="submit" disabled={busy || title.trim() === ""} className="rounded bg-burgundy px-3 py-0.5 text-cream disabled:opacity-50">
            {toAll ? "Gửi cho tất cả" : `Gửi cho ${users.length} người`}
          </button>
        </div>
      </form>

      <form className="flex flex-col gap-2 rounded-xl border border-gold bg-cream p-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <p className="font-playfair text-lg font-bold text-burgundy">🎟️ Tạo code quà</p>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Code" placeholder="CODE (3–32 ký tự A–Z 0–9 _ -)" value={code} maxLength={32}
            onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${input} font-mono`} />
          <input aria-label="Tiêu đề code" placeholder="Tên quà" value={cTitle} maxLength={120} onChange={(e) => setCTitle(e.target.value)} className={`${input} flex-1`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-burgundy">
          <label className="flex items-center gap-1">Xu <input aria-label="Xu code" type="number" min={0} max={GIFT_MAX_XU} value={cXu} onChange={(e) => setCXu(e.target.value)} className={`${input} w-28`} /></label>
          <label className="flex items-center gap-1">Lượt <input aria-label="Số lượt" type="number" min={1} value={cUses} onChange={(e) => setCUses(e.target.value)} className={`${input} w-24`} /></label>
          <label className="flex items-center gap-1">Từ <input aria-label="Bắt đầu" type="datetime-local" value={cStart} onChange={(e) => setCStart(e.target.value)} className={input} /></label>
          <label className="flex items-center gap-1">Đến <input aria-label="Hết hạn" type="datetime-local" value={cEnd} onChange={(e) => setCEnd(e.target.value)} className={input} /></label>
        </div>
        <input aria-label="Món code" placeholder="seed_bap x3, fert_npk x2" value={cItems} onChange={(e) => setCItems(e.target.value)} className={`${input} font-mono text-sm`} />
        {codeGift.bad.length > 0 && <p className="text-xs text-burgundy-accent">Không hiểu: {codeGift.bad.join(", ")}</p>}
        <p className="text-xs text-ink/70">Mỗi tài khoản nhập một lần; quà vào hòm thư (sổ xu &quot;gift_code&quot;). Nên dùng code dài, khó đoán: người chơi sai 10 lần/giờ bị chặn.</p>
        <div>
          <button type="submit" disabled={busy || code.trim() === "" || cTitle.trim() === "" || cEnd === ""} className="rounded bg-burgundy px-3 py-0.5 text-cream disabled:opacity-50">Tạo code</button>
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <p className="font-playfair text-lg font-bold text-burgundy">Code đã tạo</p>
        {data && data.codes.length === 0 && <p className="text-ink/60">Chưa có code nào.</p>}
        {data?.codes.map((c) => (
          <div key={c.id} className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm ${c.enabled ? "border-gold-200 bg-cream" : "border-ink/20 bg-cream/40 opacity-70"}`} data-testid={`code-${c.code}`}>
            <span className="font-mono font-bold text-burgundy">{c.code}</span>
            <span className="flex-1">{c.title} · {c.xu.toLocaleString("vi-VN")} xu{c.items.length > 0 ? ` · ${itemsText(c.items)}` : ""}</span>
            <span>{c.uses}/{c.maxUses} lượt</span>
            <span className="text-xs text-ink/70">{time(c.startsAt)} → {time(c.expiresAt)}</span>
            {c.enabled
              ? <button type="button" disabled={busy} onClick={() => { if (confirm(`Tắt code ${c.code}?`)) void run(async () => { setData(await adminCodeDisable(token, c.id)); }); }}
                  className="rounded border border-gold-200 px-2 text-burgundy-accent">Tắt</button>
              : <span className="text-xs">đã tắt</span>}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-playfair text-lg font-bold text-burgundy">Quà đã gửi (30 lần gần nhất)</p>
        {data && data.gifts.length === 0 && <p className="text-ink/60">Chưa gửi quà nào.</p>}
        {data?.gifts.map((g) => (
          <div key={g.id} className="rounded-xl border border-gold-200 bg-cream p-2 text-sm">
            <span className="font-bold text-burgundy">{g.title}</span> · {g.xu.toLocaleString("vi-VN")} xu{g.items.length > 0 ? ` · ${itemsText(g.items)}` : ""}
            {" · "}{g.all ? "tất cả" : g.usernames.join(", ")} · {g.claimed}/{g.recipients} đã nhận · {time(g.createdAt)}{g.sentBy ? ` · ${g.sentBy}` : ""}
          </div>
        ))}
      </section>
    </div>
  );
}
