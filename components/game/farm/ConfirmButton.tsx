"use client";

import { useState, type ReactNode } from "react";

/** A button that asks first when `warn` is set: the warning, then "Vẫn làm" / "Thôi". */
export default function ConfirmButton({ warn, disabled, primary, onConfirm, children }: {
  warn?: string;
  disabled?: boolean;
  primary?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-base text-burgundy">⚠️ {warn}</span>
        <div className="flex gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>
            Vẫn làm
          </button>
          <button type="button" className="pch-btn" onClick={() => setAsking(false)}>Thôi</button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className={`pch-btn ${primary ? "pch-btn-primary" : ""}`} disabled={disabled} onClick={() => (warn ? setAsking(true) : onConfirm())}>
      {children}
    </button>
  );
}
