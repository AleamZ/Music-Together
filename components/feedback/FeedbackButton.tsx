"use client";

import { useState } from "react";
import FeedbackModal from "./FeedbackModal";

export default function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={className ?? "rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy"}>
        💬 Góp ý
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}
