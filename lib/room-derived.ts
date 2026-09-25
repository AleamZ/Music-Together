import type { Member, QueueItem, Room } from "@/lib/supabase";
import type { RoleFlags } from "@/lib/roles";
import { countMyOrders, type RoomRules } from "@/lib/queue-rules";

export interface RoomDerived {
  current: QueueItem | null;
  /** Approved rows = the play queue. */
  approved: QueueItem[];
  /** Rows awaiting Admin/DJ approval. */
  pending: QueueItem[];
  myPending: QueueItem[];
  rules: RoomRules;
  willPend: boolean;
  /** Per-member order limit (v11): my waiting rows, excluding the one playing. Admin/DJ exempt. */
  orderLimit: { mine: number; exempt: boolean };
  djAccountId: string | null;
  djOnline: boolean;
}

/** Everything both room shells derive from the realtime state, so classic and game mode stay identical. */
export function deriveRoom(
  s: { room: Room; members: Member[]; queue: QueueItem[] },
  accountId: string,
  role: RoleFlags,
  onlineIds: string[],
): RoomDerived {
  const { room, members, queue } = s;
  const current = queue.find((q) => q.id === room.current_item_id) ?? null;
  const approved = queue.filter((q) => q.status === "approved");
  const pending = queue.filter((q) => q.status === "pending");
  const myPending = pending.filter((q) => q.added_by_account_id === accountId);
  const rules: RoomRules = {
    max_duration_seconds: room.max_duration_seconds,
    banned_keywords: room.banned_keywords,
    max_orders_per_member: room.max_orders_per_member,
  };
  const willPend = room.require_approval && !role.canManageQueue;
  const orderLimit = { mine: countMyOrders(queue, accountId, room.current_item_id), exempt: role.canManageQueue };
  // onlineIds are ACCOUNT ids; dj_member_id is a MEMBER id → map it first.
  const djAccountId = members.find((m) => m.id === room.dj_member_id)?.account_id ?? null;
  const djOnline = !!djAccountId && onlineIds.includes(djAccountId);
  return { current, approved, pending, myPending, rules, willPend, orderLimit, djAccountId, djOnline };
}
