# Music Together v9 — Room Rules: Max Duration, Approval Queue, Banned Keywords (Design)

**Date:** 2026-09-21
**Builds on:** v8 (`feat/v8-yt-search`, merging to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.

## 1. Goal

Give each room three **Admin/DJ-configurable rules** that govern what enters the play queue:

1. **Max video duration** — default **10 minutes**; longer videos are rejected with a clear message. `0` = unlimited.
2. **Approval queue ("Chờ duyệt")** — off by default. When on, songs added by ordinary members go to a **pending list** that only Admin/DJ see; they approve (per row or **all at once**) or reject. Admin/DJ additions bypass approval. Members see their own pending songs and can withdraw them.
3. **Banned keywords** — a list of strings; a video whose **title** contains any of them (case- and accent-insensitive) is rejected.

All three are **enforced server-side in the RPCs** (the DB is public; anyone can call an RPC directly). The client re-implements the same checks only to give friendly messages before calling.

## 2. Constraints (carried from v1–v8)

- **Public DB / RPC-only writes:** rules live in `SECURITY DEFINER` functions authorized by `_auth(room, session, role)`; `'admin_or_dj'` already exists.
- **Additive migration** `0008_v9_room_rules.sql`: `add column if not exists`, `create or replace function`, `create extension if not exists`. No table drops, no data loss; existing queue rows become `approved`.
- **Realtime is full-state refetch** on any `rooms` / `queue_items` / `members` change — a `status` flip or a settings save is picked up with no new channel.
- **Key-free YouTube access** via same-origin proxies (`/api/oembed`, `/api/playlist`, `/api/yt/*`); v9 adds one more (`/api/yt/video`) in the same style.
- **Theme tokens only**; no new CSS. Vietnamese copy verbatim as listed below.
- **Repo is public:** no secrets.

## 3. Migration — `supabase/migrations/0008_v9_room_rules.sql`

### 3.1 Schema

```sql
create extension if not exists unaccent with schema extensions;

alter table public.rooms
  add column if not exists max_duration_seconds integer not null default 600,   -- 0 = unlimited
  add column if not exists require_approval     boolean not null default false,
  add column if not exists banned_keywords      text[]  not null default '{}';

alter table public.queue_items
  add column if not exists status text not null default 'approved';
alter table public.queue_items drop constraint if exists queue_items_status_check;
alter table public.queue_items add constraint queue_items_status_check check (status in ('pending','approved'));
create index if not exists queue_items_room_status_idx on public.queue_items (room_id, status);
```

`position` for a **pending** row is `0` (not in the ordered queue); approval assigns `max(position)+1` at approval time, so approved songs join the **end** of the queue in approval order.

### 3.2 Rule check (internal)

```sql
create or replace function public._check_queue_rules(p_room_id uuid, p_title text, p_duration integer)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_max integer; v_kw text; v_title text;
begin
  select max_duration_seconds into v_max from public.rooms where id = p_room_id;
  if v_max > 0 then
    if p_duration is null then
      raise exception 'duration unknown' using errcode = '23514';
    elsif p_duration > v_max then
      raise exception 'video too long' using errcode = '23514';
    end if;
  end if;
  v_title := lower(extensions.unaccent(coalesce(p_title, '')));
  for v_kw in select unnest(banned_keywords) from public.rooms where id = p_room_id loop
    if v_kw <> '' and position(lower(extensions.unaccent(v_kw)) in v_title) > 0 then
      raise exception 'banned keyword: %', v_kw using errcode = '23514';
    end if;
  end loop;
end; $$;
revoke all on function public._check_queue_rules(uuid,text,integer) from public, anon, authenticated;
```

`errcode 23514` (`check_violation`) is what the client keys on to map the message (§5). The message text is the contract: `duration unknown` | `video too long` | `banned keyword: <kw>`.

### 3.3 Pending decision (internal)

```sql
create or replace function public._queue_status_for(p_room_id uuid, p_member_id uuid) returns text
language sql security definer set search_path = public, extensions as $$
  select case when r.require_approval and p_member_id is distinct from r.admin_member_id
                                       and p_member_id is distinct from r.dj_member_id
              then 'pending' else 'approved' end
  from public.rooms r where r.id = p_room_id;
$$;
```

### 3.4 Changed RPCs

- **`add_queue_item(room, token, video_id, title, thumb, duration)`** — after `_auth(... 'any')` (which returns the member id): `perform _check_queue_rules(room, title, duration)`; `v_status := _queue_status_for(room, v_member)`; insert with `status = v_status` and `position = case when v_status = 'pending' then 0 else max+1 end`. Returns the new id (unchanged signature).
- **`add_queue_items(room, token, items jsonb)`** — each element now `{ video_id, title, thumb, duration }` (`duration` nullable int). Per element: `begin perform _check_queue_rules(...); exception when check_violation then continue; end;` — a violating element is **skipped**, the batch continues. Status/position per §3.3 (pending rows all `position 0`). Returns the number inserted (unchanged return type; the client derives `skipped = items.length - added`). Cap 50 as before.
- **`advance_queue`** — both branches (`order` / `shuffle`) add `and status = 'approved'` when picking `v_next`.
- **`delete_item(room, token, item)`** — new rule: allowed when the caller is `admin_or_dj` **or** the row is `pending` and `added_by_account_id = caller's account`. Implemented by calling `_auth(... 'any')`, then checking; raise `42501` otherwise. (This is how a member withdraws a pending song.)
- `reorder_item`, `bump_to_top` — unchanged (pending rows never appear in the reorderable list).

### 3.5 New RPCs (all `admin_or_dj`, `grant execute … to anon, authenticated`)

```sql
approve_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid) returns void
  -- update queue_items set status='approved', position = (select coalesce(max(position),0)+1 from queue_items where room_id=p_room_id and status='approved')
  -- where id=p_item_id and room_id=p_room_id and status='pending'; (no-op if not pending)
approve_all_pending(p_room_id uuid, p_session_token text) returns int
  -- loop over pending rows in the room ordered by created_at, approve each as above; return count
reject_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid) returns void
  -- delete where id=p_item_id and room_id=p_room_id and status='pending'
update_room_settings(p_room_id uuid, p_session_token text,
                     p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[]) returns void
```

`update_room_settings` validation: `p_max_duration_seconds >= 0` and `<= 86400`; keywords: trim each, drop empty, cap each at 30 chars, cap the array at 50, dedupe case-insensitively (raise `22023` on violation). If `p_require_approval` is false and the room currently has pending rows, **approve them all** (same as `approve_all_pending`) inside the same call so nothing is left invisible.

`lib/supabase.ts` adds wrappers: `approveQueueItem`, `approveAllPending`, `rejectQueueItem`, `updateRoomSettings`; `addQueueItems` items gain `duration: number | null`; `Room` gains `max_duration_seconds: number; require_approval: boolean; banned_keywords: string[]`; `QueueItem` gains `status: "pending" | "approved"`.

## 4. Duration for pasted links (approach A)

### 4.1 `GET /api/yt/video?id=` (`app/api/yt/video/route.ts`)

- Validate with `parseYouTubeId`; fetch `https://www.youtube.com/watch?v={id}&hl=en` with the playlist route's headers (`User-Agent`, `Accept-Language`, `Cookie: CONSENT=YES+1`), `AbortSignal.timeout(8000)`, `next: { revalidate: 86400 }`, 5 MB size guard.
- Pure parser `extractVideoDetails(html)` in `lib/youtube/video.ts`: locate `ytInitialPlayerResponse` (same balanced-JSON slicing as `extractYtInitialData`; markers `var ytInitialPlayerResponse = ` and `ytInitialPlayerResponse = `), read `videoDetails.{videoId,title,author,lengthSeconds,isLiveContent,isLive}` → `{ id, title, author, durationSeconds: number | null, isLive: boolean }`. `lengthSeconds` is a numeric string; `"0"` or missing or live → `null`. Unparseable → `null` (route answers 404).
- Response `200 { id, title, author, durationSeconds, isLive }` | `400` | `404 { error }` | `502 { error }`.
- Client `fetchVideoDetails(id, signal?)` in `lib/youtube/video.ts`; resolves `null` on any non-OK.

### 4.2 `AddSong` link path

Single video: `fetchVideoDetails(id)` first; if it returns data, use its `title`, thumb `https://i.ytimg.com/vi/{id}/hqdefault.jpg`, `duration: durationSeconds`. If it fails, fall back to the existing `fetchVideoMeta` (oEmbed) with `duration: null` — the RPC then rejects it only when the room has a duration limit, with the "unknown duration" message.

### 4.3 Playlist durations

`extractPlaylistItems` gains `durationSeconds: number | null` per item:
- lockup layout: `lockupViewModel.contentImage.thumbnailViewModel.overlays[].thumbnailOverlayBadgeViewModel.thumbnailBadges[].text` (e.g. `"4:32"`) → `parseDurationText` (from v8's `lib/youtube/search.ts`);
- legacy layout: `playlistVideoRenderer.lengthSeconds` (numeric string) or `lengthText.simpleText`.
`fetchPlaylistItems` passes it through; `AddSong` sends `duration` in the batch payload.

## 5. Client-side rule check — `lib/queue-rules.ts`

```ts
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[] }
export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string };
export function normalizeForMatch(s: string): string       // lower + NFD + strip \p{M}
export function checkQueueRules(rules: RoomRules, item: { title: string; durationSeconds: number | null }): RuleViolation | null
export function ruleMessage(v: RuleViolation): string
export function violationFromRpcError(err: unknown, rules: RoomRules): RuleViolation | null  // maps errcode 23514 messages
```

Messages (verbatim):
- too_long → `Video dài hơn giới hạn {X} phút của phòng.` (X = `Math.round(maxSeconds/60)`)
- unknown_duration → `Không xác định được thời lượng — phòng đang giới hạn {X} phút.`
- banned → `Tiêu đề chứa từ khóa bị cấm: "{keyword}".`
- pending notice (not a violation) → `Đã gửi, chờ Admin/DJ duyệt.`
- playlist summary → `Đã thêm {N} bài từ playlist.` and, when `M > 0`, ` Bỏ qua {M} bài (quá dài / từ khóa cấm).`

Used by: `AddSong` (pre-check before the RPC; map RPC errors), `SearchResults` (rows that violate show a disabled grey button labelled `quá dài` / `từ khóa cấm` instead of `+ Thêm`), the playlist path (counts).

## 6. UI

### 6.1 Settings — `components/room/SettingsDialog.tsx`, `components/room/Header.tsx`

- Header opens the dialog for **Admin or DJ** (`isAdmin || isDj`; Header receives `isDj` too).
- Dialog sections: **Tên phòng** and **Thành viên** — unchanged, rendered only when `isAdmin`. New section **Quy tắc hàng đợi** (Admin + DJ):
  - *Thời lượng tối đa (phút)* — `<input type="number" min=0 step=1>`; helper text `0 = không giới hạn`; default value from `room.max_duration_seconds / 60`.
  - *Chờ duyệt* — checkbox/toggle bound to `room.require_approval`; helper `Bài của thành viên phải được Admin/DJ duyệt mới vào hàng đợi.`
  - *Từ khóa cấm* — chip list: text input, **Enter** adds (trimmed, ≤ 30 chars, no dup), each chip has ✕; helper `So khớp theo tiêu đề video, không phân biệt hoa/thường và dấu.`
  - **Lưu** → `updateRoomSettings(...)`; disabled while saving; error line below on failure (`Không lưu được cài đặt.`); success closes nothing (dialog stays open, values are live via realtime).

### 6.2 Pending panel (Admin/DJ) — `components/room/PendingQueue.tsx`

Rendered by `RoomShell` **above `Queue`** in the right column, only when `role.canManageQueue && (room.require_approval || pending.length > 0)`.
- Header: `⏳ Chờ duyệt · {N}` + button **Duyệt tất cả** (disabled when `N === 0` or busy) → `approveAllPending`.
- Rows (`max-h-[35vh] overflow-y-auto`): thumb `h-9 w-12` · title (truncate) · `do {added_by_name}` · **✓** (`title="Duyệt"`) → `approveQueueItem` · **✕** (`title="Từ chối"`) → `rejectQueueItem`. Per-row spinner + `opacity-60` while busy (same pattern as `Queue.tsx`). Error line `Thao tác không thành công, thử lại nhé.`

### 6.3 My pending (members) — `components/room/MyPending.tsx`

Rendered by `RoomShell` **below `AddSong`** when `myPending.length > 0` (any role; Admin/DJ never have pending rows so it naturally hides for them).
- Header `⏳ Đang chờ duyệt · {N}`; rows thumb · title · **✕** (`title="Rút lại"`) → `deleteItem` (allowed by §3.4). Spinner per row.

### 6.4 Queue split — `components/room/RoomShell.tsx`

```ts
const approved  = state.queue.filter((q) => q.status === "approved");
const pending   = state.queue.filter((q) => q.status === "pending");
const myPending = pending.filter((q) => q.added_by_account_id === accountId);
```
`Queue` receives `approved` (it already filters out `currentId`). `useDjController` receives `queueLen: approved.length`. `NowPlaying`/`current` lookups unchanged (current is always approved).

### 6.5 AddSong / SearchResults hooks

`AddSong` and `SearchResults` receive `rules: RoomRules` and `willPend: boolean` (`room.require_approval && !role.canManageQueue`) from `RoomShell`:
- pre-check with `checkQueueRules` → show `ruleMessage` and skip the RPC;
- on success when `willPend` → notice `Đã gửi, chờ Admin/DJ duyệt.` (single add) / results row label `✓ Đã gửi` instead of `✓ Đã thêm`;
- RPC `23514` errors → `violationFromRpcError` → message; other errors as today.

## 7. Error handling

| Where | Failure | Behaviour |
|---|---|---|
| `_check_queue_rules` | too long / unknown / banned | `23514` → client message (§5) |
| `add_queue_items` | element violates | skipped; summary shows count |
| `/api/yt/video` | parse fail / blocked | 404/502 → `AddSong` falls back to oEmbed, `duration = null` |
| `update_room_settings` | invalid values / not admin_or_dj | `22023` / `42501` → `Không lưu được cài đặt.` |
| approve / reject / withdraw | RPC error | row error line, button re-enabled |
| approval turned off with pending rows | — | all auto-approved in the same RPC |

## 8. Testing

- **Unit** (`tests/unit/`):
  - `queue-rules.test.ts`: `normalizeForMatch("Nhạc Chế")` → `"nhac che"`; too long at boundary (`601` vs `600` with max `600`); `0` = unlimited (any duration, `null` allowed); `null` duration with a limit → `unknown_duration`; keyword match case/accent-insensitive; first matching keyword reported; `ruleMessage` strings; `violationFromRpcError` maps the three messages and ignores other errors.
  - `video.test.ts`: `extractVideoDetails` on a trimmed watch-page fixture (`var ytInitialPlayerResponse = {...};`) → details; live (`isLive: true`, `lengthSeconds: "0"`) → `durationSeconds: null`; garbage → `null`.
  - `playlist.test.ts` (extend): lockup badge `"1:02:15"` → `3735`; legacy `lengthSeconds: "272"` → `272`; missing → `null`.
- **Integration** (`tests/integration/v9.test.ts`, skips without `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`), against a fresh room after running migration 0008:
  - `update_room_settings` by admin sets all three fields; by a plain member → `42501`; invalid max (`-1`) → `22023`; keywords trimmed/deduped/capped.
  - `add_queue_item` with max 600: `duration 601` → `23514 'video too long'`; `null` → `'duration unknown'`; `599` ok; title containing a banned keyword (accent variant) → `'banned keyword: …'`.
  - approval on: member add → `status 'pending'`, `position 0`; DJ add → `approved`; `approve_queue_item` → approved with position after the max; `approve_all_pending` → count and order by `created_at`; `reject_queue_item` deletes; member `delete_item` on own pending ok, on another's → `42501`; `advance_queue` never selects a pending row; turning approval off approves all.
  - `add_queue_items` mixed batch: violating elements skipped, count correct, statuses per role.
- **Manual**: both themes; DJ (non-admin) sees only the rules section in Settings; member sees own pending + withdraw; Admin sees pending panel + approve all.

## 9. File map (v9)

```
supabase/migrations/0008_v9_room_rules.sql   # CREATE: columns, unaccent, _check_queue_rules, _queue_status_for, changed + new RPCs, grants
lib/supabase.ts                              # MODIFY: Room/QueueItem fields; addQueueItems duration; new RPC wrappers
lib/queue-rules.ts                           # CREATE: normalizeForMatch, checkQueueRules, ruleMessage, violationFromRpcError
lib/youtube/video.ts                         # CREATE: extractVideoDetails (pure), fetchVideoDetails (client)
app/api/yt/video/route.ts                    # CREATE: watch-page proxy → videoDetails
lib/youtube/playlist.ts                      # MODIFY: durationSeconds per item (both layouts)
components/room/Header.tsx                   # MODIFY: settings button for admin OR dj; pass isDj
components/room/SettingsDialog.tsx           # MODIFY: admin-only sections gated; new "Quy tắc hàng đợi" section
components/room/PendingQueue.tsx             # CREATE: admin/dj pending panel (approve / reject / approve all)
components/room/MyPending.tsx                # CREATE: member's own pending list (withdraw)
components/room/RoomShell.tsx                # MODIFY: queue split; render PendingQueue / MyPending; pass rules/willPend
components/room/AddSong.tsx                  # MODIFY: video-details first, pre-check rules, pending notice, playlist skip count
components/room/SearchResults.tsx            # MODIFY: rule-violating rows disabled with reason; "Đã gửi" when pending
tests/unit/queue-rules.test.ts               # CREATE
tests/unit/video.test.ts                     # CREATE
tests/unit/playlist.test.ts                  # MODIFY: duration cases
tests/integration/v9.test.ts                 # CREATE
README.md                                    # MODIFY: v9 section (migration 0008 instructions)
```

## 10. Phasing (for the plan)

1. **Migration + wrappers + integration tests** (schema, rules, pending, approve/reject, settings).
2. **Duration sources:** `extractVideoDetails` + `/api/yt/video` + playlist durations + tests.
3. **Client rules helper** + tests.
4. **UI:** Settings section + Header gate; RoomShell split; PendingQueue; MyPending; AddSong/SearchResults integration.
5. **Docs:** README v9.

## 11. Out of scope (YAGNI / future)

- Notifying a member when their song is rejected, or a rejection reason.
- Per-member pending caps; rate limits on requests.
- Matching keywords against channel names; regex/wildcards; per-keyword scopes.
- Approval history / audit log.
- A fourth layout column for the pending panel (it sits above the queue in the existing right column).
