"use client";

import AddSong from "@/components/room/AddSong";
import MyPending from "@/components/room/MyPending";
import PendingQueue from "@/components/room/PendingQueue";
import Queue from "@/components/room/Queue";
import type { RoleFlags } from "@/lib/roles";
import type { RoomDerived } from "@/lib/room-derived";
import type { Room } from "@/lib/supabase";
import { ParchmentModal } from "./Parchment";

/** The DJ booth: the same order/queue components as the classic right column, in a parchment modal. */
export default function QueuePanel({ room, derived, role, token, onClose }: {
  room: Room;
  derived: RoomDerived;
  role: RoleFlags;
  token: string;
  onClose: () => void;
}) {
  const { approved, pending, myPending, rules, willPend, orderLimit } = derived;
  return (
    <ParchmentModal title="📜 Quầy DJ — Hàng đợi" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <AddSong roomId={room.id} token={token} rules={rules} willPend={willPend} orderLimit={orderLimit} />
        <MyPending items={myPending} roomId={room.id} token={token} />
        {role.canManageQueue && (room.require_approval || pending.length > 0) && (
          <PendingQueue pending={pending} roomId={room.id} token={token} />
        )}
        <Queue queue={approved} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
      </div>
    </ParchmentModal>
  );
}
