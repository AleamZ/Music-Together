# Music Together v9 Implementation Plan — Room Rules (Max Duration · Approval Queue · Banned Keywords)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each room three Admin/DJ-configurable rules — a max video duration (default 10 min), an approval queue for members' songs, and banned title keywords — enforced server-side in the RPCs, with a settings section, a pending-approval panel, a "my pending" list, and rule-aware add flows in the UI.

**Architecture:** One additive migration (`0008`) adds three columns on `rooms`, a `status` column on `queue_items`, an internal rule checker (`_check_queue_rules`, errcode `23514`), a pending decision (`_queue_status_for`), and changes/adds the queue RPCs. A new key-free proxy (`/api/yt/video`) reads a pasted video's duration from its watch page, and the playlist parser now reads per-item durations, so every add carries a duration. A pure `lib/queue-rules.ts` mirrors the SQL rules for friendly client messages. UI: Settings gains a "Quy tắc hàng đợi" section (Admin + DJ), `RoomShell` splits the queue by status and renders `PendingQueue` (Admin/DJ) and `MyPending` (members), and `AddSong`/`SearchResults` pre-check rules and show pending notices.

**Tech Stack:** Next.js 16.2.9 (App Router route handlers), React 19, TS 5, Tailwind v4, Supabase Postgres (plpgsql, `unaccent`, `pgcrypto`) + Realtime, Vitest; local PostgreSQL 18 (`C:\Program Files\PostgreSQL\18`) for migration validation.

**Spec:** [docs/superpowers/specs/2026-09-21-music-together-v9-room-rules-design.md](../specs/2026-09-21-music-together-v9-room-rules-design.md).

## Global Constraints

- **Rules are enforced in SQL.** Every add path goes through `_check_queue_rules(room, title, duration)`; the client's `checkQueueRules` exists only to give friendly messages first. Error contract from SQL: errcode `23514` with message exactly `duration unknown` | `video too long` | `banned keyword: <kw>`.
- **Additive migration** `supabase/migrations/0008_v9_room_rules.sql`: `add column if not exists`, `create or replace function`, `create extension if not exists unaccent with schema extensions`, `create index if not exists`. No drops of tables/columns. Existing queue rows become `status = 'approved'`.
- **Defaults:** `max_duration_seconds` **600** (`0` = unlimited, max `86400`), `require_approval` **false**, `banned_keywords` `'{}'`. Keyword limits: each trimmed, ≤ **30** chars, ≤ **50** keywords, deduped case- and accent-insensitively (`lower(unaccent(...))`, same normalization as matching); invalid settings → errcode `22023`.
- **Pending rows** have `position = 0`; approval sets `position = max(approved position) + 1`. `advance_queue` only ever picks `status = 'approved'`. Admin/DJ additions are always `approved`; turning approval off auto-approves all pending rows in the same RPC.
- **`delete_item`** allows `admin_or_dj`, **or** the owner (`added_by_account_id`) of a `pending` row; anything else → errcode `42501`.
- **Key-free YouTube access** via same-origin proxies only; `/api/yt/video` uses the same headers as `/api/playlist` (`User-Agent`, `Accept-Language`, `Cookie: CONSENT=YES+1`), 8 s timeout, `revalidate: 86400`, 5 MB guard. Never send captured browser credentials.
- **Copy (Vietnamese, verbatim):** `Video dài hơn giới hạn {X} phút của phòng.` · `Không xác định được thời lượng — phòng đang giới hạn {X} phút.` · `Tiêu đề chứa từ khóa bị cấm: "{kw}".` · `Đã gửi, chờ Admin/DJ duyệt.` · `Đã thêm {N} bài từ playlist.` + ` Bỏ qua {M} bài (quá dài / từ khóa cấm).` · `Quy tắc hàng đợi` · `Thời lượng tối đa (phút)` · `0 = không giới hạn` · `Chờ duyệt` · `Bài của thành viên phải được Admin/DJ duyệt mới vào hàng đợi.` · `Từ khóa cấm` · `So khớp theo tiêu đề video, không phân biệt hoa/thường và dấu.` · `Lưu` · `Không lưu được cài đặt.` · `Đã lưu quy tắc.` · `⏳ Chờ duyệt · {N}` · `Duyệt tất cả` · `Không có bài chờ duyệt.` · `⏳ Đang chờ duyệt · {N}` · `Thao tác không thành công, thử lại nhé.` · row labels `quá dài` / `không rõ thời lượng` / `từ khóa cấm` · `✓ Đã gửi`; button titles `Duyệt`, `Từ chối`, `Rút lại`, `Bỏ`.
- **Theme tokens only** (`cream`, `parchment`, `parchment-200`, `gold`, `gold-200`, `ink`, `burgundy`, `burgundy-accent`, `font-cormorant`, `font-playfair`); no new CSS. Every new `<img>` carries `{/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here */}`.
- **Lint gate:** `npm run lint` = 0 errors and exactly the 3 pre-existing warnings (NowPlaying.tsx, Queue.tsx, useDjController.ts — never touch those); `npx tsc --noEmit` clean; `npm test` green. React-Compiler hook rules are on: no state setter called synchronously in a `useEffect` body; never read `ref.current` during render.
- **Next.js 16.2.9 is not the Next.js you know** — read the relevant guide under `node_modules/next/dist/docs/01-app/` before writing a route handler (Task 3).
- **Commits** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Branch:** `feat/v9-room-rules` from `main` (v8 merged). The migration must be applied to the live Supabase project by the user (SQL editor) before the manual check; the integration tests skip without `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`.

---

## File map (v9)

```
supabase/migrations/0008_v9_room_rules.sql   # CREATE: columns, unaccent, _check_queue_rules, _queue_status_for, _approve_all, changed + new RPCs, grants   (Task 1)
lib/supabase.ts                              # MODIFY: Room/QueueItem fields; addQueueItems duration; approve/reject/settings wrappers                   (Task 2)
tests/integration/v5.test.ts                 # MODIFY: batch items carry duration (default 10-min limit would reject them)                              (Task 2)
tests/integration/v9.test.ts                 # CREATE: rules, pending, approve/reject, withdraw, advance skip, settings                                (Task 2)
lib/youtube/embedded-json.ts                 # CREATE: sliceBalancedJson + extractEmbeddedJson (shared by playlist + video parsers)                    (Task 3)
lib/youtube/playlist.ts                      # MODIFY: use embedded-json; durationSeconds per item (both layouts)                                      (Task 3, Task 4)
lib/youtube/video.ts                         # CREATE: VideoDetails, extractVideoDetails (pure), fetchVideoDetails (client)                            (Task 3)
app/api/yt/video/route.ts                    # CREATE: watch-page proxy → videoDetails                                                                 (Task 3)
tests/unit/video.test.ts                     # CREATE                                                                                                  (Task 3)
tests/unit/playlist.test.ts                  # MODIFY: duration cases                                                                                  (Task 4)
lib/queue-rules.ts                           # CREATE: RoomRules, RuleViolation, normalizeForMatch, checkQueueRules, ruleMessage, violationFromRpcError (Task 5)
tests/unit/queue-rules.test.ts               # CREATE                                                                                                  (Task 5)
components/room/Header.tsx                   # MODIFY: isDj prop; settings button for admin OR dj; pass isAdmin to dialog                              (Task 6)
components/room/SettingsDialog.tsx           # MODIFY: admin-only sections gated; new "Quy tắc hàng đợi" section                                       (Task 6)
components/room/RoomShell.tsx                # MODIFY: pass isDj (Task 6); queue split, PendingQueue/MyPending (Task 7); rules/willPend to AddSong (Task 8)
components/room/PendingQueue.tsx             # CREATE: admin/dj pending panel                                                                          (Task 7)
components/room/MyPending.tsx                # CREATE: member's own pending list (withdraw)                                                            (Task 7)
components/room/AddSong.tsx                  # MODIFY: video-details first, pre-check rules, pending notice, playlist skip count                       (Task 8)
components/room/SearchResults.tsx            # MODIFY: rule-violating rows disabled with reason; "✓ Đã gửi" when pending                              (Task 8)
README.md                                    # MODIFY: v9 section                                                                                      (Task 9)
```

---

# Phase 1 — Database

## Task 1: Migration `0008_v9_room_rules.sql` + local validation

**Files:**
- Create: `supabase/migrations/0008_v9_room_rules.sql`

**Interfaces:**
- Consumes: existing `_auth(room, token, role)` (returns the caller's member id), `_auth_account(token)`, tables `rooms`, `queue_items`, `accounts`.
- Produces (used by Task 2 wrappers and all UI):
  - columns `rooms.max_duration_seconds int`, `rooms.require_approval bool`, `rooms.banned_keywords text[]`, `queue_items.status text ('pending'|'approved')`
  - `add_queue_item(uuid,text,text,text,text,integer) returns uuid` — unchanged signature; now rule-checked + pending-aware
  - `add_queue_items(uuid,text,jsonb) returns int` — elements `{video_id,title,thumb,duration}`; violators skipped
  - `advance_queue(uuid,text)` — approved only
  - `delete_item(uuid,text,uuid)` — owner may delete own pending
  - `approve_queue_item(uuid,text,uuid) returns void`, `approve_all_pending(uuid,text) returns int`, `reject_queue_item(uuid,text,uuid) returns void`, `update_room_settings(uuid,text,integer,boolean,text[]) returns void`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/v9-room-rules
```

- [ ] **Step 2: Create `supabase/migrations/0008_v9_room_rules.sql`**

```sql
-- =========================================================
-- 0008_v9_room_rules.sql — v9: room rules (max duration, approval queue, banned keywords). ADDITIVE (no data drop).
-- Existing queue rows become status = 'approved'.
-- =========================================================
create extension if not exists unaccent with schema extensions;

-- ---------- A. Schema ----------
alter table public.rooms
  add column if not exists max_duration_seconds integer not null default 600,   -- 0 = unlimited
  add column if not exists require_approval     boolean not null default false,
  add column if not exists banned_keywords      text[]  not null default '{}';

alter table public.queue_items add column if not exists status text not null default 'approved';
alter table public.queue_items drop constraint if exists queue_items_status_check;
alter table public.queue_items add constraint queue_items_status_check check (status in ('pending','approved'));
create index if not exists queue_items_room_status_idx on public.queue_items (room_id, status);

-- ---------- B. Internal helpers (not callable by clients) ----------
-- Raises errcode 23514 with one of: 'duration unknown' | 'video too long' | 'banned keyword: <kw>'.
create or replace function public._check_queue_rules(p_room_id uuid, p_title text, p_duration integer)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_max integer; v_kw text; v_title text;
begin
  select max_duration_seconds into v_max from public.rooms where id = p_room_id;
  if coalesce(v_max, 0) > 0 then
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

-- 'pending' when the room requires approval and the member is neither admin nor dj; else 'approved'.
create or replace function public._queue_status_for(p_room_id uuid, p_member_id uuid) returns text
language sql security definer set search_path = public, extensions
as $$
  select case when r.require_approval
               and p_member_id is distinct from r.admin_member_id
               and p_member_id is distinct from r.dj_member_id
              then 'pending' else 'approved' end
  from public.rooms r where r.id = p_room_id;
$$;
revoke all on function public._queue_status_for(uuid,uuid) from public, anon, authenticated;

-- Approve every pending row of a room in request order; returns the count.
create or replace function public._approve_all(p_room_id uuid) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision; v_row record; v_count int := 0;
begin
  select coalesce(max(position), 0) into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_row in select id from public.queue_items where room_id = p_room_id and status = 'pending' order by created_at, id loop
    v_pos := v_pos + 1;
    update public.queue_items set status = 'approved', position = v_pos where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public._approve_all(uuid) from public, anon, authenticated;

-- ---------- C. add_queue_item: rules + pending ----------
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_name text; v_status text; v_pos double precision; v_id uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  perform public._check_queue_rules(p_room_id, p_title, p_duration);
  v_status := public._queue_status_for(p_room_id, v_member);
  if v_status = 'pending' then
    v_pos := 0;
  else
    select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  end if;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, v_account, v_name, v_pos, v_status)
  returning id into v_id;
  return v_id;
end; $$;

-- ---------- D. add_queue_items (playlist): elements { video_id, title, thumb, duration }; violators are skipped ----------
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_title := coalesce(nullif(v_item->>'title', ''), v_item->>'video_id');
    v_duration := case when jsonb_typeof(v_item->'duration') = 'number' then (v_item->>'duration')::int else null end;
    begin
      perform public._check_queue_rules(p_room_id, v_title, v_duration);
    exception when check_violation then
      continue;   -- skip this element, keep going
    end;
    v_idx := v_idx + 1;
    insert into public.queue_items
      (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
    values (
      p_room_id, v_item->>'video_id', v_title, nullif(v_item->>'thumb', ''), v_duration,
      v_account, v_name,
      case when v_status = 'pending' then 0 else v_base + v_idx end,
      v_status
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- E. advance_queue: approved rows only ----------
create or replace function public.advance_queue(p_room_id uuid, p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur public.queue_items%rowtype; v_mode text; v_next uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'dj');
  select play_mode into v_mode from public.rooms where id = p_room_id;
  select qi.* into v_cur from public.queue_items qi
  join public.rooms r on r.current_item_id = qi.id where r.id = p_room_id;
  if found then
    insert into public.play_history (room_id, youtube_video_id, title, added_by_name)
    values (p_room_id, v_cur.youtube_video_id, v_cur.title, v_cur.added_by_name);
    update public.rooms set current_item_id = null where id = p_room_id;
    delete from public.queue_items where id = v_cur.id;
  end if;
  if v_mode = 'shuffle' then
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by random() limit 1;
  else
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by position asc limit 1;
  end if;
  update public.rooms set
    current_item_id = v_next,
    started_at = case when v_next is not null then now() else null end,
    is_playing = v_next is not null, paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end; $$;

-- ---------- F. delete_item: admin/dj, or the owner of a pending row (withdraw) ----------
create or replace function public.delete_item(
  p_room_id uuid, p_session_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_admin uuid; v_dj uuid; v_status text; v_owner uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select admin_member_id, dj_member_id into v_admin, v_dj from public.rooms where id = p_room_id;
  select status, added_by_account_id into v_status, v_owner
    from public.queue_items where id = p_item_id and room_id = p_room_id;
  if not found then return; end if;
  if v_member is distinct from v_admin and v_member is distinct from v_dj
     and not (v_status = 'pending' and v_owner = v_account) then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms where id = p_room_id and current_item_id = p_item_id) then
    raise exception 'cannot delete the currently playing item' using errcode = '42501';
  end if;
  delete from public.queue_items where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- G. Approval + settings RPCs (admin_or_dj) ----------
create or replace function public.approve_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  update public.queue_items set status = 'approved', position = v_pos
  where id = p_item_id and room_id = p_room_id and status = 'pending';
end; $$;

create or replace function public.approve_all_pending(p_room_id uuid, p_session_token text)
returns int language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  return public._approve_all(p_room_id);
end; $$;

create or replace function public.reject_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  delete from public.queue_items where id = p_item_id and room_id = p_room_id and status = 'pending';
end; $$;

-- Validates and stores the three rules. Turning approval OFF approves everything still pending.
create or replace function public.update_room_settings(
  p_room_id uuid, p_session_token text,
  p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[]
) returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_kws text[] := '{}'; v_kw text; v_clean text;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  if p_max_duration_seconds is null or p_max_duration_seconds < 0 or p_max_duration_seconds > 86400 then
    raise exception 'invalid max duration' using errcode = '22023';
  end if;
  foreach v_kw in array coalesce(p_banned_keywords, '{}'::text[]) loop
    v_clean := btrim(v_kw);
    if v_clean = '' then continue; end if;
    if length(v_clean) > 30 then raise exception 'keyword too long' using errcode = '22023'; end if;
    if exists (select 1 from unnest(v_kws) k where lower(extensions.unaccent(k)) = lower(extensions.unaccent(v_clean))) then continue; end if;
    v_kws := array_append(v_kws, v_clean);
  end loop;
  if coalesce(array_length(v_kws, 1), 0) > 50 then raise exception 'too many keywords' using errcode = '22023'; end if;
  update public.rooms set
    max_duration_seconds = p_max_duration_seconds,
    require_approval = coalesce(p_require_approval, false),
    banned_keywords = v_kws
  where id = p_room_id;
  if not coalesce(p_require_approval, false) then
    perform public._approve_all(p_room_id);
  end if;
end; $$;

grant execute on function public.approve_queue_item(uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.approve_all_pending(uuid,text)                            to anon, authenticated;
grant execute on function public.reject_queue_item(uuid,text,uuid)                        to anon, authenticated;
grant execute on function public.update_room_settings(uuid,text,integer,boolean,text[])   to anon, authenticated;
```

- [ ] **Step 3: Validate on a throwaway local PostgreSQL 18 cluster (no Supabase needed)**

A cluster may already be running on port **5499** from planning (data dir `<scratchpad>/pg-v9`, database `mt` with migrations 0004–0007 applied). Check, and create it if not:

```bash
PGBIN="/c/Program Files/PostgreSQL/18/bin"
psql() { "$PGBIN/psql.exe" -h 127.0.0.1 -p 5499 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql -c "select 1" >/dev/null 2>&1 && echo "cluster up" || {
  PGDATA="${TMPDIR:-/tmp}/mt-pg-v9"; rm -rf "$PGDATA"
  "$PGBIN/initdb.exe" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --no-locale >/dev/null
  "$PGBIN/pg_ctl.exe" -D "$PGDATA" -o "-p 5499 -c listen_addresses=127.0.0.1" -l "$PGDATA/log" -w start >/dev/null
  psql -c "create database mt"
  psql -d mt -c "create schema if not exists extensions; create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
  for f in 0004 0005 0006 0007; do psql -d mt -f supabase/migrations/${f}_*.sql >/dev/null && echo "$f ok"; done
}
```

Apply the new migration **twice** (proves idempotence), then run the smoke script:

```bash
psql -d mt -f supabase/migrations/0008_v9_room_rules.sql && psql -d mt -f supabase/migrations/0008_v9_room_rules.sql && echo "0008 applied twice OK"
```

Write `${TMPDIR:-/tmp}/v9-smoke.sql` with this content and run `psql -d mt -f "${TMPDIR:-/tmp}/v9-smoke.sql"`:

```sql
do $$
declare
  a record; m record; m2 record; r record; j record;
  ok boolean; v_status text; v_pos double precision; v_cnt int; cur uuid;
  id_mem uuid; id_adm uuid; id_w uuid; id_rej uuid; id_auto uuid; kws text[]; sfx text;
begin
  sfx := floor(random() * 1e9)::text;
  select * into a  from public.register('v9adm' || sfx, 'pw123456');
  select * into m  from public.register('v9mem' || sfx, 'pw123456');
  select * into m2 from public.register('v9oth' || sfx, 'pw123456');
  select * into r  from public.create_room('R', 'secret', a.token);
  select * into j  from public.join_room(r.code, 'secret', m.token);
  perform public.join_room(r.code, 'secret', m2.token);

  -- 1. default limit 600: too long
  ok := false;
  begin perform public.add_queue_item(r.room_id, m.token, 'v1', 'Long', null, 601);
  exception when check_violation then ok := (sqlerrm = 'video too long'); end;
  assert ok, '1: expected video too long';
  -- 2. unknown duration rejected while a limit is set
  ok := false;
  begin perform public.add_queue_item(r.room_id, m.token, 'v2', 'Unknown', null, null);
  exception when check_violation then ok := (sqlerrm = 'duration unknown'); end;
  assert ok, '2: expected duration unknown';
  -- 3. member cannot change settings
  ok := false;
  begin perform public.update_room_settings(r.room_id, m.token, 0, false, '{}');
  exception when insufficient_privilege then ok := true; end;
  assert ok, '3: member must not update settings';
  -- 4. invalid max → 22023
  ok := false;
  begin perform public.update_room_settings(r.room_id, a.token, -1, false, '{}');
  exception when invalid_parameter_value then ok := true; end;
  assert ok, '4: negative max must be rejected';
  -- 5. admin sets: unlimited, approval on, keywords trimmed + deduped
  perform public.update_room_settings(r.room_id, a.token, 0, true, array['  Nhạc Chế ', 'nhac che', 'karaoke', '']);
  select banned_keywords into kws from public.rooms where id = r.room_id;
  assert kws = array['Nhạc Chế', 'karaoke'], '5: keywords trimmed/deduped, got ' || kws::text;
  -- 6. banned keyword, accent/case-insensitive
  ok := false;
  begin perform public.add_queue_item(r.room_id, m.token, 'v3', 'NHAC CHE hay nhat', null, 100);
  exception when check_violation then ok := (sqlerrm like 'banned keyword:%'); end;
  assert ok, '6: expected banned keyword';
  -- 7. member add → pending (position 0); admin add → approved; unlimited allows null duration
  id_mem := public.add_queue_item(r.room_id, m.token, 'v4', 'Member song', null, 100);
  select status, position into v_status, v_pos from public.queue_items where id = id_mem;
  assert v_status = 'pending' and v_pos = 0, '7a: member add should be pending at position 0';
  id_adm := public.add_queue_item(r.room_id, a.token, 'v5', 'Admin song', null, null);
  select status into v_status from public.queue_items where id = id_adm;
  assert v_status = 'approved', '7b: admin add should be approved';
  -- 8. advance_queue (admin is dj on create) picks approved only
  perform public.advance_queue(r.room_id, a.token);
  select current_item_id into cur from public.rooms where id = r.room_id;
  assert cur = id_adm, '8a: advance should pick the approved song';
  perform public.advance_queue(r.room_id, a.token);
  select current_item_id into cur from public.rooms where id = r.room_id;
  assert cur is null, '8b: advance must not pick a pending song';
  -- 9. owner withdraws own pending; another member cannot delete it
  id_w := public.add_queue_item(r.room_id, m.token, 'v6', 'Withdraw me', null, 100);
  perform public.delete_item(r.room_id, m.token, id_w);
  assert not exists (select 1 from public.queue_items where id = id_w), '9a: own pending withdrawn';
  ok := false;
  begin perform public.delete_item(r.room_id, m2.token, id_mem);
  exception when insufficient_privilege then ok := true; end;
  assert ok, '9b: another member cannot delete';
  -- 10. approve one → approved with a position after the queue
  perform public.approve_queue_item(r.room_id, a.token, id_mem);
  select status, position into v_status, v_pos from public.queue_items where id = id_mem;
  assert v_status = 'approved' and v_pos >= 1, '10: approved with position';
  -- 11. reject deletes
  id_rej := public.add_queue_item(r.room_id, m.token, 'v7', 'Reject me', null, 100);
  perform public.reject_queue_item(r.room_id, a.token, id_rej);
  assert not exists (select 1 from public.queue_items where id = id_rej), '11: rejected row deleted';
  -- 12. batch with limit 600 + keyword: violators skipped, member rows pending
  perform public.update_room_settings(r.room_id, a.token, 600, true, array['karaoke']);
  v_cnt := public.add_queue_items(r.room_id, m.token,
    '[{"video_id":"b1","title":"ok","thumb":null,"duration":100},
      {"video_id":"b2","title":"too long","duration":700},
      {"video_id":"b3","title":"Karaoke x","duration":100},
      {"video_id":"b4","title":"no duration"}]'::jsonb);
  assert v_cnt = 1, '12a: batch should insert 1, got ' || v_cnt;
  select status into v_status from public.queue_items where room_id = r.room_id and youtube_video_id = 'b1';
  assert v_status = 'pending', '12b: batch member rows pending';
  -- 13. approve all
  v_cnt := public.approve_all_pending(r.room_id, a.token);
  assert v_cnt = 1, '13: approve_all should approve 1, got ' || v_cnt;
  assert not exists (select 1 from public.queue_items where room_id = r.room_id and status = 'pending'), '13b: nothing pending';
  -- 14. turning approval off auto-approves
  id_auto := public.add_queue_item(r.room_id, m.token, 'v8', 'Pending then auto', null, 100);
  perform public.update_room_settings(r.room_id, a.token, 600, false, '{}');
  select status into v_status from public.queue_items where id = id_auto;
  assert v_status = 'approved', '14: approval off → auto-approved';
  raise notice 'v9 smoke: all 14 checks passed';
end $$;
```

Expected: the last line printed is `NOTICE:  v9 smoke: all 14 checks passed` and psql exits 0. If any `assert` fails, fix the migration (not the script) and re-run from the "apply twice" step (the migration is idempotent, so re-applying is safe; the smoke script registers fresh users each run).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_v9_room_rules.sql
git commit -m "feat: v9 migration — room rules, pending status, approval RPCs, rule-checked adds

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Supabase wrappers/types + integration tests

**Files:**
- Modify: `lib/supabase.ts` (types `Room`, `QueueItem`; `addQueueItems`; new wrappers)
- Modify: `tests/integration/v5.test.ts` (items carry `duration`)
- Create: `tests/integration/v9.test.ts`

**Interfaces:**
- Consumes: Task 1 RPCs.
- Produces (used by Tasks 6–8):
  ```ts
  export interface Room { …existing…; max_duration_seconds: number; require_approval: boolean; banned_keywords: string[] }
  export type QueueStatus = "pending" | "approved";
  export interface QueueItem { …existing…; status: QueueStatus }
  export async function addQueueItems(roomId, token, items: Array<{ videoId: string; title: string; thumb: string | null; duration?: number | null }>): Promise<number>
  export async function approveQueueItem(roomId: string, token: string, itemId: string): Promise<void>
  export async function approveAllPending(roomId: string, token: string): Promise<number>
  export async function rejectQueueItem(roomId: string, token: string, itemId: string): Promise<void>
  export interface RoomSettings { maxDurationSeconds: number; requireApproval: boolean; bannedKeywords: string[] }
  export async function updateRoomSettings(roomId: string, token: string, s: RoomSettings): Promise<void>
  ```

- [ ] **Step 1: Types in `lib/supabase.ts`**

Replace the `Room` interface with:

```ts
export interface Room {
  id: string; code: string; name: string; play_mode: PlayMode;
  admin_member_id: string | null; dj_member_id: string | null;
  current_item_id: string | null; is_playing: boolean;
  started_at: string | null; paused_elapsed_ms: number; created_at: string;
  max_duration_seconds: number; require_approval: boolean; banned_keywords: string[];
}
```

and the `QueueItem` interface with:

```ts
export type QueueStatus = "pending" | "approved";
export interface QueueItem {
  id: string; room_id: string; youtube_video_id: string; title: string;
  thumbnail_url: string | null; duration_seconds: number | null;
  added_by_account_id: string | null; added_by_name: string;
  position: number; created_at: string; status: QueueStatus;
}
```

- [ ] **Step 2: `addQueueItems` carries duration** — replace the function with:

```ts
export async function addQueueItems(
  roomId: string, token: string,
  items: Array<{ videoId: string; title: string; thumb: string | null; duration?: number | null }>,
): Promise<number> {
  const payload = items.map((it) => ({ video_id: it.videoId, title: it.title, thumb: it.thumb, duration: it.duration ?? null }));
  const { data, error } = await supabase.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: payload });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}
```

- [ ] **Step 3: New wrappers** — append after `deleteItem`:

```ts
export async function approveQueueItem(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("approve_queue_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export async function approveAllPending(roomId: string, token: string): Promise<number> {
  const { data, error } = await supabase.rpc("approve_all_pending", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}
export async function rejectQueueItem(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("reject_queue_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export interface RoomSettings { maxDurationSeconds: number; requireApproval: boolean; bannedKeywords: string[] }
export async function updateRoomSettings(roomId: string, token: string, s: RoomSettings) {
  const { error } = await supabase.rpc("update_room_settings", {
    p_room_id: roomId, p_session_token: token,
    p_max_duration_seconds: s.maxDurationSeconds, p_require_approval: s.requireApproval, p_banned_keywords: s.bannedKeywords,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Fix the v5 integration fixture** — in `tests/integration/v5.test.ts` the `items` array has no durations; with the new default 10-minute limit the RPC would skip them all. Change it to:

```ts
  const items = [
    { video_id: "aaaaaaaaaaa", title: "A", thumb: "ta", duration: 60 },
    { video_id: "bbbbbbbbbbb", title: "B", thumb: "tb", duration: 60 },
    { video_id: "ccccccccccc", title: "C", thumb: null, duration: 60 },
  ];
```

- [ ] **Step 5: Create `tests/integration/v9.test.ts`** (same harness style as v5; skips without env):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v9 room rules", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const createRoom = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: "R", p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };
  const join = async (code: string, token: string) => {
    const { error } = await db.rpc("join_room", { p_code: code, p_password: "secret", p_session_token: token });
    if (error) throw error;
  };
  const add = (roomId: string, token: string, videoId: string, title: string, duration: number | null) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: title, p_thumb: null, p_duration: duration });
  const settings = (roomId: string, token: string, max: number, approval: boolean, kws: string[]) =>
    db.rpc("update_room_settings", { p_room_id: roomId, p_session_token: token, p_max_duration_seconds: max, p_require_approval: approval, p_banned_keywords: kws });
  const row = async (id: string) => {
    const { data } = await db.from("queue_items").select("status, position").eq("id", id).maybeSingle();
    return data as { status: string; position: number } | null;
  };

  it("enforces the default 10-minute limit and unknown durations", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const tooLong = await add(room.room_id, admin.token, "v1", "Long", 601);
    expect(tooLong.error?.code).toBe("23514"); expect(tooLong.error?.message).toBe("video too long");
    const unknown = await add(room.room_id, admin.token, "v2", "Unknown", null);
    expect(unknown.error?.code).toBe("23514"); expect(unknown.error?.message).toBe("duration unknown");
    const ok = await add(room.room_id, admin.token, "v3", "Fine", 599);
    expect(ok.error).toBeNull();
  });

  it("settings: admin/dj only, validated, keywords trimmed + deduped (accent-insensitive); 0 = unlimited", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, member.token, 0, false, [])).error?.code).toBe("42501");
    expect((await settings(room.room_id, admin.token, -1, false, [])).error?.code).toBe("22023");
    expect((await settings(room.room_id, admin.token, 0, false, ["  Nhạc Chế ", "nhac che", "karaoke", ""])).error).toBeNull();
    const { data } = await db.from("rooms").select("max_duration_seconds, require_approval, banned_keywords").eq("id", room.room_id).single();
    expect(data).toEqual({ max_duration_seconds: 0, require_approval: false, banned_keywords: ["Nhạc Chế", "karaoke"] });
    expect((await add(room.room_id, admin.token, "v4", "No duration is fine when unlimited", null)).error).toBeNull();
  });

  it("banned keywords match the title case- and accent-insensitively", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    await settings(room.room_id, admin.token, 0, false, ["nhạc chế"]);
    const banned = await add(room.room_id, admin.token, "v5", "NHAC CHE hay nhất", 100);
    expect(banned.error?.code).toBe("23514"); expect(banned.error?.message).toBe("banned keyword: nhạc chế");
  });

  it("approval: member rows pend, admin rows do not; approve / reject / approve-all; advance skips pending", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    await settings(room.room_id, admin.token, 0, true, []);
    const { data: memId } = await add(room.room_id, member.token, "m1", "Member", 100);
    expect(await row(memId as string)).toEqual({ status: "pending", position: 0 });
    const { data: admId } = await add(room.room_id, admin.token, "a1", "Admin", 100);
    expect((await row(admId as string))?.status).toBe("approved");
    // advance (admin is dj on create) plays a1, then finds nothing approved
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    let { data: r } = await db.from("rooms").select("current_item_id").eq("id", room.room_id).single();
    expect(r?.current_item_id).toBe(admId);
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    ({ data: r } = await db.from("rooms").select("current_item_id").eq("id", room.room_id).single());
    expect(r?.current_item_id).toBeNull();
    // approve one
    expect((await db.rpc("approve_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: memId })).error).toBeNull();
    expect((await row(memId as string))?.status).toBe("approved");
    // reject
    const { data: rejId } = await add(room.room_id, member.token, "m2", "Reject", 100);
    await db.rpc("reject_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: rejId });
    expect(await row(rejId as string)).toBeNull();
    // approve all
    await add(room.room_id, member.token, "m3", "P1", 100); await add(room.room_id, member.token, "m4", "P2", 100);
    const { data: count } = await db.rpc("approve_all_pending", { p_room_id: room.room_id, p_session_token: admin.token });
    expect(count).toBe(2);
    // member cannot approve
    const { data: m5 } = await add(room.room_id, member.token, "m5", "P3", 100);
    expect((await db.rpc("approve_queue_item", { p_room_id: room.room_id, p_session_token: member.token, p_item_id: m5 })).error?.code).toBe("42501");
  });

  it("owner can withdraw own pending row; others cannot; approval off auto-approves", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    const other = await reg(uniq("oth")); await join(room.code, other.token);
    await settings(room.room_id, admin.token, 0, true, []);
    const { data: id1 } = await add(room.room_id, member.token, "w1", "Withdraw", 100);
    expect((await db.rpc("delete_item", { p_room_id: room.room_id, p_session_token: other.token, p_item_id: id1 })).error?.code).toBe("42501");
    expect((await db.rpc("delete_item", { p_room_id: room.room_id, p_session_token: member.token, p_item_id: id1 })).error).toBeNull();
    expect(await row(id1 as string)).toBeNull();
    const { data: id2 } = await add(room.room_id, member.token, "w2", "Auto", 100);
    await settings(room.room_id, admin.token, 0, false, []);
    expect((await row(id2 as string))?.status).toBe("approved");
  });

  it("batch add skips rule violators and pends member rows", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    await settings(room.room_id, admin.token, 600, true, ["karaoke"]);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "b1", title: "ok", thumb: null, duration: 100 },
      { video_id: "b2", title: "too long", thumb: null, duration: 700 },
      { video_id: "b3", title: "Karaoke x", thumb: null, duration: 100 },
      { video_id: "b4", title: "no duration", thumb: null },
    ] });
    expect(error).toBeNull(); expect(data).toBe(1);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, status").eq("room_id", room.room_id);
    expect(rows).toEqual([{ youtube_video_id: "b1", status: "pending" }]);
  });
});
```

- [ ] **Step 6: Gates**

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: tsc clean (if a test fixture constructs a `Room`/`QueueItem` literal and now fails typing, add `max_duration_seconds: 600, require_approval: false, banned_keywords: []` / `status: "approved"` to it); lint 0 errors / 3 baseline warnings; suite green with the v9 file reported as skipped (no env).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase.ts tests/integration/v5.test.ts tests/integration/v9.test.ts
git commit -m "feat: v9 supabase wrappers + types; integration tests for room rules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 2 — Duration sources

## Task 3: Watch-page video details (`/api/yt/video`) + shared embedded-JSON helper

**Files:**
- Create: `lib/youtube/embedded-json.ts`
- Modify: `lib/youtube/playlist.ts` (use the shared helper; behavior unchanged)
- Create: `lib/youtube/video.ts`
- Create: `app/api/yt/video/route.ts`
- Test: `tests/unit/video.test.ts` (and the existing `tests/unit/playlist.test.ts` must stay green)

**Interfaces:**
- Consumes: `parseYouTubeId` (`lib/youtube/parse.ts`).
- Produces (used by Task 4 and Task 8):
  ```ts
  // lib/youtube/embedded-json.ts
  export function sliceBalancedJson(s: string, start: number): string | null
  export function extractEmbeddedJson(html: string, markers: string[]): unknown   // null when not found / unparsable
  // lib/youtube/video.ts
  export interface VideoDetails { id: string; title: string; author: string; durationSeconds: number | null; isLive: boolean }
  export function extractVideoDetails(html: string): VideoDetails | null
  export async function fetchVideoDetails(id: string, signal?: AbortSignal): Promise<VideoDetails | null>
  // GET /api/yt/video?id= → 200 VideoDetails | 400 | 404 | 502 { error }
  ```

- [ ] **Step 1: Write the failing test** — create `tests/unit/video.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractVideoDetails } from "@/lib/youtube/video";

const page = (pr: unknown, marker = "var ytInitialPlayerResponse = ") =>
  `<!DOCTYPE html><html><head><script nonce="x">${marker}${JSON.stringify(pr)};var ytcfg = {};</script></head><body></body></html>`;

describe("extractVideoDetails", () => {
  it("reads id, title, author and lengthSeconds from ytInitialPlayerResponse", () => {
    expect(extractVideoDetails(page({ videoDetails: {
      videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", author: "Rick Astley", lengthSeconds: "212", isLiveContent: false,
    } }))).toEqual({ id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", author: "Rick Astley", durationSeconds: 212, isLive: false });
  });
  it("a live stream has no duration", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "live0000001", title: "Radio", author: "X", lengthSeconds: "0", isLive: true } })))
      .toEqual({ id: "live0000001", title: "Radio", author: "X", durationSeconds: null, isLive: true });
  });
  it("a finished live stream (isLiveContent) keeps its real length", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "vodvodvodvo", title: "VOD", author: "X", lengthSeconds: "3600", isLiveContent: true } }))?.durationSeconds).toBe(3600);
  });
  it("accepts the bare `ytInitialPlayerResponse = ` marker", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "abcabcabcab", title: "T", author: "A", lengthSeconds: "5" } }, "ytInitialPlayerResponse = "))?.id).toBe("abcabcabcab");
  });
  it("returns null when videoDetails is missing or the page is garbage", () => {
    expect(extractVideoDetails(page({ playabilityStatus: { status: "ERROR" } }))).toBeNull();
    expect(extractVideoDetails("<html>nothing here</html>")).toBeNull();
    expect(extractVideoDetails("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/unit/video.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/youtube/video"`.

- [ ] **Step 3: Create `lib/youtube/embedded-json.ts`** (moved verbatim from `playlist.ts`, generalized markers):

```ts
/** Return the balanced `{…}` JSON object starting at `start`, or null. String-aware. */
export function sliceBalancedJson(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/** Find the first marker present in `html` and parse the JSON object that follows it. null if none parses. */
export function extractEmbeddedJson(html: string, markers: string[]): unknown {
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i === -1) continue;
    const json = sliceBalancedJson(html, i + marker.length);
    if (!json) continue;
    try { return JSON.parse(json); } catch { /* try next marker */ }
  }
  return null;
}
```

- [ ] **Step 4: Refactor `lib/youtube/playlist.ts` to use it** — delete the private `sliceBalancedJson` and `extractYtInitialData` functions and replace with:

```ts
import { extractEmbeddedJson } from "@/lib/youtube/embedded-json";

const YT_INITIAL_DATA_MARKERS = ['var ytInitialData = ', 'window["ytInitialData"] = ', "ytInitialData = "];
```

and inside `extractPlaylistItems` change `const data = extractYtInitialData(html);` to `const data = extractEmbeddedJson(html, YT_INITIAL_DATA_MARKERS);`. Run `npx vitest run tests/unit/playlist.test.ts` — expected PASS (unchanged behavior).

- [ ] **Step 5: Create `lib/youtube/video.ts`**

```ts
import { extractEmbeddedJson } from "@/lib/youtube/embedded-json";

export interface VideoDetails {
  id: string;
  title: string;
  author: string;
  durationSeconds: number | null;
  isLive: boolean;
}

type PlayerResponse = {
  videoDetails?: { videoId?: unknown; title?: unknown; author?: unknown; lengthSeconds?: unknown; isLive?: unknown };
};

const MARKERS = ["var ytInitialPlayerResponse = ", 'window["ytInitialPlayerResponse"] = ', "ytInitialPlayerResponse = "];

/** Pure: read `videoDetails` out of a watch page. A live stream (or a zero length) has no duration.
 *  `isLiveContent` is deliberately ignored: a finished stream is a normal VOD with a real length. Fails soft to null. */
export function extractVideoDetails(html: string): VideoDetails | null {
  const data = extractEmbeddedJson(html, MARKERS) as PlayerResponse | null;
  const vd = data?.videoDetails;
  if (!vd || typeof vd.videoId !== "string" || !vd.videoId) return null;
  const isLive = vd.isLive === true;
  const raw = vd.lengthSeconds;
  const len = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  const durationSeconds = !isLive && Number.isFinite(len) && len > 0 ? len : null;
  return {
    id: vd.videoId,
    title: typeof vd.title === "string" ? vd.title : "",
    author: typeof vd.author === "string" ? vd.author : "",
    durationSeconds,
    isLive,
  };
}

/** Client: video details via the same-origin route. Resolves null on any failure (AbortError passes through). */
export async function fetchVideoDetails(id: string, signal?: AbortSignal): Promise<VideoDetails | null> {
  try {
    const res = await fetch(`/api/yt/video?id=${encodeURIComponent(id)}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as VideoDetails;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return null;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/video.test.ts tests/unit/playlist.test.ts
```

Expected: PASS (5 + existing).

- [ ] **Step 7: Read the Next docs, then create `app/api/yt/video/route.ts`**

Skim the Route Handlers guide and `fetch` reference under `node_modules/next/dist/docs/01-app/` (Task 3 of v8 confirmed `Response.json` and `next: { revalidate }` are current). Then:

```ts
import { parseYouTubeId } from "@/lib/youtube/parse";
import { extractVideoDetails } from "@/lib/youtube/video";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Key-free video details (title, author, duration) read from the public watch page. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = parseYouTubeId(searchParams.get("id") ?? "");
  if (!id) return Response.json({ error: "Invalid YouTube id" }, { status: 400 });
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      // CONSENT cookie skips YouTube's consent interstitial that a cookieless datacenter request may get.
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ error: "Video fetch failed" }, { status: 502 });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 5_000_000) return Response.json({ error: "Page too large" }, { status: 502 });
    const details = extractVideoDetails(await res.text());
    if (!details) return Response.json({ error: "Video not found" }, { status: 404 });
    return Response.json(details);
  } catch {
    return Response.json({ error: "Video request error" }, { status: 502 });
  }
}
```

- [ ] **Step 8: Live check** — start the dev server in the background (`npm run dev`, wait for "Ready"), then:

```bash
curl -s "http://localhost:3000/api/yt/video?id=dQw4w9WgXcQ"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/yt/video?id=nope"
```

Expected: `{"id":"dQw4w9WgXcQ","title":"Rick Astley - Never Gonna Give You Up (Official Video)…","author":"Rick Astley","durationSeconds":213,"isLive":false}` (exact title/length as YouTube reports today) and `400`. Stop the dev server afterwards and confirm port 3000 is free.

- [ ] **Step 9: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add lib/youtube/embedded-json.ts lib/youtube/playlist.ts lib/youtube/video.ts app/api/yt/video/route.ts tests/unit/video.test.ts
git commit -m "feat: /api/yt/video — key-free video details (duration) from the watch page; shared embedded-JSON helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Playlist items carry durations

**Files:**
- Modify: `lib/youtube/playlist.ts`
- Test: `tests/unit/playlist.test.ts`

**Interfaces:**
- Consumes: `parseDurationText` (`lib/youtube/search.ts`, v8).
- Produces (used by Task 8): `PlaylistItem { videoId; title; thumb; durationSeconds: number | null }` from both `extractPlaylistItems` and `fetchPlaylistItems`.

- [ ] **Step 1: Update the tests** — in `tests/unit/playlist.test.ts`:

In `FIXTURE`, give Song A `lengthSeconds: "272"` and Song B `lengthText: { simpleText: "1:02:15" }` (add the keys next to `title`). In `LOCKUP_FIXTURE`, give the first lockup a badge and leave the second without:

```ts
    { lockupViewModel: { contentId: "tNZegj60iLI", contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      contentImage: { thumbnailViewModel: { overlays: [
        { thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: "3:45", badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT" } }] } },
      ] } },
      metadata: { lockupMetadataViewModel: { title: { content: "01. Intro" } } } } },
```

Update the expectations:

```ts
    expect(items).toEqual([
      { videoId: "aaaaaaaaaaa", title: "Song A", thumb: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg", durationSeconds: 272 },
      { videoId: "bbbbbbbbbbb", title: "Song B", thumb: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg", durationSeconds: 3735 },
    ]);
```

```ts
    expect(items).toEqual([
      { videoId: "tNZegj60iLI", title: "01. Intro", thumb: "https://i.ytimg.com/vi/tNZegj60iLI/hqdefault.jpg", durationSeconds: 225 },
      { videoId: "xubKh9u0uDY", title: "02. Con Nít", thumb: "https://i.ytimg.com/vi/xubKh9u0uDY/hqdefault.jpg", durationSeconds: null },
    ]);
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run tests/unit/playlist.test.ts
```

Expected: FAIL — objects lack `durationSeconds`.

- [ ] **Step 3: Implement** in `lib/youtube/playlist.ts`:

Change the interface and renderer types:

```ts
import { parseDurationText } from "@/lib/youtube/search";

export interface PlaylistItem { videoId: string; title: string; thumb: string; durationSeconds: number | null; }

// Legacy playlist layout entry.
type VideoRenderer = {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  lengthSeconds?: unknown;
  lengthText?: { simpleText?: unknown };
};
// Current playlist layout entry (the "lockup" component).
type LockupViewModel = {
  contentId?: unknown;
  contentType?: unknown;
  contentImage?: unknown;
  metadata?: { lockupMetadataViewModel?: { title?: { content?: unknown } } };
};

const CLOCK_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

/** Depth-limited search for the first "m:ss" / "h:mm:ss" string under a node (the lockup's duration badge). */
function findClockText(node: unknown, depth = 8): string | null {
  if (depth < 0 || node === null || typeof node !== "object") return null;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (typeof v === "string") { if (CLOCK_RE.test(v)) return v; }
    else if (typeof v === "object") { const hit = findClockText(v, depth - 1); if (hit) return hit; }
  }
  return null;
}
```

Change `add` to accept a duration and the two call sites:

```ts
  const add = (videoId: string, title: string, durationSeconds: number | null): void => {
    if (!videoId || seen.has(videoId)) return;
    seen.add(videoId);
    out.push({ videoId, title, thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, durationSeconds });
  };
```

Legacy branch (after computing `title`):

```ts
      const secs = typeof pvr.lengthSeconds === "string" ? parseInt(pvr.lengthSeconds, 10) : NaN;
      const lt = pvr.lengthText?.simpleText;
      const durationSeconds = Number.isFinite(secs) && secs > 0 ? secs : parseDurationText(typeof lt === "string" ? lt : null);
      add(videoId, title, durationSeconds);
```

Lockup branch (after computing `title`):

```ts
      add(videoId, title, parseDurationText(findClockText(lvm.contentImage)));
```

`fetchPlaylistItems` needs no change (it passes the JSON through).

- [ ] **Step 4: Run to verify they pass, gates, commit**

```bash
npx vitest run tests/unit/playlist.test.ts
npx tsc --noEmit && npm run lint && npm test
git add lib/youtube/playlist.ts tests/unit/playlist.test.ts
git commit -m "feat: playlist items carry durationSeconds (lockup badge + legacy lengthSeconds)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3 — Client rules helper

## Task 5: `lib/queue-rules.ts`

**Files:**
- Create: `lib/queue-rules.ts`
- Test: `tests/unit/queue-rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 7–8):
  ```ts
  export interface RoomRules { max_duration_seconds: number; banned_keywords: string[] }
  export type RuleViolation =
    | { code: "too_long"; maxSeconds: number }
    | { code: "unknown_duration"; maxSeconds: number }
    | { code: "banned"; keyword: string };
  export function normalizeForMatch(s: string): string
  export function checkQueueRules(rules: RoomRules, item: { title: string; durationSeconds: number | null }): RuleViolation | null
  export function ruleMessage(v: RuleViolation): string
  export function violationFromRpcError(err: unknown, rules: RoomRules): RuleViolation | null
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/unit/queue-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkQueueRules, normalizeForMatch, ruleMessage, violationFromRpcError } from "@/lib/queue-rules";

const rules = (max: number, kws: string[] = []) => ({ max_duration_seconds: max, banned_keywords: kws });

describe("normalizeForMatch", () => {
  it("lower-cases and strips Vietnamese diacritics, including đ", () => {
    expect(normalizeForMatch("Nhạc Chế")).toBe("nhac che");
    expect(normalizeForMatch("ĐÀM VĨNH HƯNG")).toBe("dam vinh hung");
    expect(normalizeForMatch("  Karaoke ")).toBe("  karaoke ");
  });
});

describe("checkQueueRules", () => {
  it("rejects videos over the limit, allows the boundary", () => {
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: 601 })).toEqual({ code: "too_long", maxSeconds: 600 });
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: 600 })).toBeNull();
  });
  it("rejects unknown durations only while a limit is set", () => {
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: null })).toEqual({ code: "unknown_duration", maxSeconds: 600 });
    expect(checkQueueRules(rules(0), { title: "x", durationSeconds: null })).toBeNull();
    expect(checkQueueRules(rules(0), { title: "x", durationSeconds: 99999 })).toBeNull();
  });
  it("matches banned keywords case- and accent-insensitively and reports the first configured match", () => {
    expect(checkQueueRules(rules(0, ["karaoke", "nhạc chế"]), { title: "NHAC CHE Karaoke 2026", durationSeconds: 10 }))
      .toEqual({ code: "banned", keyword: "karaoke" });
    expect(checkQueueRules(rules(0, ["Nhạc Chế"]), { title: "nhac che hay", durationSeconds: 10 })).toEqual({ code: "banned", keyword: "Nhạc Chế" });
    expect(checkQueueRules(rules(0, [" ", ""]), { title: "anything", durationSeconds: 10 })).toBeNull();
    expect(checkQueueRules(rules(0, ["remix"]), { title: "Original", durationSeconds: 10 })).toBeNull();
  });
  it("checks duration before keywords (same order as SQL)", () => {
    expect(checkQueueRules(rules(60, ["x"]), { title: "x", durationSeconds: 61 })?.code).toBe("too_long");
  });
});

describe("ruleMessage", () => {
  it("renders the Vietnamese copy with minutes", () => {
    expect(ruleMessage({ code: "too_long", maxSeconds: 600 })).toBe("Video dài hơn giới hạn 10 phút của phòng.");
    expect(ruleMessage({ code: "unknown_duration", maxSeconds: 90 })).toBe("Không xác định được thời lượng — phòng đang giới hạn 2 phút.");
    expect(ruleMessage({ code: "banned", keyword: "karaoke" })).toBe('Tiêu đề chứa từ khóa bị cấm: "karaoke".');
  });
});

describe("violationFromRpcError", () => {
  it("maps the three 23514 messages and ignores everything else", () => {
    expect(violationFromRpcError({ code: "23514", message: "video too long" }, rules(600))).toEqual({ code: "too_long", maxSeconds: 600 });
    expect(violationFromRpcError({ code: "23514", message: "duration unknown" }, rules(600))).toEqual({ code: "unknown_duration", maxSeconds: 600 });
    expect(violationFromRpcError({ code: "23514", message: "banned keyword: nhạc chế" }, rules(0))).toEqual({ code: "banned", keyword: "nhạc chế" });
    expect(violationFromRpcError({ code: "42501", message: "admin or dj role required" }, rules(0))).toBeNull();
    expect(violationFromRpcError(new Error("network"), rules(0))).toBeNull();
    expect(violationFromRpcError(null, rules(0))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run tests/unit/queue-rules.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/queue-rules"`.

- [ ] **Step 3: Create `lib/queue-rules.ts`**

```ts
/** Client-side mirror of the SQL `_check_queue_rules` — for friendly messages BEFORE the RPC. The RPC remains the authority. */
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[] }

export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string };

/** lower-case + strip diacritics (NFD, drop combining marks) + đ→d, matching Postgres `lower(unaccent(...))`. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export function checkQueueRules(
  rules: RoomRules,
  item: { title: string; durationSeconds: number | null },
): RuleViolation | null {
  const max = rules.max_duration_seconds;
  if (max > 0) {
    if (item.durationSeconds == null) return { code: "unknown_duration", maxSeconds: max };
    if (item.durationSeconds > max) return { code: "too_long", maxSeconds: max };
  }
  const title = normalizeForMatch(item.title ?? "");
  for (const kw of rules.banned_keywords) {
    const k = normalizeForMatch(kw.trim());
    if (k && title.includes(k)) return { code: "banned", keyword: kw };
  }
  return null;
}

const minutes = (s: number) => Math.round(s / 60);

export function ruleMessage(v: RuleViolation): string {
  switch (v.code) {
    case "too_long": return `Video dài hơn giới hạn ${minutes(v.maxSeconds)} phút của phòng.`;
    case "unknown_duration": return `Không xác định được thời lượng — phòng đang giới hạn ${minutes(v.maxSeconds)} phút.`;
    case "banned": return `Tiêu đề chứa từ khóa bị cấm: "${v.keyword}".`;
  }
}

/** Map a Supabase RPC error raised by `_check_queue_rules` (errcode 23514) to a violation; anything else → null. */
export function violationFromRpcError(err: unknown, rules: RoomRules): RuleViolation | null {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object" || e.code !== "23514" || typeof e.message !== "string") return null;
  if (e.message === "video too long") return { code: "too_long", maxSeconds: rules.max_duration_seconds };
  if (e.message === "duration unknown") return { code: "unknown_duration", maxSeconds: rules.max_duration_seconds };
  const m = /^banned keyword: (.+)$/.exec(e.message);
  return m ? { code: "banned", keyword: m[1] } : null;
}
```

- [ ] **Step 4: Run to verify they pass, gates, commit**

```bash
npx vitest run tests/unit/queue-rules.test.ts
npx tsc --noEmit && npm run lint && npm test
git add lib/queue-rules.ts tests/unit/queue-rules.test.ts
git commit -m "feat: queue-rules — client mirror of the SQL rules with Vietnamese messages (pure, tested)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 4 — UI

## Task 6: Settings section (Admin + DJ) — `SettingsDialog.tsx`, `Header.tsx`, `RoomShell.tsx`

**Files:**
- Modify: `components/room/SettingsDialog.tsx` (replace whole file)
- Modify: `components/room/Header.tsx` (props + gate)
- Modify: `components/room/RoomShell.tsx` (one line: pass `isDj`)

**Interfaces:**
- Consumes: `updateRoomSettings`, `Room` fields (Task 2).
- Produces: `Header` props `{ room, members, isAdmin, isDj, roomId, token, myMemberId }`; `SettingsDialog` props gain `isAdmin: boolean`.

- [ ] **Step 1: Replace `components/room/SettingsDialog.tsx` with:**

```tsx
"use client";

import { useState } from "react";
import { assignDj, kickMember, renameRoom, transferAdmin, updateRoomSettings, type Member, type Room } from "@/lib/supabase";
import { normalizeForMatch } from "@/lib/queue-rules";

const MAX_KEYWORD_LEN = 30;
const MAX_KEYWORDS = 50;
const MAX_MINUTES = 1440;

export default function SettingsDialog({ room, members, roomId, token, myMemberId, isAdmin, onClose }: {
  room: Room; members: Member[]; roomId: string; token: string; myMemberId: string | null; isAdmin: boolean; onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const others = members.filter((m) => m.id !== myMemberId);

  // Queue rules (admin + dj). Values are snapshotted when the dialog opens.
  const [maxMinutes, setMaxMinutes] = useState(String(Math.round(room.max_duration_seconds / 60)));
  const [requireApproval, setRequireApproval] = useState(room.require_approval);
  const [keywords, setKeywords] = useState<string[]>(room.banned_keywords);
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function addKeyword() {
    const k = kwInput.trim();
    if (!k) return;
    if (k.length > MAX_KEYWORD_LEN) { setRulesMsg({ ok: false, text: `Từ khóa tối đa ${MAX_KEYWORD_LEN} ký tự.` }); return; }
    if (keywords.length >= MAX_KEYWORDS) { setRulesMsg({ ok: false, text: `Tối đa ${MAX_KEYWORDS} từ khóa.` }); return; }
    if (!keywords.some((x) => normalizeForMatch(x) === normalizeForMatch(k))) setKeywords([...keywords, k]);
    setKwInput("");
    setRulesMsg(null);
  }

  async function saveRules() {
    const mins = Number(maxMinutes);
    if (!Number.isFinite(mins) || mins < 0 || mins > MAX_MINUTES) {
      setRulesMsg({ ok: false, text: `Thời lượng tối đa phải từ 0 đến ${MAX_MINUTES} phút.` });
      return;
    }
    setSaving(true);
    setRulesMsg(null);
    try {
      await updateRoomSettings(roomId, token, { maxDurationSeconds: Math.round(mins * 60), requireApproval, bannedKeywords: keywords });
      setRulesMsg({ ok: true, text: "Đã lưu quy tắc." });
    } catch {
      setRulesMsg({ ok: false, text: "Không lưu được cài đặt." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">Cài đặt phòng</h3>

        {isAdmin && (
          <>
            <label className="mb-1 block text-sm text-ink">Tên phòng</label>
            <div className="mb-4 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
              <button onClick={() => renameRoom(roomId, token, name.trim())}
                className="rounded-lg bg-burgundy px-3 text-cream">Lưu</button>
            </div>

            <h4 className="mb-2 font-cormorant text-burgundy">Thành viên</h4>
            <ul className="mb-4 max-h-60 overflow-auto">
              {others.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-b border-dotted border-gold-200 py-1.5 text-sm">
                  <span className="text-ink">{m.username ?? "?"}{room.dj_member_id === m.id ? " · 🎧" : ""}</span>
                  <span className="flex gap-1">
                    {room.dj_member_id === m.id
                      ? <button onClick={() => assignDj(roomId, token, null)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Thu DJ</button>
                      : <button onClick={() => assignDj(roomId, token, m.id)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Giao DJ</button>}
                    <button onClick={() => { if (window.confirm(`Chuyển quyền Admin cho ${m.username ?? "?"}?`)) transferAdmin(roomId, token, m.id); }}
                      className="rounded border border-gold-200 px-2 text-xs text-burgundy">Trao Admin</button>
                    <button onClick={() => { if (window.confirm(`Kick ${m.username ?? "?"}?`)) kickMember(roomId, token, m.id); }}
                      className="rounded border border-gold-200 px-2 text-xs text-burgundy-accent">Kick</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h4 className="mb-2 font-cormorant text-burgundy">Quy tắc hàng đợi</h4>

        <label className="mb-1 block text-sm text-ink">Thời lượng tối đa (phút)</label>
        <input type="number" min={0} max={MAX_MINUTES} step={1} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}
          className="mb-1 w-28 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">0 = không giới hạn</p>

        <label className="mb-1 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
          Chờ duyệt
        </label>
        <p className="mb-3 text-[11px] text-ink/60">Bài của thành viên phải được Admin/DJ duyệt mới vào hàng đợi.</p>

        <label className="mb-1 block text-sm text-ink">Từ khóa cấm</label>
        {keywords.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-gold-200 bg-cream px-2 text-xs text-ink">
                {k}
                <button type="button" title="Bỏ" onClick={() => setKeywords(keywords.filter((x) => x !== k))} className="text-burgundy">✕</button>
              </span>
            ))}
          </div>
        )}
        <input value={kwInput} onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
          placeholder="Gõ từ khóa rồi Enter"
          className="mb-1 w-full rounded-lg border border-gold bg-cream px-3 py-1.5 text-sm text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">So khớp theo tiêu đề video, không phân biệt hoa/thường và dấu.</p>

        <button onClick={saveRules} disabled={saving} className="rounded-lg bg-burgundy px-3 py-1.5 text-cream disabled:opacity-60">
          {saving ? "…" : "Lưu"}
        </button>
        {rulesMsg && <p className={`mt-1 text-xs ${rulesMsg.ok ? "text-burgundy" : "text-burgundy-accent"}`}>{rulesMsg.text}</p>}

        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-gold py-2 text-burgundy">Đóng</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `components/room/Header.tsx`** — three edits:

Signature:
```tsx
export default function Header({ room, members, isAdmin, isDj, roomId, token, myMemberId }: {
  room: Room; members: Member[]; isAdmin: boolean; isDj: boolean; roomId: string; token: string; myMemberId: string | null;
}) {
```
Gate:
```tsx
        {(isAdmin || isDj) && (
          <button onClick={() => setOpen(true)} className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Setting</button>
        )}
```
Dialog:
```tsx
      {open && <SettingsDialog room={room} members={members} roomId={roomId} token={token} myMemberId={myMemberId} isAdmin={isAdmin} onClose={() => setOpen(false)} />}
```

- [ ] **Step 3: `components/room/RoomShell.tsx`** — the Header line becomes:

```tsx
      <Header room={room} members={state.members} isAdmin={role.isAdmin} isDj={role.isDj} roomId={room.id} token={token} myMemberId={myMemberId} />
```

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add components/room/SettingsDialog.tsx components/room/Header.tsx components/room/RoomShell.tsx
git commit -m "feat: room rules settings section (admin + dj); admin-only sections gated

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Queue split + `PendingQueue` + `MyPending`

**Files:**
- Create: `components/room/PendingQueue.tsx`
- Create: `components/room/MyPending.tsx`
- Modify: `components/room/RoomShell.tsx`

**Interfaces:**
- Consumes: `approveQueueItem`, `approveAllPending`, `rejectQueueItem`, `deleteItem`, `QueueItem.status` (Task 2).
- Produces: `PendingQueue({ pending: QueueItem[]; roomId; token })`, `MyPending({ items: QueueItem[]; roomId; token })`; `RoomShell` passes `approved` to `Queue`.

- [ ] **Step 1: Create `components/room/PendingQueue.tsx`**

```tsx
"use client";

import { useState } from "react";
import { approveAllPending, approveQueueItem, rejectQueueItem, type QueueItem } from "@/lib/supabase";

const FAIL = "Thao tác không thành công, thử lại nhé.";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** Admin/DJ panel: songs waiting for approval. */
export default function PendingQueue({ pending, roomId, token }: { pending: QueueItem[]; roomId: string; token: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try { await fn(); } catch { setError(FAIL); } finally { setBusyId(null); }
  }
  async function approveAll() {
    setBusyAll(true);
    setError(null);
    try { await approveAllPending(roomId, token); } catch { setError(FAIL); } finally { setBusyAll(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 font-cormorant text-burgundy">
        <span>⏳ Chờ duyệt <span className="text-xs text-ink/60">· {pending.length}</span></span>
        <button type="button" disabled={pending.length === 0 || busyAll} onClick={approveAll}
          className="rounded border border-gold-200 bg-cream px-2 text-xs text-burgundy disabled:opacity-60">
          {busyAll ? "…" : "Duyệt tất cả"}
        </button>
      </div>
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      {pending.length === 0 && <p className="text-sm text-ink/60">Không có bài chờ duyệt.</p>}
      <ul className="max-h-[35vh] overflow-y-auto pr-1">
        {pending.map((q) => {
          const busy = busyId === q.id || busyAll;
          return (
            <li key={q.id} className={`flex items-center gap-2 border-b border-dotted border-gold-200 py-2 ${busy ? "opacity-60" : ""}`}>
              {q.thumbnail_url
                // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
                : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
                <div className="text-[11px] text-gold">do {q.added_by_name}</div>
              </div>
              <div className="flex w-14 items-center justify-end gap-1">
                {busy ? <Spinner /> : (
                  <>
                    <button title="Duyệt" onClick={() => run(q.id, () => approveQueueItem(roomId, token, q.id))}
                      className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✓</button>
                    <button title="Từ chối" onClick={() => run(q.id, () => rejectQueueItem(roomId, token, q.id))}
                      className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy-accent">✕</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/room/MyPending.tsx`**

```tsx
"use client";

import { useState } from "react";
import { deleteItem, type QueueItem } from "@/lib/supabase";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** A member's own songs still waiting for approval; each can be withdrawn. Renders nothing when empty. */
export default function MyPending({ items, roomId, token }: { items: QueueItem[]; roomId: string; token: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function withdraw(id: string) {
    setBusyId(id);
    setError(null);
    try { await deleteItem(roomId, token, id); } catch { setError("Thao tác không thành công, thử lại nhé."); } finally { setBusyId(null); }
  }

  return (
    <div className="mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 font-cormorant text-burgundy">⏳ Đang chờ duyệt <span className="text-xs text-ink/60">· {items.length}</span></div>
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      <ul className="max-h-[30vh] overflow-y-auto pr-1">
        {items.map((q) => {
          const busy = busyId === q.id;
          return (
            <li key={q.id} className={`flex items-center gap-2 border-b border-dotted border-gold-200 py-2 ${busy ? "opacity-60" : ""}`}>
              {q.thumbnail_url
                // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
                : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1 truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
              {busy ? <Spinner /> : (
                <button title="Rút lại" onClick={() => withdraw(q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: `components/room/RoomShell.tsx`** — replace the whole file with:

```tsx
"use client";

import type { RoomView } from "@/hooks/useRoom";
import Header from "./Header";
import MemberList from "./MemberList";
import ChatPanel from "./ChatPanel";
import NowPlaying from "./NowPlaying";
import Reactions from "./Reactions";
import AddSong from "./AddSong";
import Queue from "./Queue";
import PendingQueue from "./PendingQueue";
import MyPending from "./MyPending";
import { useDjController } from "@/hooks/useDjController";

export default function RoomShell({ view }: { view: RoomView }) {
  const { state, role, onlineIds, token, myMemberId, accountId } = view;
  const room = state.room!;
  const current = state.queue.find((q) => q.id === room.current_item_id) ?? null;
  // Pending rows are requests awaiting Admin/DJ approval; only approved rows are the play queue.
  const approved = state.queue.filter((q) => q.status === "approved");
  const pending = state.queue.filter((q) => q.status === "pending");
  const myPending = pending.filter((q) => q.added_by_account_id === accountId);
  // onlineIds are ACCOUNT ids (presence is keyed by account id); dj_member_id is a MEMBER id,
  // so map it to its account id before checking presence.
  const djAccountId = state.members.find((m) => m.id === room.dj_member_id)?.account_id ?? null;
  const djOnline = !!djAccountId && onlineIds.includes(djAccountId);

  // DJ-only playback engine (no-op for non-DJ). Returns transport handlers + duration/volume.
  const dj = useDjController({ room, current, isDj: role.isDj, queueLen: approved.length, roomId: room.id, token });

  return (
    <main className="mx-auto max-w-6xl p-3">
      <Header room={room} members={state.members} isAdmin={role.isAdmin} isDj={role.isDj} roomId={room.id} token={token} myMemberId={myMemberId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22%_1fr_33%]">
        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <MemberList members={state.members} room={room} onlineIds={onlineIds} isAdmin={role.isAdmin} token={token} myMemberId={myMemberId} />
          <ChatPanel roomId={room.id} token={token} accountId={accountId} isAdmin={role.isAdmin} />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <NowPlaying
            room={room} current={current} canControl={role.canControlPlayback}
            durationMs={dj.durationMs} volume={dj.volume} djOnline={djOnline}
            onPlayPause={dj.togglePlay} onSkip={dj.skip} onSeekMs={dj.seekMs} onVolume={dj.setVolume}
          />
          <Reactions roomId={room.id} />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <AddSong roomId={room.id} token={token} />
          <MyPending items={myPending} roomId={room.id} token={token} />
          {role.canManageQueue && (room.require_approval || pending.length > 0) && (
            <PendingQueue pending={pending} roomId={room.id} token={token} />
          )}
          <Queue queue={approved} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add components/room/PendingQueue.tsx components/room/MyPending.tsx components/room/RoomShell.tsx
git commit -m "feat: approval queue UI — PendingQueue (admin/dj), MyPending (members), queue split by status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Rule-aware `AddSong` + `SearchResults`

**Files:**
- Modify: `components/room/AddSong.tsx`
- Modify: `components/room/SearchResults.tsx`
- Modify: `components/room/RoomShell.tsx` (the `<AddSong …>` line)

**Interfaces:**
- Consumes: `RoomRules`, `checkQueueRules`, `ruleMessage`, `violationFromRpcError` (Task 5); `fetchVideoDetails` (Task 3); `PlaylistItem.durationSeconds` (Task 4); `addQueueItems` with `duration` (Task 2).
- Produces: `AddSong` props `{ roomId; token; rules: RoomRules; willPend: boolean }`; `SearchResults` props gain `rules: RoomRules; willPend: boolean`.

- [ ] **Step 1: `components/room/AddSong.tsx`** — apply these edits (everything else stays as in v8):

Imports — add:
```tsx
import { fetchVideoDetails } from "@/lib/youtube/video";
import { checkQueueRules, ruleMessage, violationFromRpcError, type RoomRules } from "@/lib/queue-rules";
```

Signature:
```tsx
export default function AddSong({ roomId, token, rules, willPend }: {
  roomId: string; token: string; rules: RoomRules; willPend: boolean;
}) {
```

Replace the body of the `try { … }` in `onSubmit` (the playlist and single-video branches) with:

```tsx
      if (!videoId && playlistId) {
        const items = await fetchPlaylistItems(playlistId);
        if (items.length === 0) { setError("Playlist trống hoặc không đọc được."); return; }
        const added = await addQueueItems(roomId, token,
          items.map((it) => ({ videoId: it.videoId, title: it.title, thumb: it.thumb, duration: it.durationSeconds })));
        const skipped = items.length - added;
        setNotice(
          `Đã thêm ${added} bài từ playlist.` +
          (skipped > 0 ? ` Bỏ qua ${skipped} bài (quá dài / từ khóa cấm).` : "") +
          (willPend && added > 0 ? " Đã gửi, chờ Admin/DJ duyệt." : ""),
        );
        setInput("");
      } else if (videoId) {
        // Watch page first (has the duration); oEmbed fallback keeps title/thumb but no duration.
        const details = await fetchVideoDetails(videoId);
        const meta = details ? null : await fetchVideoMeta(videoId);
        const title = details?.title || meta?.title || videoId;
        const thumb = details ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : (meta?.thumbnail ?? null);
        const duration = details?.durationSeconds ?? null;
        const violation = checkQueueRules(rules, { title, durationSeconds: duration });
        if (violation) { setError(ruleMessage(violation)); return; }
        await addQueueItem(roomId, token, { videoId, title, thumb, duration });
        if (willPend) setNotice("Đã gửi, chờ Admin/DJ duyệt.");
        setInput("");
      }
```

Replace the `catch` of that same `try` with:

```tsx
    } catch (err) {
      const violation = violationFromRpcError(err, rules);
      setError(violation ? ruleMessage(violation) : ((err as { message?: string }).message ?? "Không thêm được bài."));
    } finally {
```

And the `<SearchResults …>` element becomes:

```tsx
        <SearchResults key={search.id} query={search.query} results={search.results}
          roomId={roomId} token={token} rules={rules} willPend={willPend} onClose={() => setSearch(null)} />
```

- [ ] **Step 2: `components/room/SearchResults.tsx`** — edits:

Imports — add:
```tsx
import { checkQueueRules, ruleMessage, violationFromRpcError, type RoomRules } from "@/lib/queue-rules";
```

State — the per-row state gains an error message; replace `type AddState = "idle" | "busy" | "done" | "error";` and the `state` handling with:

```tsx
type AddState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };
const IDLE: AddState = { kind: "idle" };

const REASON: Record<"too_long" | "unknown_duration" | "banned", string> = {
  too_long: "quá dài", unknown_duration: "không rõ thời lượng", banned: "từ khóa cấm",
};
```

Signature:
```tsx
export default function SearchResults({ query, results, roomId, token, rules, willPend, onClose }: {
  query: string; results: SearchResult[]; roomId: string; token: string; rules: RoomRules; willPend: boolean; onClose: () => void;
}) {
  const [state, setState] = useState<Record<string, AddState>>({});
```

`add`:
```tsx
  async function add(r: SearchResult) {
    if ((state[r.videoId] ?? IDLE).kind === "done") return;
    if (inFlight.current.has(r.videoId)) return;
    inFlight.current.add(r.videoId);
    setState((s) => ({ ...s, [r.videoId]: { kind: "busy" } }));
    try {
      await addQueueItem(roomId, token, {
        videoId: r.videoId, title: r.title || r.videoId, thumb: r.thumb, duration: r.durationSeconds,
      });
      setState((s) => ({ ...s, [r.videoId]: { kind: "done" } }));
    } catch (err) {
      const v = violationFromRpcError(err, rules);
      setState((s) => ({ ...s, [r.videoId]: { kind: "error", message: v ? ruleMessage(v) : "Không thêm được." } }));
    } finally {
      inFlight.current.delete(r.videoId);
    }
  }
```

Row rendering — replace the `results.map` body with:

```tsx
        {results.map((r) => {
          const st = state[r.videoId] ?? IDLE;
          const violation = checkQueueRules(rules, { title: r.title, durationSeconds: r.durationSeconds });
          return (
            <li key={r.videoId} className={`border-b border-dotted border-gold-200 py-2 ${st.kind === "busy" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here */}
                <img src={r.thumb} alt="" className="h-9 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{r.title || r.videoId}</div>
                  <div className="truncate text-[11px] text-gold">
                    {r.channel}{r.durationText ? ` · ${r.durationText}` : ""}
                  </div>
                </div>
                {st.kind === "busy" ? <Spinner /> : violation ? (
                  <span title={ruleMessage(violation)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-xs text-ink/50">
                    {REASON[violation.code]}
                  </span>
                ) : (
                  <button type="button" disabled={st.kind === "done"} onClick={() => add(r)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy disabled:opacity-60">
                    {st.kind === "done" ? (willPend ? "✓ Đã gửi" : "✓ Đã thêm") : "+ Thêm"}
                  </button>
                )}
              </div>
              {st.kind === "error" && <p className="mt-1 text-[11px] text-burgundy-accent">{st.message}</p>}
            </li>
          );
        })}
```

- [ ] **Step 3: `components/room/RoomShell.tsx`** — compute the props and pass them. After the `myPending` line add:

```tsx
  const rules = { max_duration_seconds: room.max_duration_seconds, banned_keywords: room.banned_keywords };
  const willPend = room.require_approval && !role.canManageQueue;
```

and change the AddSong line to:

```tsx
          <AddSong roomId={room.id} token={token} rules={rules} willPend={willPend} />
```

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add components/room/AddSong.tsx components/room/SearchResults.tsx components/room/RoomShell.tsx
git commit -m "feat: rule-aware add flows — pre-checked messages, watch-page durations, pending notices, playlist skip count

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 5 — Docs + verification

## Task 9: README v9 + live migration + manual check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append the v9 section** at the end of `README.md` (after the v8 section):

```md
## v9: Quy tắc hàng đợi (giới hạn thời lượng · chờ duyệt · từ khóa cấm)

### DB migration

`supabase/migrations/0008_v9_room_rules.sql` is **fully additive** (`add column if not exists`, `create or replace function`, `create extension if not exists unaccent`) — **no data is lost**; existing queue rows become `approved`. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0008_v9_room_rules.sql`.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0008` from scratch (wipes all data).

> After the migration every room limits videos to **10 minutes** by default (`0` = unlimited). Pasted links therefore need a duration: the app reads it key-free from the watch page (`/api/yt/video`) and from playlist pages. Live streams have no duration and are rejected while a limit is set.

### What's new in v9

- **Room rules (Admin + DJ)** in ⚙️ Setting → **Quy tắc hàng đợi**: *Thời lượng tối đa* (minutes, `0` = unlimited, default 10), *Chờ duyệt* toggle, and *Từ khóa cấm* chips (matched against the video **title**, case- and accent-insensitive). The rules are enforced inside the RPCs, so they cannot be bypassed by calling the API directly; the UI checks them first for friendly messages, and search-result rows that break a rule are greyed out with the reason.
- **Approval queue:** with *Chờ duyệt* on, songs added by members land in a **⏳ Chờ duyệt** panel above the queue that only Admin/DJ see, with ✓ / ✕ per row and **Duyệt tất cả**. Members see their own pending songs under the add box and can withdraw them. Admin/DJ additions skip approval. Turning the toggle off approves everything still pending.
- **Playlist adds** skip songs that break a rule and report how many were skipped.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: v9 notes — room rules, approval queue, migration 0008

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Live migration (user action) + manual check (controller)**

The controller asks the user to run `supabase/migrations/0008_v9_room_rules.sql` in the Supabase SQL Editor of the live project, then walks this table in the built-in browser (dev server, two accounts: one Admin/DJ, one member):

| Action | Expected |
|---|---|
| Member opens the room | no ⚙️ Setting button; Admin and a DJ (assigned) both see it |
| DJ opens Setting | only "Quy tắc hàng đợi" (no Tên phòng / Thành viên); Admin sees all three |
| Set max 1 phút, Lưu | `Đã lưu quy tắc.`; search results longer than 1:00 show grey `quá dài`; adding a 5-min pasted link → `Video dài hơn giới hạn 1 phút của phòng.` |
| Set max 0 | long videos add again; a live-stream link adds too |
| Add keyword `karaoke`, Lưu | a result titled "… Karaoke …" shows `từ khóa cấm`; pasting such a link → `Tiêu đề chứa từ khóa bị cấm: "karaoke".` |
| Turn on Chờ duyệt (Admin) | Admin sees `⏳ Chờ duyệt · 0` panel with `Duyệt tất cả` disabled |
| Member adds a song | member sees `Đã gửi, chờ Admin/DJ duyệt.` and `⏳ Đang chờ duyệt · 1` with ✕; Admin's panel shows it with ✓ / ✕; "Hàng đợi" unchanged |
| Admin ✓ | row leaves both lists and appears at the end of "Hàng đợi" (realtime, no reload) |
| Member adds two more, Admin `Duyệt tất cả` | both move to the queue in request order |
| Member adds one, presses ✕ (Rút lại) | disappears everywhere |
| Member adds one, Admin ✕ (Từ chối) | disappears everywhere |
| Admin/DJ adds a song while approval is on | goes straight to "Hàng đợi" |
| Member adds one, Admin turns Chờ duyệt off | the pending song is auto-approved into the queue |
| Both themes 🎩/🎮 | settings section, both panels and grey labels render correctly |

---

## Done criteria

- `npm test`, `npm run lint`, `npx tsc --noEmit` clean on `feat/v9-room-rules`; the local-cluster smoke script printed `v9 smoke: all 14 checks passed`; `0008` applied twice without error.
- Manual table passes on the live project after the user runs the migration.
- No captured credentials in the diff (`git diff main | grep -iE "SAPISID|LOGIN_INFO|visitor|authuser"` → nothing).
