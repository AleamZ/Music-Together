"use client";

import { useState } from "react";
import type { CatalogItem } from "@/lib/game/character";
import type { Member } from "@/lib/supabase";
import ItemIcon from "./ItemIcon";
import { ParchmentModal } from "./Parchment";
import { storeErrorMessage, transferFashionItem } from "@/lib/game/store";

interface ItemTransferDialogProps {
  item: CatalogItem;
  token: string;
  myAccountId: string;
  members: Member[];
  onlineIds: string[];
  onTransferred: (itemId: string, recipientName: string) => void;
  onClose: () => void;
}

export default function ItemTransferDialog({
  item,
  token,
  myAccountId,
  members,
  onlineIds,
  onTransferred,
  onClose,
}: ItemTransferDialogProps) {
  // Filter members in the room, excluding current user
  const candidates = members.filter((m) => m.account_id !== myAccountId);
  // Sort online members first
  const sortedCandidates = [...candidates].sort((a, b) => {
    const aOnline = onlineIds.includes(a.account_id) ? 1 : 0;
    const bOnline = onlineIds.includes(b.account_id) ? 1 : 0;
    return bOnline - aOnline || (a.username ?? "").localeCompare(b.username ?? "");
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    sortedCandidates[0]?.account_id ?? ""
  );
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMember = candidates.find((m) => m.account_id === selectedAccountId);

  const handleTransfer = async () => {
    if (!selectedAccountId || transferring) return;
    setTransferring(true);
    setError(null);
    try {
      await transferFashionItem(token, selectedAccountId, item.id);
      onTransferred(item.id, selectedMember?.username ?? "bạn bè");
    } catch (e) {
      setError(storeErrorMessage(e));
      setTransferring(false);
    }
  };

  return (
    <ParchmentModal title="🎁 Pass lại đồ cho bạn bè" onClose={onClose} className="sm:max-w-md">
      <div className="flex flex-col gap-3 font-vt text-lg">
        {/* Item summary */}
        <div className="flex items-center gap-3 rounded-sm border-2 border-gold-200 bg-parchment p-2.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border-2 border-gold-300 bg-cream">
            <ItemIcon id={item.id} scale={3} />
          </div>
          <div>
            <p className="text-xl font-bold leading-none text-burgundy">{item.name}</p>
            <p className="text-sm opacity-80 mt-1">
              Giá gốc: <span className="font-bold text-amber-700">{item.price} xu</span>
            </p>
          </div>
        </div>

        {/* Member selection */}
        <div>
          <p className="font-bold text-ink">Chọn người nhận:</p>
          {sortedCandidates.length === 0 ? (
            <p className="mt-2 text-base text-gray-600">Hiện không có thành viên nào khác trong phòng.</p>
          ) : (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-sm border-2 border-gold-200 bg-cream p-1 flex flex-col gap-1">
              {sortedCandidates.map((m) => {
                const isOnline = onlineIds.includes(m.account_id);
                const isSelected = m.account_id === selectedAccountId;
                return (
                  <button
                    key={m.account_id}
                    type="button"
                    onClick={() => setSelectedAccountId(m.account_id)}
                    className={`flex items-center justify-between rounded px-2 py-1 text-left transition-colors ${
                      isSelected
                        ? "bg-gold-300 text-burgundy font-bold"
                        : "hover:bg-gold-100 text-ink"
                    }`}
                  >
                    <span className="truncate">
                      {isOnline ? "🟢 " : "⚪ "}
                      {m.username}
                    </span>
                    <span className="text-xs opacity-75">
                      {isOnline ? "Đang online" : "Rời phòng"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-base text-burgundy-accent" role="alert">{error}</p>}

        <p className="text-xs opacity-70 italic">
          * Khi pass đồ, món này sẽ chuyển sang tủ đồ của người nhận và bạn sẽ không còn sở hữu nữa.
        </p>

        {/* Action buttons */}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="pch-btn" onClick={onClose} disabled={transferring}>
            Huỷ
          </button>
          <button
            type="button"
            className="pch-btn pch-btn-primary"
            onClick={() => void handleTransfer()}
            disabled={!selectedAccountId || transferring}
          >
            {transferring ? "Đang chuyển…" : "Xác nhận pass đồ"}
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
