"use client";

import Link from "next/link";
import { PUBLIC_HALLS } from "@/lib/halls";

/** An old (non-public) room: kept, but closed to everyone except its admin and root (0093). */
export default function ClosedRoom({ name }: { name: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-playfair text-2xl font-bold text-burgundy">Phòng &ldquo;{name}&rdquo; đã tạm đóng</h1>
      <p className="text-ink">
        Hiện chỉ còn các sảnh chung mở cửa cho mọi người. Phòng riêng sẽ sớm quay lại — mời bạn ghé một sảnh nhé!
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {PUBLIC_HALLS.map((h) => (
          <Link key={h.code} href={`/room/${h.code}`} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">
            {h.name} ▸
          </Link>
        ))}
      </div>
      <Link href="/" className="text-sm text-burgundy-accent underline">Về trang chủ</Link>
    </main>
  );
}
