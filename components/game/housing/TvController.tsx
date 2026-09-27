"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { errText, tvAdd, tvNext, tvPosition, tvSkip, tvState, TV_MAX_QUEUE, youTubeIdOf, type TvState } from "@/lib/game/housing/apartment";
import { formatClock } from "@/lib/format";
import { fetchVideoMeta, youTubeThumbnail } from "@/lib/youtube/meta";
import { fetchVideoDetails } from "@/lib/youtube/video";
import { ParchmentModal } from "../Parchment";

const POLL_MS = 10_000;
const SYNC_MS = 2000;
const DRIFT_S = 2;

/** 📺 The apartment's TV (v19.2, owner's ruling): its own YouTube queue, shared by everyone inside this apartment. Mounted
 *  while I am inside a flat with a TV: the hidden player follows the server's clock (current track + its start), like the
 *  room player follows the room row; the panel adds links, shows the queue and skips. The room's music is ducked on this
 *  device while the TV plays (`onDuck`). */
export default function TvController({ token, roomId, no, open, refreshKey, onClose, onChanged, onDuck, onLit }: {
  token: string;
  roomId: string;
  no: number;
  open: boolean;
  /** Bumped when someone inside says the TV changed. */
  refreshKey: number;
  onClose: () => void;
  /** I changed the TV: tell the others inside. */
  onChanged: () => void;
  onDuck: (on: boolean) => void;
  /** The screen is on (drawn lit in the room). */
  onLit: (on: boolean) => void;
}) {
  const [tv, setTv] = useState<{ s: TvState; offsetMs: number } | null>(null);
  const [sound, setSound] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const apply = useCallback((s: TvState) => {
    const now = Date.now();
    setTv({ s, offsetMs: s.serverNowMs - now });
    setClock(now);
  }, []);
  const currentRef = useRef<string | null>(null);

  const ended = useCallback(() => {
    const id = currentRef.current;
    if (!id) return;
    tvNext(token, roomId, no, id).then((s) => { apply(s); onChanged(); }, () => { /* someone else advanced it */ });
  }, [token, roomId, no, apply, onChanged]);
  const player = useYouTubePlayer(ended);
  const { load, play, pause, seekTo, getCurrentTime } = player;

  // the server's TV: on mount, on a hint from the others, and every 10 s
  useEffect(() => {
    let stop = false;
    const get = () => tvState(token, roomId, no).then((s) => { if (!stop) apply(s); }, () => { /* no TV or no access: stays off */ });
    const first = setTimeout(get, 0);
    const id = setInterval(get, POLL_MS);
    return () => { stop = true; clearTimeout(first); clearInterval(id); };
  }, [token, roomId, no, apply, refreshKey]);

  const cur = tv?.s.current ?? null;
  const curId = cur?.id ?? null, curVideo = cur?.videoId ?? null;
  const offsetMs = tv?.offsetMs ?? 0, startedAt = tv?.s.startedAtMs ?? null;
  const offsetRef = useRef(0);
  useEffect(() => { currentRef.current = curId; offsetRef.current = offsetMs; }, [curId, offsetMs]);

  // follow the clock: load the current track at its position, re-seek on drift, pause when nothing plays or muted
  useEffect(() => {
    if (!curVideo || !sound || startedAt === null) { pause(); return; }
    const at = () => Math.max(0, Math.floor((Date.now() + offsetRef.current - startedAt) / 1000));
    const pos = at();
    load(curVideo, pos);
    play();
    const id = setInterval(() => {
      const want = at();
      if (Math.abs(getCurrentTime() - want) > DRIFT_S) seekTo(want);
      setClock(Date.now());
    }, SYNC_MS);
    return () => clearInterval(id);
  }, [curId, curVideo, sound, startedAt, load, play, pause, seekTo, getCurrentTime]);

  const on = curId !== null;
  useEffect(() => { onLit(on); }, [on, onLit]);
  useEffect(() => { onDuck(on && sound); }, [on, sound, onDuck]);
  useEffect(() => () => { onDuck(false); onLit(false); }, [onDuck, onLit]);

  const add = async () => {
    const id = youTubeIdOf(input);
    if (!id) { setError("Dán link YouTube (hoặc mã video 11 ký tự) nhé."); return; }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const details = await fetchVideoDetails(id).catch(() => null);
      const title = details?.title || (await fetchVideoMeta(id).catch(() => null))?.title || id;
      apply(await tvAdd(token, roomId, no, id, title, details?.durationSeconds ?? null));
      onChanged();
      setInput("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      apply(await tvSkip(token, roomId, no));
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const pos = tv ? tvPosition(tv.s, clock, tv.offsetMs) : 0;
  return (
    <ParchmentModal title="📺 Tivi trong nhà" onClose={onClose} className="sm:max-w-xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {/* the TV set: the track's picture in a wooden frame */}
        <div className="mx-auto w-full max-w-md rounded-md border-4 border-[#5a381e] bg-[#20242c] p-2 shadow-inner" data-testid="tv-screen">
          {cur ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnails, same as the room's queue */}
              <img src={youTubeThumbnail(cur.videoId)} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-base text-white">
                ▶ {cur.title} · {formatClock(pos * 1000)}{cur.durationS ? ` / ${formatClock(cur.durationS * 1000)}` : ""}
              </span>
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-parchment/70">Tivi đang tắt — thêm một video nhé</div>
          )}
        </div>
        {cur && <p className="text-base opacity-80">Người mở: {cur.by || "Khách"}</p>}
        <div className="flex flex-wrap gap-2">
          <input className="min-w-0 flex-1 rounded border border-gold-300 bg-cream px-1" placeholder="Dán link YouTube…" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} aria-label="Link YouTube" />
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || input.trim() === ""} onClick={() => void add()}>Thêm</button>
          <button type="button" className="pch-btn" disabled={busy || !cur} onClick={() => void skip()}>⏭ Qua bài</button>
          <button type="button" className="pch-btn" onClick={() => setSound((v) => !v)}>{sound ? "🔇 Tắt tiếng" : "🔊 Bật tiếng"}</button>
        </div>
        <p className="text-sm opacity-80">
          Hàng chờ {tv?.s.queue.length ?? 0}/{TV_MAX_QUEUE}. Mọi người trong nhà cùng xem một video; nhạc của phòng tạm nhỏ lại khi tivi mở.
        </p>
        <ol className="flex max-h-40 list-decimal flex-col gap-0.5 overflow-y-auto pl-6 text-base" data-testid="tv-queue">
          {tv?.s.queue.map((q) => <li key={q.id} className="truncate">{q.title} <span className="opacity-70">· {q.by}</span></li>)}
        </ol>
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
