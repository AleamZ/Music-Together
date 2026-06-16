"use client";
import type { RoomView } from "@/hooks/useRoom";
export default function RoomShell({ code }: { code: string; view: RoomView }) {
  return <main className="p-6 font-cormorant text-burgundy">Phòng {code} — giao diện đang được lắp ráp…</main>;
}
