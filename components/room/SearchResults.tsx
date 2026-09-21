"use client";

import { useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import type { SearchResult } from "@/lib/youtube/search";

type AddState = "idle" | "busy" | "done" | "error";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** Search results panel. Mount with a fresh `key` per search — that is what resets the add state. */
export default function SearchResults({ query, results, roomId, token, onClose }: {
  query: string; results: SearchResult[]; roomId: string; token: string; onClose: () => void;
}) {
  const [state, setState] = useState<Record<string, AddState>>({});

  async function add(r: SearchResult) {
    setState((s) => ({ ...s, [r.videoId]: "busy" }));
    try {
      await addQueueItem(roomId, token, {
        videoId: r.videoId, title: r.title || r.videoId, thumb: r.thumb, duration: r.durationSeconds,
      });
      setState((s) => ({ ...s, [r.videoId]: "done" }));
    } catch {
      setState((s) => ({ ...s, [r.videoId]: "error" }));
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
          const st = state[r.videoId] ?? "idle";
          return (
            <li key={r.videoId} className={`border-b border-dotted border-gold-200 py-2 ${st === "busy" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here */}
                <img src={r.thumb} alt="" className="h-9 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{r.title || r.videoId}</div>
                  <div className="truncate text-[11px] text-gold">
                    {r.channel}{r.durationText ? ` · ${r.durationText}` : ""}
                  </div>
                </div>
                {st === "busy" ? <Spinner /> : (
                  <button type="button" disabled={st === "done"} onClick={() => add(r)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy disabled:opacity-60">
                    {st === "done" ? "✓ Đã thêm" : "+ Thêm"}
                  </button>
                )}
              </div>
              {st === "error" && <p className="mt-1 text-[11px] text-burgundy-accent">Không thêm được.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
