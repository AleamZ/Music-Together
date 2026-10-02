"use client";

import { useEffect, useState } from "react";
import { boostText, parseBetaMe, type BetaMe } from "@/lib/game/beta/frame";
import { fetchBetaMe } from "@/lib/game/beta/rpc";

/** 0118: the post-Beta boost (+50 % KN, +25 % thương lái full-price quota) with its countdown; nothing once it ends or
 *  for a player who was not in the Beta. Re-reads the server every 10 minutes, ticks the countdown every 30 s. */
export default function BetaBoostChip({ token }: { token: string | null }) {
  const [me, setMe] = useState<BetaMe>(() => parseBetaMe(null));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!token) return;
    let live = true;
    const load = () => { fetchBetaMe(token).then((m) => { if (live) setMe(m); }, () => {}); };
    load();
    const reload = setInterval(load, 10 * 60_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { live = false; clearInterval(reload); clearInterval(tick); };
  }, [token]);
  const text = boostText(me, now);
  if (!text) return null;
  return (
    <span className="whitespace-nowrap rounded-sm border border-amber-500 bg-amber-50 px-1 text-sm text-amber-900" data-testid="beta-boost"
      title="Quà Kỷ niệm Beta: 7 ngày tăng tốc sau reset — +50% kinh nghiệm, +25% hạn mức thương lái trả đủ giá">
      {text}
    </span>
  );
}
