"use client";

import { FIELD_FAILED, FIELD_LOADING } from "@/lib/game/farm/messages";

/** What a field panel shows before the field has loaded: the loading line, or the failure with a reload button. */
export default function FieldStatus({ failed, onReload }: { failed: boolean; onReload: () => void }) {
  if (!failed) return <p>{FIELD_LOADING}</p>;
  return (
    <div className="flex flex-col items-start gap-1">
      <p>{FIELD_FAILED}</p>
      <button type="button" className="pch-btn" onClick={onReload}>🔄 Tải lại</button>
    </div>
  );
}
