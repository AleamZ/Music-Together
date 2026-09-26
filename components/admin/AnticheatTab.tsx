"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminAnticheatAccount, adminAnticheatList, adminAnticheatResolve, adminAnticheatSetMode,
  type AnticheatAccount, type AnticheatCase, type AnticheatHoldings, type AnticheatList, type AnticheatMode, type AnticheatWipe,
} from "@/lib/admin";
import { formatXu } from "@/lib/game/fishing/catalog";

// /admin "Chống gian lận" (anti-cheat spec §12.5): the mode, the cases, their evidence, the wipe and the pardon.

const MODE_LABEL: Record<AnticheatMode, string> = { log: "Chỉ ghi nhận", enforce: "Thi hành" };
const MODE_CONFIRM: Record<AnticheatMode, string> = {
  enforce: "Bật chế độ Thi hành? Từ giờ vi phạm lần 1 bị khoá trò chơi 5 phút, lần 2 bị cấm tài khoản.",
  log: "Chuyển về Chỉ ghi nhận? Các lượt khoá 5 phút đang chạy sẽ được gỡ; tài khoản đã bị cấm vẫn bị cấm.",
};
const MODE_HELP = "Chỉ ghi nhận: lưu vi phạm, không khoá ai. Thi hành: vi phạm lần 1 khoá trò chơi 5 phút, lần 2 cấm tài khoản; dữ liệu chỉ bị xoá khi bạn xác nhận.";
const FOOTNOTE = "Ghi nhận mềm, ghi nhận lúc chỉ ghi nhận, của root hoặc lúc đang khoá được giữ 90 ngày; vi phạm và dữ liệu đã xoá được giữ lâu dài.";

const CODE_LABEL: Record<string, string> = {
  reel_too_fast: "Kéo cá quá nhanh",
  quality_range: "Điểm cấy/gặt sai",
  bad_plot: "Số thửa sai",
  bad_slot: "Số ô phơi sai",
  bad_water: "Mức bơm/tháo nước sai",
  bad_work: "Việc đồng sai",
  bad_qty: "Số lượng sai",
  bad_price: "Giá đất sai",
  foreign_offer: "Đụng đề nghị của người khác",
  kind_mismatch: "Sai loại vật phẩm",
  reel_gate_hug: "Kéo cá sát ngưỡng (20 lần/ngày)",
  cast_daily_cap: "Chạm 300 lần câu/ngày",
};
const OUTCOME_LABEL: Record<string, string> = {
  soft: "Tín hiệu mềm",
  log_only: "Chỉ ghi nhận",
  root: "Root — miễn",
  in_lock: "Khi đang khoá/cấm",
  strike_1: "Vi phạm 1 → khoá 5 phút",
  strike_2: "Vi phạm 2 → cấm",
};

const time = (x: string | null): string => (x ? new Date(x).toLocaleString("vi-VN") : "—");
const count = (n: number): string => n.toLocaleString("vi-VN");

function statusText(c: AnticheatCase): string {
  if (c.ban_state === "pending_wipe") return "🚫 Đã cấm — chờ xoá dữ liệu";
  if (c.ban_state === "wiped") return "🚫 Đã cấm — đã xoá dữ liệu";
  // a ban root set by hand in the Accounts tab: a pardon here does not lift it
  if (c.is_banned) return "Khoá tay";
  if (c.locked_until) return `🔒 Đang khoá đến ${time(c.locked_until)}`;
  if (c.active_strikes === 1) return "⚠️ Cảnh cáo (1/2)";
  if (c.pardoned_at) return "🕊️ Đã ân xá";
  return "Chỉ có ghi nhận";
}

/** What a wipe would remove now; items count every piece. */
function holdingsLine(h: AnticheatHoldings): string {
  const items = h.inventory.reduce((a, i) => a + i.qty, 0);
  const kg = h.rice.reduce((a, r) => a + r.wet_kg + r.dry_kg, 0);
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  return [
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(h.plots.length)} thửa sở hữu`, `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
  ].join(" · ");
}

function errorText(err: unknown): string {
  const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
  if (msg === "not pending") return "Tài khoản này không còn chờ xoá dữ liệu.";
  if (msg === "nothing to pardon") return "Tài khoản này không có gì để ân xá.";
  return "Có lỗi, thử lại nhé.";
}
/** The action went through, but the list or the evidence could not be fetched again after it. */
const RELOAD_FAILED = "Đã xong — tải lại danh sách không được, thử lại.";

const BUTTON = "rounded border border-gold-200 px-2 py-0.5 text-burgundy disabled:opacity-50";

export default function AnticheatTab({ token }: { token: string }) {
  const [list, setList] = useState<AnticheatList | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [account, setAccount] = useState<AnticheatAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the account whose evidence is open, for answers that arrive after another one was opened
  const openRef = useRef<string | null>(null);

  const loadList = useCallback(() => adminAnticheatList(token).then(setList), [token]);
  const loadAccount = useCallback((id: string) => adminAnticheatAccount(token, id).then((a) => {
    if (openRef.current === id) setAccount(a);
  }), [token]);
  useEffect(() => {
    void loadList().catch((e: unknown) => setError(errorText(e)));
  }, [loadList]);

  /** An admin action, then the list and the open evidence again. When only that reload fails, the action went through
   *  and the message says so; after a refused action, its reason stays. */
  const act = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    let done = false;
    try {
      await job();
      done = true;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
    try {
      await loadList();
      const id = openRef.current;
      if (id) await loadAccount(id);
    } catch {
      if (done) setError(RELOAD_FAILED);
    }
  };

  const setMode = (mode: AnticheatMode) => {
    if (!list || list.mode === mode || !window.confirm(MODE_CONFIRM[mode])) return;
    void act(() => adminAnticheatSetMode(token, mode));
  };
  const wipe = (c: AnticheatCase) => {
    const text = `Xoá toàn bộ dữ liệu trò chơi của ${c.username}? Xu, đồ, cá, kỷ lục và lúa bị xoá ngay; đất được trả về làng ở lần mở ruộng kế tiếp. Không hoàn tác được.`;
    if (window.confirm(text)) void act(() => adminAnticheatResolve(token, c.account_id, "wipe"));
  };
  const pardon = (c: AnticheatCase) => {
    const text = c.is_banned && c.ban_state === null
      ? `Ân xá ${c.username}? Vi phạm được xoá, nhưng tài khoản vẫn bị khoá tay.`
      : `Ân xá ${c.username}? Tài khoản được mở khoá và xoá vi phạm.${c.wiped_at ? " Dữ liệu đã xoá không được khôi phục." : ""}`;
    if (window.confirm(text)) void act(() => adminAnticheatResolve(token, c.account_id, "pardon"));
  };
  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    openRef.current = next;
    setOpenId(next);
    setAccount(null);
    if (next) void loadAccount(next).catch((e: unknown) => setError(errorText(e)));
  };

  return (
    <section className="flex flex-col gap-3 text-sm text-ink">
      <h2 className="font-playfair text-xl font-bold text-burgundy">🛡️ Chống gian lận</h2>
      {error && <p role="alert" className="text-burgundy-accent">{error}</p>}
      {!list ? <p>Đang tải…</p> : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream p-3">
            <p>{`Chế độ: ${MODE_LABEL[list.mode]}${list.mode_changed_at ? ` · từ ${time(list.mode_changed_at)}` : ""}`}</p>
            <div className="flex gap-1">
              {(["log", "enforce"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={list.mode === m} disabled={busy} onClick={() => setMode(m)}
                  className={`${BUTTON} ${list.mode === m ? "bg-burgundy text-cream" : ""}`}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="text-xs opacity-80">{MODE_HELP}</p>
          </div>
          {list.cases.length === 0 ? <p>Chưa có ghi nhận nào.</p> : (
            <ul className="flex flex-col gap-2">
              {list.cases.map((c) => (
                <li key={c.account_id} className="rounded-xl border border-gold-200 bg-cream p-3">
                  <p><b className="text-burgundy">{`${c.username}${c.is_root ? " 👑" : ""}`}</b> · <span>{statusText(c)}</span></p>
                  <p>{`Vi phạm ${c.active_strikes}/2 · ${count(c.hard_events)} cứng · ${count(c.soft_events)} mềm · lần cuối ${time(c.last_event_at)}`}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button type="button" className={BUTTON} aria-expanded={openId === c.account_id} onClick={() => toggle(c.account_id)}>
                      {openId === c.account_id ? "Ẩn bằng chứng" : "Bằng chứng"}
                    </button>
                    {c.ban_state === "pending_wipe" && (
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => wipe(c)}>Xoá dữ liệu</button>
                    )}
                    {(c.active_strikes > 0 || c.locked_until !== null || c.ban_state !== null) && (
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => pardon(c)}>Ân xá</button>
                    )}
                  </div>
                  {openId === c.account_id && (account ? <Evidence account={account} /> : <p>Đang tải…</p>)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-xs opacity-70">{FOOTNOTE}</p>
    </section>
  );
}

function Evidence({ account }: { account: AnticheatAccount }) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-gold-200 pt-2">
      <h3 className="font-bold text-burgundy">Dữ liệu hiện có</h3>
      <p>{holdingsLine(account.holdings)}</p>
      <h3 className="font-bold text-burgundy">{`Ghi nhận (${count(account.events.length)})`}</h3>
      <ul className="flex flex-col gap-2">
        {account.events.map((e) => (
          <li key={e.id}>
            <p>{`${time(e.created_at)} · ${CODE_LABEL[e.code] ?? e.code} · ${OUTCOME_LABEL[e.outcome] ?? e.outcome} · ${e.rpc}`}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-parchment p-2 text-xs">{JSON.stringify(e.detail, null, 2)}</pre>
            <p className="text-xs opacity-80">{`Client: ${e.client ?? "—"} · Trình duyệt: ${e.user_agent ?? "—"}`}</p>
          </li>
        ))}
      </ul>
      {account.wipes.length > 0 && (
        <>
          <h3 className="font-bold text-burgundy">Đã xoá dữ liệu</h3>
          <ul className="flex flex-col gap-2">
            {account.wipes.map((w) => <WipeRow key={w.id} wipe={w} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function WipeRow({ wipe }: { wipe: AnticheatWipe }) {
  const [shown, setShown] = useState(false);
  return (
    <li className="flex flex-col items-start gap-1">
      <p>{`${time(wipe.wiped_at)} · bởi ${wipe.wiped_by ?? "—"}`}</p>
      <button type="button" className={BUTTON} onClick={() => setShown((s) => !s)}>{shown ? "Ẩn" : "Xem dữ liệu đã xoá"}</button>
      {shown && <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded bg-parchment p-2 text-xs">{JSON.stringify(wipe.snapshot, null, 2)}</pre>}
    </li>
  );
}
