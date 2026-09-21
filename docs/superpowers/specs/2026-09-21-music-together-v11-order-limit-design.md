# Music Together v11 — Per-Member Order Limit (Design)

**Date:** 2026-09-21
**Builds on:** v10 (listen-along) on top of v9 (room rules). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.

## 1. Goal

A new room setting, editable by **Admin and DJ** next to the v9 rules: **"Số order tối đa mỗi người"** — how many songs one member may have in the queue at the same time. Default **5**. When a member is at the limit, further adds are refused until one of their songs has played (or was rejected/withdrawn).

Decisions taken with the user:

- **What counts** (A): every row of `queue_items` in the room whose `added_by_account_id` is the member's account — pending **and** approved — **except the row currently playing** (`rooms.current_item_id`). A played row is deleted by `advance_queue`, so it stops counting on its own.
- **Admin and DJ are exempt** (A): the limit applies only to ordinary members.
- **Playlists / multi-add** (A): add as many as still fit, then stop; report `Đã thêm k/n bài — đạt giới hạn N order.`
- `0` = no limit (same convention as `max_duration_seconds`). Range `0..100`.

The RPC is the authority (same trust model as v9: a member calling the RPC directly is still limited, because the count comes from the DB, not from the client).

## 2. Data model — migration `supabase/migrations/0009_v11_order_limit.sql`

```sql
alter table public.rooms add column if not exists max_orders_per_member integer not null default 5;
```

Helpers (all `security definer`, `revoke all … from public, anon, authenticated`):

```sql
-- Rows this account has waiting in the room (pending + approved), excluding the row that is playing.
create or replace function public._order_count(p_room_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions as $$
  select count(*)::int from public.queue_items qi
  join public.rooms r on r.id = qi.room_id
  where qi.room_id = p_room_id
    and qi.added_by_account_id = p_account_id
    and qi.id is distinct from r.current_item_id;
$$;

-- How many more rows this member may add: null = unlimited (limit 0, or admin/dj), else max(0, limit - count).
create or replace function public._orders_remaining(p_room_id uuid, p_member_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions as $$
  select case
    when r.max_orders_per_member <= 0 then null
    when p_member_id = r.admin_member_id or p_member_id = r.dj_member_id then null
    else greatest(0, r.max_orders_per_member - public._order_count(p_room_id, p_account_id))
  end
  from public.rooms r where r.id = p_room_id;
$$;
```

RPC changes (all `create or replace`, bodies otherwise identical to 0008):

- `add_queue_item`: after `_check_queue_rules`, `if coalesce(public._orders_remaining(p_room_id, v_member, v_account), 1) <= 0 then raise exception 'order limit reached' using errcode = '23514'; end if;`
- `add_queue_items`: compute `v_remaining := public._orders_remaining(...)` once before the loop; inside the loop, right after the rules check passes, `if v_remaining is not null and v_count >= v_remaining then exit; end if;` — the function still returns the number of rows inserted. (Elements skipped by the v9 rules do not consume slots.)
- `update_room_settings`: **drop** the old signature `(uuid,text,integer,boolean,text[])` (two overloads would make a 5-argument call ambiguous for PostgREST) and recreate as `(p_room_id uuid, p_session_token text, p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[], p_max_orders_per_member integer default null)`; `null` keeps the room's current value (so the v9 tests and any stale client still work); otherwise `< 0 or > 100` → `raise exception 'invalid order limit' using errcode = '22023'`; write the column. Grant execute on the new signature to `anon, authenticated`.

No change to `queue_items`, realtime (the `rooms` row already reaches every member), `advance_queue`, approvals or `delete_item`.

## 3. Client

### 3.1 `lib/supabase.ts`

- `Room` gains `max_orders_per_member: number`.
- `RoomSettings` gains `maxOrdersPerMember: number`; `updateRoomSettings` passes `p_max_orders_per_member`.

### 3.2 `lib/queue-rules.ts` (pure, unit-tested)

```ts
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[]; max_orders_per_member: number }

export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string }
  | { code: "order_limit"; max: number };

/** Rows this account has waiting (pending + approved), excluding the playing one — mirrors SQL `_order_count`. */
export function countMyOrders(
  queue: Array<{ id: string; added_by_account_id: string | null }>,
  accountId: string | null, currentId: string | null,
): number

/** null = unlimited (limit 0 or exempt); else max(0, limit - mine) — mirrors SQL `_orders_remaining`. */
export function ordersRemaining(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): number | null

export function orderLimitViolation(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): RuleViolation | null
  // ordersRemaining(...) === 0 ? { code: "order_limit", max: rules.max_orders_per_member } : null
```

- `ruleMessage`: `order_limit` → `Bạn đã đặt đủ ${max} bài — chờ bài phát xong rồi đặt tiếp.`
- `violationFromRpcError`: message `order limit reached` (errcode `23514`) → `{ code: "order_limit", max: rules.max_orders_per_member }`.
- `checkQueueRules` is unchanged (per-item rules); the order limit is checked separately because it depends on the member, not the item.

### 3.3 `components/room/RoomShell.tsx`

```ts
const rules = { max_duration_seconds: …, banned_keywords: …, max_orders_per_member: room.max_orders_per_member };
const myOrders = countMyOrders(state.queue, accountId, room.current_item_id);
const orderLimit = { mine: myOrders, exempt: role.canManageQueue };   // canManageQueue = admin or dj
```

Passed to `AddSong` (new prop `orderLimit`) which forwards it to `SearchResults`.

### 3.4 `components/room/AddSong.tsx`

- Counter next to the input, only when `ordersRemaining(rules, mine, exempt) !== null`: `Order: {mine}/{max}` (`text-[11px] text-ink/60`; turns `text-burgundy-accent` when remaining is 0).
- Single link: before the RPC, `orderLimitViolation(...)` → `setError(ruleMessage(v))` and return (the RPC error path also maps it, for stale clients).
- Playlist: if remaining is `0`, error as above without calling the RPC. Otherwise call `addQueueItems` as today; when `remaining !== null && added < items.length && added >= remaining` the notice becomes `Đã thêm ${added}/${items.length} bài — đạt giới hạn ${max} order.` (+ the existing "Đã gửi, chờ Admin/DJ duyệt." suffix when `willPend && added > 0`); otherwise the existing notice.
- Text search / suggest path unchanged.

### 3.5 `components/room/SearchResults.tsx`

- New prop `orderLimit: { mine: number; exempt: boolean }`. When `ordersRemaining(rules, mine, exempt) === 0`, every "+ Thêm" button is `disabled` with `title={ruleMessage({ code: "order_limit", max })}`; rows already `done` stay as they are. The RPC error path also maps `order limit reached`.
- `mine` updates live through realtime (RoomShell recomputes it from `state.queue`), so after a successful add the remaining buttons disable automatically when the limit is hit.

### 3.6 `components/room/SettingsDialog.tsx` — "Quy tắc hàng đợi" (Admin + DJ)

- New numeric field after "Thời lượng tối đa": label **`Số order tối đa mỗi người`**, `min=0 max=100 step=1`, hint `0 = không giới hạn`; client validation `Số order tối đa phải từ 0 đến 100.`; saved together with the other rules via `updateRoomSettings({ …, maxOrdersPerMember })`.

### 3.7 README — v11 section (what counts, exemptions, playlist behaviour, default 5, 0 = unlimited).

## 4. Error handling

| Situation | Behaviour |
|---|---|
| Member at the limit adds a link / search result | client blocks with `Bạn đã đặt đủ N bài — chờ bài phát xong rồi đặt tiếp.`; RPC would raise `order limit reached` (23514) anyway |
| Member adds a playlist larger than the remaining slots | first `remaining` valid items are inserted; notice `Đã thêm k/n bài — đạt giới hạn N order.` |
| Admin / DJ adds | never limited (`_orders_remaining` → null) |
| Limit set to 0 | unlimited for everyone; counter hidden |
| Limit lowered below a member's current count | existing rows stay; that member cannot add until below the limit |
| Member's song starts playing | it stops counting immediately (excluded by `current_item_id`) |
| Setting out of range | RPC `invalid order limit` (22023); dialog shows `Số order tối đa phải từ 0 đến 100.` before calling |
| Old client / v9 test calls `update_room_settings` without the new argument | the default `null` keeps the current limit |

## 5. Testing

- **Unit** `tests/unit/queue-rules.test.ts` (extend): `countMyOrders` (own pending + approved counted, the playing row and other accounts excluded, null account → 0); `ordersRemaining` (limit 0 → null, exempt → null, clamps at 0); `orderLimitViolation`; `ruleMessage("order_limit")`; `violationFromRpcError` for `order limit reached`.
- **Integration** `tests/integration/v11.test.ts` (env-gated like v9): member adds 5 then the 6th → `order limit reached`; admin adds unlimited; playlist of 10 with 2 slots → returns 2; playing row does not count (after `advance_queue` the member can add again); limit 0 → unlimited; `update_room_settings` rejects 101.
- **Migration**: apply `0009` on the local PG18 throwaway cluster (0001→0009 in order) before dispatching client tasks.
- **Manual**: settings field visible for Admin and DJ, hidden for members; counter `Order: 3/5` for a member, hidden for Admin/DJ; buttons disable at the limit; playlist message.

## 6. File map (v11)

```
supabase/migrations/0009_v11_order_limit.sql   # CREATE
lib/supabase.ts                                 # MODIFY: Room + RoomSettings + updateRoomSettings
lib/queue-rules.ts                              # MODIFY: RoomRules, countMyOrders, ordersRemaining, orderLimitViolation, messages
tests/unit/queue-rules.test.ts                  # MODIFY
tests/integration/v11.test.ts                   # CREATE (env-gated)
components/room/RoomShell.tsx                   # MODIFY: rules + orderLimit props
components/room/AddSong.tsx                     # MODIFY: counter, pre-check, playlist notice, forward prop
components/room/SearchResults.tsx               # MODIFY: disable at limit
components/room/SettingsDialog.tsx              # MODIFY: new field
README.md                                       # MODIFY: v11 section
```

## 7. Out of scope

- Per-member overrides or VIP quotas.
- Counting play history (a daily cap) — this is "at once", not "per day".
- Showing other members' counts to Admin/DJ.
