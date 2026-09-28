"use client";

import { useEffect, useState } from "react";
import { PHOTO_MAX_COUNT, questErrorMessage } from "@/lib/game/quests/model";
import { photoDelete, photoGet, photoList, type PhotoMeta } from "@/lib/game/quests/rpc";
import { ParchmentModal } from "../Parchment";

const errText = (e: unknown) =>
  questErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

function Thumb({ token, p, onOpen }: { token: string; p: PhotoMeta; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    photoGet(token, p.id).then((d) => { if (live) setUrl(d); }, () => {});
    return () => { live = false; };
  }, [token, p.id]);
  return (
    <button type="button" className="block aspect-[16/10] w-full overflow-hidden rounded border border-gold-300 bg-parchment"
      onClick={() => url && onOpen(url)} aria-label={`Ảnh ${p.caption || p.id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the album */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" /> : <span className="text-base">…</span>}
    </button>
  );
}

/** 🖼️ Album ảnh (v21 #95): my saved photos (small JPEGs kept by the server, 24 at most). Download or delete. */
export default function AlbumModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [photos, setPhotos] = useState<PhotoMeta[] | null>(null);
  const [open, setOpen] = useState<{ p: PhotoMeta; url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    photoList(token).then((x) => { if (live) setPhotos(x); }, (e) => { if (live) setMsg(errText(e)); });
    return () => { live = false; };
  }, [token]);

  const del = async (id: number) => {
    try {
      setPhotos(await photoDelete(token, id));
      setOpen(null);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <ParchmentModal title="🖼️ Album ảnh" onClose={onClose} className="sm:max-w-[760px]">
      <div className="flex flex-col gap-2 font-vt text-lg" data-testid="album">
        <p className="text-base">{photos?.length ?? 0}/{PHOTO_MAX_COUNT} ảnh · chụp bằng nút 📷 trên thanh công cụ.</p>
        {msg && <p role="status" className="rounded bg-gold-100 px-2 text-burgundy">{msg}</p>}
        {open ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the album */}
            <img src={open.url} alt={open.p.caption || "Ảnh"} className="max-h-[60vh] max-w-full rounded border border-gold-300 [image-rendering:pixelated]" />
            <p className="text-base">{open.p.caption} · {new Date(open.p.at).toLocaleString("vi-VN")}</p>
            <div className="flex gap-2">
              <a className="pch-btn pch-btn-primary" href={open.url} download={`music-together-${open.p.id}.jpg`}>💾 Tải về</a>
              <button type="button" className="pch-btn" onClick={() => void del(open.p.id)}>🗑️ Xoá</button>
              <button type="button" className="pch-btn" onClick={() => setOpen(null)}>← Quay lại</button>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(photos ?? []).map((p) => (
              <li key={p.id}><Thumb token={token} p={p} onOpen={(url) => setOpen({ p, url })} /></li>
            ))}
            {photos?.length === 0 && <li className="col-span-full">Chưa có ảnh nào.</li>}
          </ul>
        )}
      </div>
    </ParchmentModal>
  );
}
