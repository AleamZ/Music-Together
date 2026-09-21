"use client";

import { useState } from "react";
import { assignDj, kickMember, renameRoom, transferAdmin, updateRoomSettings, type Member, type Room } from "@/lib/supabase";
import { normalizeForMatch } from "@/lib/queue-rules";

const MAX_KEYWORD_LEN = 30;
const MAX_KEYWORDS = 50;
const MAX_MINUTES = 1440;
const MAX_ORDERS = 100;

export default function SettingsDialog({ room, members, roomId, token, myMemberId, isAdmin, onClose }: {
  room: Room; members: Member[]; roomId: string; token: string; myMemberId: string | null; isAdmin: boolean; onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const others = members.filter((m) => m.id !== myMemberId);

  // Queue rules (admin + dj). Values are snapshotted when the dialog opens.
  const [maxMinutes, setMaxMinutes] = useState(String(room.max_duration_seconds / 60));
  const [maxOrders, setMaxOrders] = useState(String(room.max_orders_per_member));
  const [requireApproval, setRequireApproval] = useState(room.require_approval);
  const [keywords, setKeywords] = useState<string[]>(room.banned_keywords);
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function addKeyword() {
    const k = kwInput.trim();
    if (!k) return;
    if (k.length > MAX_KEYWORD_LEN) { setRulesMsg({ ok: false, text: `Từ khóa tối đa ${MAX_KEYWORD_LEN} ký tự.` }); return; }
    if (keywords.length >= MAX_KEYWORDS) { setRulesMsg({ ok: false, text: `Tối đa ${MAX_KEYWORDS} từ khóa.` }); return; }
    if (!keywords.some((x) => normalizeForMatch(x) === normalizeForMatch(k))) setKeywords([...keywords, k]);
    setKwInput("");
    setRulesMsg(null);
  }

  async function saveRules() {
    const mins = Number(maxMinutes);
    if (!Number.isFinite(mins) || mins < 0 || mins > MAX_MINUTES) {
      setRulesMsg({ ok: false, text: `Thời lượng tối đa phải từ 0 đến ${MAX_MINUTES} phút.` });
      return;
    }
    const orders = Number(maxOrders);
    if (maxOrders.trim() === "" || !Number.isInteger(orders) || orders < 0 || orders > MAX_ORDERS) {
      setRulesMsg({ ok: false, text: `Số order tối đa phải từ 0 đến ${MAX_ORDERS}.` });
      return;
    }
    setSaving(true);
    setRulesMsg(null);
    try {
      await updateRoomSettings(roomId, token, { maxDurationSeconds: Math.round(mins * 60), requireApproval, bannedKeywords: keywords, maxOrdersPerMember: orders });
      setRulesMsg({ ok: true, text: "Đã lưu quy tắc." });
    } catch {
      setRulesMsg({ ok: false, text: "Không lưu được cài đặt." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">Cài đặt phòng</h3>

        {isAdmin && (
          <>
            <label className="mb-1 block text-sm text-ink">Tên phòng</label>
            <div className="mb-4 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
              <button onClick={() => renameRoom(roomId, token, name.trim())}
                className="rounded-lg bg-burgundy px-3 text-cream">Lưu</button>
            </div>

            <h4 className="mb-2 font-cormorant text-burgundy">Thành viên</h4>
            <ul className="mb-4 max-h-60 overflow-auto">
              {others.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-b border-dotted border-gold-200 py-1.5 text-sm">
                  <span className="text-ink">{m.username ?? "?"}{room.dj_member_id === m.id ? " · 🎧" : ""}</span>
                  <span className="flex gap-1">
                    {room.dj_member_id === m.id
                      ? <button onClick={() => assignDj(roomId, token, null)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Thu DJ</button>
                      : <button onClick={() => assignDj(roomId, token, m.id)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Giao DJ</button>}
                    <button onClick={() => { if (window.confirm(`Chuyển quyền Admin cho ${m.username ?? "?"}?`)) transferAdmin(roomId, token, m.id); }}
                      className="rounded border border-gold-200 px-2 text-xs text-burgundy">Trao Admin</button>
                    <button onClick={() => { if (window.confirm(`Kick ${m.username ?? "?"}?`)) kickMember(roomId, token, m.id); }}
                      className="rounded border border-gold-200 px-2 text-xs text-burgundy-accent">Kick</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h4 className="mb-2 font-cormorant text-burgundy">Quy tắc hàng đợi</h4>

        <label className="mb-1 block text-sm text-ink">Thời lượng tối đa (phút)</label>
        <input type="number" min={0} max={MAX_MINUTES} step={1} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}
          title="Phút; có thể nhập số thập phân (0.5 = 30 giây)"
          className="mb-1 w-28 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">0 = không giới hạn</p>

        <label className="mb-1 block text-sm text-ink">Số order tối đa mỗi người</label>
        <input type="number" min={0} max={MAX_ORDERS} step={1} value={maxOrders} onChange={(e) => setMaxOrders(e.target.value)}
          title="Số bài một thành viên được đặt cùng lúc (đang chờ + chờ duyệt; bài đang phát không tính). Admin/DJ không bị giới hạn."
          className="mb-1 w-28 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">0 = không giới hạn</p>

        <label className="mb-1 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
          Chờ duyệt
        </label>
        <p className="mb-3 text-[11px] text-ink/60">Bài của thành viên phải được Admin/DJ duyệt mới vào hàng đợi.</p>

        <label className="mb-1 block text-sm text-ink">Từ khóa cấm</label>
        {keywords.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-gold-200 bg-cream px-2 text-xs text-ink">
                {k}
                <button type="button" title="Bỏ" onClick={() => setKeywords(keywords.filter((x) => x !== k))} className="text-burgundy">✕</button>
              </span>
            ))}
          </div>
        )}
        <input value={kwInput} onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
          placeholder="Gõ từ khóa rồi Enter"
          className="mb-1 w-full rounded-lg border border-gold bg-cream px-3 py-1.5 text-sm text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">So khớp theo tiêu đề video, không phân biệt hoa/thường và dấu.</p>

        <button onClick={saveRules} disabled={saving} className="rounded-lg bg-burgundy px-3 py-1.5 text-cream disabled:opacity-60">
          {saving ? "…" : "Lưu"}
        </button>
        {rulesMsg && <p className={`mt-1 text-xs ${rulesMsg.ok ? "text-burgundy" : "text-burgundy-accent"}`}>{rulesMsg.text}</p>}

        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-gold py-2 text-burgundy">Đóng</button>
      </div>
    </div>
  );
}
