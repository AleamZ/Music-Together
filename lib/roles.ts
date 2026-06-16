export interface RoleFlags {
  isAdmin: boolean;
  isDj: boolean;
  canManageQueue: boolean;   // delete / reorder / bump
  canControlPlayback: boolean; // play / pause / skip / seek / volume
}

export function deriveRole(
  room: { admin_member_id: string | null; dj_member_id: string | null },
  memberId: string | null,
): RoleFlags {
  const isAdmin = !!memberId && room.admin_member_id === memberId;
  const isDj = !!memberId && room.dj_member_id === memberId;
  return {
    isAdmin,
    isDj,
    canManageQueue: isAdmin || isDj,
    canControlPlayback: isDj,
  };
}
