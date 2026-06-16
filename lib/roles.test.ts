import { describe, it, expect } from "vitest";
import { deriveRole } from "@/lib/roles";

const room = (admin: string | null, dj: string | null) =>
  ({ admin_member_id: admin, dj_member_id: dj }) as const;

describe("deriveRole", () => {
  it("flags admin and dj from room pointers", () => {
    expect(deriveRole(room("m1", "m2"), "m1")).toEqual({
      isAdmin: true, isDj: false, canManageQueue: true, canControlPlayback: false,
    });
    expect(deriveRole(room("m1", "m2"), "m2")).toEqual({
      isAdmin: false, isDj: true, canManageQueue: true, canControlPlayback: true,
    });
  });
  it("guest has no privileges", () => {
    expect(deriveRole(room("m1", "m2"), "m9")).toEqual({
      isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false,
    });
  });
  it("creator who is both admin and dj", () => {
    expect(deriveRole(room("m1", "m1"), "m1")).toEqual({
      isAdmin: true, isDj: true, canManageQueue: true, canControlPlayback: true,
    });
  });
  it("null member id is a guest", () => {
    expect(deriveRole(room("m1", "m2"), null).isAdmin).toBe(false);
  });
});
