"use client";

import { useAuth } from "@/hooks/useAuth";
import { BAN_BODY, BAN_OK, BAN_TITLE, BAN_WIPE, WARN_BODY, WARN_LOCK, WARN_OK, WARN_REPEAT, WARN_TITLE } from "@/lib/anticheat";
import { ParchmentModal } from "./Parchment";

/** The anti-cheat warning (strike 1) and ban (strike 2) (spec §12.1, §12.2). The warning closes with its button, ✕ or
 *  Esc; the ban logs out however it is closed, because the server has already ended the session (R15). */
export default function AnticheatModal({ kind, reason, onClose }: {
  kind: "warn" | "ban";
  reason: string;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  if (kind === "warn") {
    return (
      <ParchmentModal title={WARN_TITLE} onClose={onClose}>
        <div className="flex flex-col gap-2 font-vt text-lg leading-snug">
          <p>{WARN_BODY}</p>
          <p>{`Lý do: ${reason}`}</p>
          <p>{WARN_LOCK}</p>
          <p>{WARN_REPEAT}</p>
          <button type="button" className="pch-btn pch-btn-primary self-end" onClick={onClose}>{WARN_OK}</button>
        </div>
      </ParchmentModal>
    );
  }
  const leave = () => {
    onClose();
    void logout();
  };
  return (
    <ParchmentModal title={BAN_TITLE} onClose={leave}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-snug">
        <p>{BAN_BODY}</p>
        <p>{`Lý do: ${reason}`}</p>
        <p>{BAN_WIPE}</p>
        <button type="button" className="pch-btn pch-btn-primary self-end" onClick={leave}>{BAN_OK}</button>
      </div>
    </ParchmentModal>
  );
}
