"use client";

import { useRef, useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import type { SearchResult } from "@/lib/youtube/search";
import {
  checkQueueRules,
  ordersRemaining,
  ruleMessage,
  violationFromRpcError,
  checkDuplicateTrack,
  duplicateMessage,
  type RoomRules,
  type RuleViolation,
} from "@/lib/queue-rules";

type AddState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };
const IDLE: AddState = { kind: "idle" };

const REASON: Record<RuleViolation["code"], string> = {
  too_long: "quá dài", unknown_duration: "không rõ thời lượng", banned: "từ khóa cấm", order_limit: "đủ order",
};

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** Search results panel. Mount with a fresh `key` per search — that is what resets the add state. */
export default function SearchResults({
  query,
  results,
  roomId,
  token,
  rules,
  willPend,
  orderLimit,
  queue = [],
  currentVideoId = null,
  history = [],
  onClose,
}: {
  query: string;
  results: SearchResult[];
  roomId: string;
  token: string;
  rules: RoomRules;
  willPend: boolean;
  orderLimit: { mine: number; exempt: boolean };
  queue?: Array<{ youtube_video_id: string }>;
  currentVideoId?: string | null;
  history?: Array<{ youtube_video_id: string }>;
  onClose: () => void;
}) {
  const [state, setState] = useState<Record<string, AddState>>({});
  // Synchronous guard: a rapid double click can call add() twice before React commits "busy".
  const inFlight = useRef(new Set<string>());
  // At the limit rows not yet added show the `đủ order` reason chip (visible on touch too, unlike a tooltip);
  // `mine` updates live through realtime after each add.
  const atLimit = ordersRemaining(rules, orderLimit.mine, orderLimit.exempt) === 0;
  const limitViolation: RuleViolation | null = atLimit ? { code: "order_limit", max: rules.max_orders_per_member } : null;

  async function add(r: SearchResult) {
    if (atLimit) return;
    if (checkDuplicateTrack(r.videoId, queue, currentVideoId, history, 20)) return;
    if ((state[r.videoId] ?? IDLE).kind === "done") return;
    if (inFlight.current.has(r.videoId)) return;
    inFlight.current.add(r.videoId);
    setState((s) => ({ ...s, [r.videoId]: { kind: "busy" } }));
    try {
      await addQueueItem(roomId, token, {
        videoId: r.videoId, title: r.title || r.videoId, thumb: r.thumb, duration: r.durationSeconds,
      });
      setState((s) => ({ ...s, [r.videoId]: { kind: "done" } }));
    } catch (err) {
      const v = violationFromRpcError(err, rules);
      setState((s) => ({ ...s, [r.videoId]: { kind: "error", message: v ? ruleMessage(v) : "Không thêm được." } }));
    } finally {
      inFlight.current.delete(r.videoId);
    }
  }

  return (
    <div className="mt-2 mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 font-cormorant text-burgundy">
        <span className="truncate">
          Kết quả cho &ldquo;{query}&rdquo; <span className="text-xs text-ink/60">· {results.length}</span>
        </span>
        <button type="button" title="Đóng" onClick={onClose}
          className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
      </div>
      {results.length === 0 && <p className="text-sm text-ink/60">Không có kết quả.</p>}
      <ul className="max-h-[40vh] overflow-y-auto pr-1">
        {results.map((r) => {
          const st = state[r.videoId] ?? IDLE;
          const dup = checkDuplicateTrack(r.videoId, queue, currentVideoId, history, 20);
          const violation = checkQueueRules(rules, { title: r.title, durationSeconds: r.durationSeconds }) ?? (st.kind === "done" ? null : limitViolation);
          return (
            <li key={r.videoId} className={`border-b border-dotted border-gold-200 py-2 ${st.kind === "busy" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here */}
                <img src={r.thumb} alt="" className="h-9 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{r.title || r.videoId}</div>
                  <div className="truncate text-[11px] text-gold">
                    {r.channel}{r.durationText ? ` · ${r.durationText}` : ""}
                  </div>
                </div>
                {st.kind === "busy" ? (
                  <Spinner />
                ) : dup && st.kind !== "done" ? (
                  <span
                    title={duplicateMessage(dup)}
                    className="whitespace-nowrap rounded border border-gold/40 bg-parchment-200 px-1.5 py-0.5 text-xs text-ink/60"
                  >
                    {dup.duplicate === "queue"
                      ? dup.isCurrent
                        ? "Đang phát"
                        : "Trong hàng chờ"
                      : "Vừa phát"}
                  </span>
                ) : violation ? (
                  <span title={ruleMessage(violation)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-xs text-ink/50">
                    {REASON[violation.code]}
                  </span>
                ) : (
                  <button type="button" disabled={st.kind === "done"} onClick={() => add(r)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy disabled:opacity-60">
                    {st.kind === "done" ? (willPend ? "✓ Đã gửi" : "✓ Đã thêm") : "+ Thêm"}
                  </button>
                )}
              </div>
              {st.kind === "error" && <p className="mt-1 text-[11px] text-burgundy-accent">{st.message}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

