import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  attachmentText, claimable, CODE_MAX_FAILS, CODE_WINDOW_MIN, deletable, expiresText, GIFT_ITEM_MAX_QTY, GIFT_MAX_ITEMS, GIFT_MAX_XU,
  MAIL_DAYS, mailErrorMessage, normalizeCode, parseAdminCodes, parseClaimAll, parseGiftItems, parseMail, parseMailBox, parseRedeem,
  parseSendResult, parseUsernames, redeemText, senderText, type Mail,
} from "@/lib/game/mail/model";
import { reasonGroup, reasonLabel } from "@/lib/admin-economy";

// 0111 re-creates four functions from their newest bodies (0106's): every added line is marked "-- 0111", an added
// block sits between "-- 0111 {" and "-- 0111 }", a changed line reads "… -- 0111 was: <old line>" (as in
// anticheat-v2-part3.test.ts).
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M = (n: string) => read(`supabase/migrations/${n}.sql`);
const MAIL = M("0111_mailbox");
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
const unmarked = (b: string, tag: string) => {
  const out: string[] = [];
  let skip = false;
  for (const l of b.split("\n")) {
    if (l.includes(`-- ${tag} {`)) { skip = true; continue; }
    if (l.includes(`-- ${tag} }`)) { skip = false; continue; }
    if (skip) continue;
    const was = l.indexOf(`-- ${tag} was: `);
    if (was >= 0) out.push(`${l.match(/^\s*/)![0]}${l.slice(was + `-- ${tag} was: `.length)}`);
    else if (!l.includes(`-- ${tag}`)) out.push(l);
  }
  return out.join("\n");
};
const between = (from: string, to: string) => readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f.slice(0, 4) > from.slice(0, 4) && f.slice(0, 4) < to.slice(0, 4))
  .map((f) => f.slice(0, -4));

describe("0111: the re-created functions are 0106's plus the marked lines", () => {
  for (const sig of ["trade_confirm(", "_econ_buy(", "_econ_settle(", "_econ_trade_left("]) {
    it(sig.slice(0, -1), () => {
      const name = sig.slice(0, -1);
      for (const f of between("0106", "0111")) expect(M(f).includes(`function public.${name}(`), `${name} in ${f}`).toBe(false);
      expect(unmarked(body(MAIL, sig), "0111")).toBe(body(M("0106_econ_p2p"), sig));
      expect(body(MAIL, sig)).toContain("-- 0111");
    });
  }
  it("delivers by mail: no direct move or credit left", () => {
    const confirm = body(MAIL, "trade_confirm(");
    expect(unmarked(confirm, "0111")).toContain("_econ_move(");
    const live = confirm.split("\n").map((l) => l.replace(/-- .*$/, "")).join("\n");
    expect(live).not.toContain("_econ_move(");
    expect(live).toContain("public._mail_take(v_mail_b, t.a,");
    expect(live).toContain("public._mail_xu(case when v_net > 0 then v_mail_a else v_mail_b end, v_got, 'trade')");
    for (const fn of ["_econ_buy(", "_econ_settle("]) {
      const b = body(MAIL, fn).split("\n").map((l) => l.replace(/-- .*$/, "")).join("\n");
      expect(b, fn).not.toContain("_econ_move(");
      expect(b, fn).toContain("public._mail_take(v_mail,");
    }
    expect(body(MAIL, "_econ_buy(")).toContain("case when p_shop then 'shop_sell' else 'market_sell' end);");
    expect(body(MAIL, "_econ_settle(")).toContain("v_share, 'auction_sell');");
    expect(body(MAIL, "_econ_trade_left(")).toContain("m.kind = 'trade'");
  });
});

describe("0111: guards, grants and the ledger", () => {
  const player = ["mail_list(", "mail_read(", "mail_claim(", "mail_claim_all(", "mail_delete(", "redeem_code("];
  const admin = ["admin_mail_send(", "admin_code_list(", "admin_code_create(", "admin_code_disable("];
  it("every player RPC starts with _ac_account, every admin RPC with _auth_root", () => {
    for (const fn of player) {
      const b = body(MAIL, fn);
      expect(b.slice(b.indexOf("declare"), b.indexOf("\n", b.indexOf("declare"))), fn).toContain("v_account uuid := public._ac_account(p_session_token)");
    }
    for (const fn of admin) expect(body(MAIL, fn), fn).toContain("public._auth_root(p_session_token)");
    for (const fn of [...player, ...admin]) expect(MAIL, fn).toMatch(new RegExp(`'${fn.slice(0, -1)}\\(`));
    expect(MAIL).toContain("execute format('revoke all on function public.%s from public', s);");
    expect(MAIL).toContain("execute format('grant execute on function public.%s to anon, authenticated', s);");
  });
  it("the helpers and tables are private", () => {
    const helpers = [...MAIL.matchAll(/create or replace function public\.(_[a-z_]+)\(/g)].map((m) => m[1]);
    expect(helpers.length).toBeGreaterThan(10);
    for (const h of helpers) expect(MAIL, h).toMatch(new RegExp(`revoke all on function public\\.${h}\\([^)]*\\) from public, anon, authenticated;`));
    for (const t of ["mail", "mail_items", "mail_fish", "mail_batches", "gift_codes", "gift_code_redemptions", "gift_code_attempts"]) {
      expect(MAIL, t).toContain(`alter table public.${t} enable row level security;`);
      expect(MAIL, t).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
  });
  it("the admin RPCs are on the guard allowlist", () => {
    const guards = read("tests/sql/anticheat-guards.sql");
    for (const s of ["'admin_mail_send(text,jsonb,text,text,integer,jsonb)'", "'admin_code_list(text)'",
      "'admin_code_create(text,text,text,integer,jsonb,integer,timestamp with time zone,timestamp with time zone)'",
      "'admin_code_disable(text,bigint)'"]) expect(guards).toContain(s);
    for (const fn of player) expect(guards).toContain(`public.${fn.slice(0, -1)}(%L`);
  });
  it("the ledger check is 0096's list plus admin_gift and gift_code, both faucets with a label", () => {
    const list = (s: string) => {
      const at = s.lastIndexOf("add constraint coin_ledger_reason_check");
      return [...s.slice(at, s.indexOf("));", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    const old = list(M("0096_forest_professions")), now = list(MAIL);
    expect(now).toEqual([...old, "admin_gift", "gift_code"]);
    for (const r of ["admin_gift", "gift_code"]) {
      expect(reasonGroup(r)).toBe("faucet");
      expect(reasonLabel(r)).not.toBe(r);
    }
    // never scaled by the bot score (0109's faucet list)
    expect(body(M("0109_bot_score"), "_ac_faucet_reasons(")).not.toMatch(/admin_gift|gift_code/);
  });
  it("the client's rules mirror the SQL", () => {
    expect(MAIL).toContain(`expires_at timestamptz not null default now() + interval '${MAIL_DAYS} days'`);
    expect(body(MAIL, "_code_rule(")).toContain(`when 'fails' then ${CODE_MAX_FAILS}`);
    expect(body(MAIL, "_code_rule(")).toContain(`when 'window_min' then ${CODE_WINDOW_MIN}`);
    expect(body(MAIL, "admin_mail_send(")).toContain(`p_xu > ${GIFT_MAX_XU}`);
    expect(body(MAIL, "_mail_gift_items(")).toContain(`jsonb_array_length(p_items) > ${GIFT_MAX_ITEMS}`);
    expect(body(MAIL, "_mail_gift_items(")).toContain(`v_qty > ${GIFT_ITEM_MAX_QTY}`);
    expect(body(MAIL, "_mail_claim_one(")).toContain(`+ i.qty > ${GIFT_ITEM_MAX_QTY}`);
    expect(body(MAIL, "redeem_code(")).toContain("'code_bruteforce', 'redeem_code'");
    expect(body(MAIL, "_mail_claim_one(")).toContain("deleted_at is null for update");
    expect(body(MAIL, "redeem_code(")).toContain("where lower(code) = lower(v_code) for update");
  });
});

const mail = (over: Partial<Mail> = {}): Mail => ({
  id: 1, kind: "trade", senderKind: "player", senderName: "An", title: "🤝 Giao dịch với An", body: "", xu: 950,
  items: [{ kind: "fish", ref: "f", qty: 1, name: "Cá rô 0.8 kg", value: 400, rarity: 1 }], read: false, claimed: false,
  createdMs: 0, expiresMs: 30 * 86_400_000, ...over,
});

describe("mail parsers", () => {
  it("parses the box and drops junk", () => {
    const b = parseMailBox({
      unread: 2, claimable: "1", server_now_ms: 5, coins: 100,
      mails: [
        { id: 3, kind: "admin", sender_kind: "admin", title: "Quà", body: "b", xu: 10, read: true, claimed: false, created_ms: 1, expires_ms: 9,
          items: [{ kind: "item", ref: "bait_worm", qty: 5, name: "Trùn đất" }, { kind: "bogus", ref: "x" }] },
        { id: 4, kind: "spam" }, "x", { kind: "trade" },
      ],
    });
    expect(b).not.toBeNull();
    expect(b!.unread).toBe(2);
    expect(b!.claimable).toBe(1);
    expect(b!.coins).toBe(100);
    expect(b!.mails).toHaveLength(1);
    expect(b!.mails[0]).toMatchObject({ id: 3, kind: "admin", senderKind: "admin", xu: 10, read: true, claimed: false });
    expect(b!.mails[0].items).toEqual([{ kind: "item", ref: "bait_worm", qty: 5, name: "Trùn đất", value: 0, rarity: null }]);
    expect(parseMailBox({ mails: [] })).toBeNull();
    expect(parseMailBox(null)).toBeNull();
    expect(parseMail({ id: 1, kind: "code", sender_kind: "weird" })!.senderKind).toBe("system");
  });
  it("parses claim all, redeem, the admin lists and a send", () => {
    expect(parseClaimAll({ claimed_all: { n: 2, xu: 300, failed: [{ id: 7, error: "bucket full" }, { error: "x" }] } }))
      .toEqual({ n: 2, xu: 300, failed: [{ id: 7, error: "bucket full" }] });
    expect(parseClaimAll({})).toBeNull();
    expect(parseRedeem({ ok: false, error: "invalid code", left: 3 })).toMatchObject({ ok: false, error: "invalid code", left: 3, box: null });
    const ok = parseRedeem({ ok: true, title: "🎁 Tết", mail_id: 9, unread: 1, claimable: 1, mails: [], server_now_ms: 1 });
    expect(ok!.ok).toBe(true);
    expect(ok!.box!.unread).toBe(1);
    expect(parseRedeem({ error: "x" })).toBeNull();
    const a = parseAdminCodes({
      codes: [{ id: 1, code: "TET", title: "Tết", xu: 5, items: [{ kind: "item", ref: "bait_worm", qty: 2 }, { kind: "fish", ref: "z" }],
        max_uses: 10, uses: 3, starts_at: "2026-01-01", expires_at: "2026-02-01", enabled: true, created_by: "root" }, { id: 2 }],
      gifts: [{ id: 4, title: "Khai trương", xu: 100, items: [], target: { usernames: ["an", 5] }, recipients: 1, claimed: 0, created_at: "x" }],
    });
    expect(a!.codes).toHaveLength(1);
    expect(a!.codes[0].items).toEqual([{ kind: "item", ref: "bait_worm", qty: 2 }]);
    expect(a!.gifts[0]).toMatchObject({ all: false, usernames: ["an"], recipients: 1 });
    expect(parseSendResult({ sent: 3, missing: ["x", 1] })).toEqual({ sent: 3, missing: ["x"] });
    expect(parseSendResult({})).toBeNull();
  });
});

describe("mail helpers and texts", () => {
  it("claim and delete rules", () => {
    expect(claimable(mail())).toBe(true);
    expect(deletable(mail())).toBe(false);
    expect(claimable(mail({ claimed: true }))).toBe(false);
    expect(deletable(mail({ claimed: true }))).toBe(true);
    expect(deletable(mail({ xu: 0, items: [] }))).toBe(true);
    expect(claimable(mail({ xu: 0, items: [] }))).toBe(false);
  });
  it("texts", () => {
    expect(attachmentText(mail({ xu: 1000, items: [{ kind: "item", ref: "b", qty: 5, name: "Trùn đất", value: 0, rarity: null }] })))
      .toBe(`${(1000).toLocaleString("vi-VN")} xu, Trùn đất ×5`);
    expect(senderText(mail())).toBe("An");
    expect(senderText(mail({ senderKind: "admin" }))).toBe("Ban quản trị");
    expect(senderText(mail({ senderKind: "system", kind: "market" }))).toBe("Chợ người chơi");
    expect(expiresText(3 * 86_400_000, 0)).toBe("còn 3 ngày");
    expect(expiresText(5 * 3_600_000, 0)).toBe("còn 5 giờ");
    expect(expiresText(10, 0)).toBe("sắp hết hạn");
    expect(mailErrorMessage("bucket full")).toContain("Giỏ cá đã đầy");
    expect(mailErrorMessage("already claimed")).toBe("Thư này đã nhận quà rồi.");
    expect(mailErrorMessage("?")).toBe("Có lỗi, thử lại sau nhé.");
    expect(redeemText({ ok: false, error: "invalid code", left: 2, retryS: null, title: null, box: null })).toBe("Code không đúng. Còn 2 lần thử.");
    expect(redeemText({ ok: false, error: "invalid code", left: 8, retryS: null, title: null, box: null })).toBe("Code không đúng.");
    expect(redeemText({ ok: false, error: "too many attempts", left: 0, retryS: 600, title: null, box: null })).toContain("(còn 10 phút)");
    expect(redeemText({ ok: true, error: null, left: null, retryS: null, title: "🎁 Tết", box: null })).toContain("🎁 Tết");
  });
  it("codes, names and items as the admin types them", () => {
    expect(normalizeCode(" tet-2026 ")).toBe("TET-2026");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("có dấu")).toBeNull();
    expect(parseUsernames("an, Bình ;an\nchi  ")).toEqual(["an", "Bình", "chi"]);
    expect(parseGiftItems("bait_worm x20, fert_urea×2; fashion:hat_red, oops!, seed_bap x100, fashion:x x2")).toEqual({
      items: [{ kind: "item", ref: "bait_worm", qty: 20 }, { kind: "item", ref: "fert_urea", qty: 2 }, { kind: "fashion", ref: "hat_red", qty: 1 }],
      bad: ["oops!", "seed_bap x100", "fashion:x x2"],
    });
    expect(parseGiftItems("")).toEqual({ items: [], bad: [] });
  });
});
