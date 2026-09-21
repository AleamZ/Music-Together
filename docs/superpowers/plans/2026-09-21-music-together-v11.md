# Music Together v11 — Per-Member Order Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room setting "Số order tối đa mỗi người" (default 5, 0 = unlimited) enforced in the add RPCs for ordinary members, with a live counter and friendly messages in the UI.

**Architecture:** One additive migration adds `rooms.max_orders_per_member` plus two SQL helpers (`_order_count`, `_orders_remaining`) and re-creates `add_queue_item` / `add_queue_items` / `update_room_settings` around them. The client mirrors the count in `lib/queue-rules.ts` (pure, unit-tested) from the realtime queue state, shows `Order: m/N`, blocks at the limit before calling the RPC, and maps the RPC error `order limit reached` (23514) like the v9 rules. Admin and DJ are exempt; the currently playing row does not count.

**Tech Stack:** Next.js 16.2.9 App Router, React 19 (React-Compiler lint rules), TS 5, Tailwind v4 theme tokens, Supabase Postgres (plpgsql SECURITY DEFINER RPCs) + Realtime, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-music-together-v11-order-limit-design.md`

## Global Constraints

- Branch `feat/v11-order-limit` from `main` (main = v10 merged, `3c6551c`). Commit per task; conventional messages; commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Column: `rooms.max_orders_per_member integer not null default 5` — `0` = unlimited, valid range `0..100`.
- What counts: rows of `queue_items` in the room with `added_by_account_id` = the member's account, status pending **or** approved, **excluding** `rooms.current_item_id`.
- Exempt: the room's `admin_member_id` and `dj_member_id`. Client: `role.canManageQueue`.
- RPC error copy (verbatim): `order limit reached` errcode `23514`; `invalid order limit` errcode `22023`.
- `update_room_settings` new 6th argument `p_max_orders_per_member integer default null`; `null` keeps the current value; the old 5-argument signature is **dropped** (no overloads).
- Playlist: insert until the remaining slots are used, then stop; rules-skipped elements do not consume slots; return value = rows inserted (unchanged meaning).
- UI copy (verbatim): field label `Số order tối đa mỗi người`, hint `0 = không giới hạn`, validation `Số order tối đa phải từ 0 đến 100.`, counter `Order: {mine}/{max}`, violation message `Bạn đã đặt đủ ${max} bài — chờ bài phát xong rồi đặt tiếp.`, playlist notice `Đã thêm ${added}/${items.length} bài — đạt giới hạn ${max} order.` (+ existing ` Đã gửi, chờ Admin/DJ duyệt.` suffix when `willPend && added > 0`), search-row reason chip `đủ order`.
- Theme tokens only (`cream`, `parchment-200`, `gold`, `gold-200`, `ink`, `burgundy`, `burgundy-accent`, `font-cormorant`); no new CSS.
- Gates per task: `npx tsc --noEmit` clean; `npm run lint` = 0 errors and exactly the 2 baseline warnings (NowPlaying.tsx exhaustive-deps, Queue.tsx no-img-element); `npm test` green (baseline 81 pass / 30 skipped; integration files skip without `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`).
- Never commit secrets; never touch `.env.local`.

---

### Task 1: Migration `0009` + integration tests + local PG18 validation

**Files:**
- Create: `supabase/migrations/0009_v11_order_limit.sql`
- Create: `tests/integration/v11.test.ts`

**Interfaces:**
- Consumes: `public._auth(room, token, role)`, `public._auth_account(token)`, `public._check_queue_rules(room, title, duration)`, `public._queue_status_for(room, member)`, `public._approve_all(room)` (all from 0004–0008).
- Produces: `rooms.max_orders_per_member`; `public._order_count(uuid,uuid) → int`; `public._orders_remaining(uuid,uuid,uuid) → int|null`; `add_queue_item` raising `order limit reached`; `add_queue_items` stopping at the remaining slots; `update_room_settings(uuid,text,integer,boolean,text[],integer default null)`.

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================
-- 0009_v11_order_limit.sql — v11: per-member order limit (default 5; 0 = unlimited). ADDITIVE (no data drop).
-- Admin and DJ are exempt. The playing row (rooms.current_item_id) does not count.
-- =========================================================

-- ---------- A. Schema ----------
alter table public.rooms
  add column if not exists max_orders_per_member integer not null default 5;   -- 0 = unlimited

-- ---------- B. Helpers ----------
-- Rows this account has waiting in the room (pending + approved), excluding the row that is playing.
create or replace function public._order_count(p_room_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions
as $$
  select count(*)::int from public.queue_items qi
  join public.rooms r on r.id = qi.room_id
  where qi.room_id = p_room_id
    and qi.added_by_account_id = p_account_id
    and qi.id is distinct from r.current_item_id;
$$;
revoke all on function public._order_count(uuid,uuid) from public, anon, authenticated;

-- How many more rows this member may add: null = unlimited (limit 0, or admin/dj), else max(0, limit - count).
create or replace function public._orders_remaining(p_room_id uuid, p_member_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions
as $$
  select case
    when r.max_orders_per_member <= 0 then null
    when p_member_id = r.admin_member_id or p_member_id = r.dj_member_id then null
    else greatest(0, r.max_orders_per_member - public._order_count(p_room_id, p_account_id))
  end
  from public.rooms r where r.id = p_room_id;
$$;
revoke all on function public._orders_remaining(uuid,uuid,uuid) from public, anon, authenticated;

-- ---------- C. add_queue_item: rules + order limit + pending ----------
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
  if coalesce(public._orders_remaining(p_room_id, v_member, v_account), 1) <= 0 then
    raise exception 'order limit reached' using errcode = '23514';
  end if;
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

-- ---------- D. add_queue_items (playlist): rule violators skipped; stops when the member's slots are used ----------
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision; v_remaining int;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  v_remaining := public._orders_remaining(p_room_id, v_member, v_account);   -- null = unlimited
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_title := coalesce(nullif(v_item->>'title', ''), v_item->>'video_id');
    v_duration := case when jsonb_typeof(v_item->'duration') = 'number' then floor((v_item->>'duration')::numeric)::int else null end;
    begin
      perform public._check_queue_rules(p_room_id, v_title, v_duration);
    exception when check_violation then
      continue;   -- skip this element, keep going (does not use a slot)
    end;
    if v_remaining is not null and v_count >= v_remaining then exit; end if;   -- slots used up
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

-- ---------- E. update_room_settings: + max_orders_per_member (null = keep). Old 5-arg signature dropped: two
-- overloads would make a 5-argument PostgREST call ambiguous. ----------
drop function if exists public.update_room_settings(uuid,text,integer,boolean,text[]);
create or replace function public.update_room_settings(
  p_room_id uuid, p_session_token text,
  p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[],
  p_max_orders_per_member integer default null
) returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_kws text[] := '{}'; v_kw text; v_clean text;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  if p_max_duration_seconds is null or p_max_duration_seconds < 0 or p_max_duration_seconds > 86400 then
    raise exception 'invalid max duration' using errcode = '22023';
  end if;
  if p_max_orders_per_member is not null and (p_max_orders_per_member < 0 or p_max_orders_per_member > 100) then
    raise exception 'invalid order limit' using errcode = '22023';
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
    banned_keywords = v_kws,
    max_orders_per_member = coalesce(p_max_orders_per_member, max_orders_per_member)
  where id = p_room_id;
  if not coalesce(p_require_approval, false) then
    perform public._approve_all(p_room_id);
  end if;
end; $$;
grant execute on function public.update_room_settings(uuid,text,integer,boolean,text[],integer) to anon, authenticated;
```

- [ ] **Step 2: Validate the migration on a throwaway PostgreSQL 18 cluster (Git Bash)**

PostgreSQL 18 binaries: `/c/Program Files/PostgreSQL/18/bin`. The cluster is throwaway; put it in the session scratchpad (or `$TEMP`).

```bash
PG="/c/Program Files/PostgreSQL/18/bin"; D="$TEMP/mt-pg-v11"; rm -rf "$D"
"$PG/initdb" -D "$D" -U postgres --auth=trust -E UTF8 >/dev/null
"$PG/pg_ctl" -D "$D" -o "-p 5499" -l "$D/log" -w start
PSQL="$PG/psql -v ON_ERROR_STOP=1 -q -p 5499 -U postgres -d postgres"
$PSQL -c "create schema if not exists extensions; create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
for f in 0004_v2_rebuild 0005_v3_admin 0006_v4_chat_roles 0007_v5_batch_queue 0008_v9_room_rules 0009_v11_order_limit; do
  $PSQL -f "supabase/migrations/$f.sql" || { echo "FAILED at $f"; break; }
done
```

Expected: every file applies without error (0004 rebuilds the tables from scratch; 0001–0003 are superseded and are NOT replayed).

- [ ] **Step 3: Smoke-test the rules in SQL (same cluster)**

Save as `$TEMP/v11-smoke.sql` and run `$PSQL -f "$TEMP/v11-smoke.sql"`:

```sql
do $$
declare a record; m record; m2 record; r record; j record; i int; v_err text; v_n int;
begin
  select * into a from public.register('adm_v11', 'pw123456');
  select * into r from public.create_room('R', 'secret', a.token);
  select * into m from public.register('mem_v11', 'pw123456');
  select * into j from public.join_room(r.code, 'secret', m.token);

  -- default 5: 5 ok, 6th refused with the exact message
  for i in 1..5 loop perform public.add_queue_item(r.room_id, m.token, 'v'||i, 'T'||i, null, 100); end loop;
  begin
    perform public.add_queue_item(r.room_id, m.token, 'v6', 'T6', null, 100);
    raise exception 'FAIL: 6th add should have been refused';
  exception when check_violation then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'order limit reached' then raise exception 'FAIL: unexpected message %', v_err; end if;
  end;

  -- admin exempt
  for i in 1..6 loop perform public.add_queue_item(r.room_id, a.token, 'a'||i, 'A'||i, null, 100); end loop;

  -- the playing row does not count: v1 (lowest position) starts playing -> member may add one more, then refused again
  perform public.advance_queue(r.room_id, a.token);
  perform public.add_queue_item(r.room_id, m.token, 'v7', 'T7', null, 100);
  begin
    perform public.add_queue_item(r.room_id, m.token, 'v8', 'T8', null, 100);
    raise exception 'FAIL: 8th add should have been refused';
  exception when check_violation then null;
  end;

  -- playlist: limit 2 for a fresh member -> 2 inserted of 4 valid (1 rule-skipped element does not use a slot)
  perform public.update_room_settings(r.room_id, a.token, 600, false, '{}'::text[], 2);
  select * into m2 from public.register('mem2_v11', 'pw123456');
  perform public.join_room(r.code, 'secret', m2.token);
  select public.add_queue_items(r.room_id, m2.token, '[
    {"video_id":"p1","title":"ok","thumb":null,"duration":100},
    {"video_id":"p2","title":"too long","thumb":null,"duration":700},
    {"video_id":"p3","title":"ok","thumb":null,"duration":100},
    {"video_id":"p4","title":"ok","thumb":null,"duration":100},
    {"video_id":"p5","title":"ok","thumb":null,"duration":100}]'::jsonb) into v_n;
  if v_n <> 2 then raise exception 'FAIL: playlist inserted % (expected 2)', v_n; end if;
  if public._order_count(r.room_id, m2.account_id) <> 2 then raise exception 'FAIL: order_count'; end if;

  -- limit 0 = unlimited; null keeps the value; out of range rejected
  perform public.update_room_settings(r.room_id, a.token, 600, false, '{}'::text[], 0);
  for i in 1..7 loop perform public.add_queue_item(r.room_id, m2.token, 'u'||i, 'U'||i, null, 100); end loop;
  perform public.update_room_settings(r.room_id, a.token, 600, false, '{}'::text[]);   -- 5-arg call via default
  if (select max_orders_per_member from public.rooms where id = r.room_id) <> 0 then raise exception 'FAIL: null should keep'; end if;
  begin
    perform public.update_room_settings(r.room_id, a.token, 600, false, '{}'::text[], 101);
    raise exception 'FAIL: 101 should be rejected';
  exception when invalid_parameter_value then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'invalid order limit' then raise exception 'FAIL: unexpected message %', v_err; end if;
  end;
  raise notice 'SMOKE OK';
end $$;
```

Expected: `NOTICE:  SMOKE OK`. Then stop and delete the cluster: `"$PG/pg_ctl" -D "$D" -w stop; rm -rf "$D"`.

- [ ] **Step 4: Write the env-gated integration tests**

`tests/integration/v11.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v11 per-member order limit", () => {
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
    const { data, error } = await db.rpc("join_room", { p_code: code, p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; member_id: string };
  };
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: videoId, p_thumb: null, p_duration: 100 });
  const addMany = (roomId: string, token: string, ids: string[], duration = 100) =>
    db.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: ids.map((id) => ({ video_id: id, title: id, thumb: null, duration })) });
  const settings = (roomId: string, token: string, maxOrders: number | null, approval = false) =>
    db.rpc("update_room_settings", {
      p_room_id: roomId, p_session_token: token, p_max_duration_seconds: 600, p_require_approval: approval, p_banned_keywords: [],
      ...(maxOrders === null ? {} : { p_max_orders_per_member: maxOrders }),
    });
  const limitOf = async (roomId: string) => {
    const { data } = await db.from("rooms").select("max_orders_per_member").eq("id", roomId).single();
    return (data as { max_orders_per_member: number }).max_orders_per_member;
  };

  it("default 5: the 6th add is refused with 'order limit reached'; admin is exempt", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect(await limitOf(room.room_id)).toBe(5);
    for (let i = 1; i <= 5; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    const sixth = await add(room.room_id, member.token, "v6");
    expect(sixth.error?.code).toBe("23514"); expect(sixth.error?.message).toBe("order limit reached");
    for (let i = 1; i <= 6; i++) expect((await add(room.room_id, admin.token, `a${i}`)).error).toBeNull();
  });

  it("the playing row does not count", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    for (let i = 1; i <= 5; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    expect((await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token })).error).toBeNull();
    expect((await add(room.room_id, member.token, "v6")).error).toBeNull();
    expect((await add(room.room_id, member.token, "v7")).error?.message).toBe("order limit reached");
  });

  it("DJ is exempt", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const dj = await reg(uniq("dj")); const djJoin = await join(room.code, dj.token);
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: admin.token, p_target_member: djJoin.member_id })).error).toBeNull();
    for (let i = 1; i <= 6; i++) expect((await add(room.room_id, dj.token, `d${i}`)).error).toBeNull();
  });

  it("playlist: inserts up to the remaining slots; rule-skipped elements do not use a slot; then 0", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, admin.token, 2)).error).toBeNull();
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "p1", title: "ok", thumb: null, duration: 100 },
      { video_id: "p2", title: "too long", thumb: null, duration: 700 },
      { video_id: "p3", title: "ok", thumb: null, duration: 100 },
      { video_id: "p4", title: "ok", thumb: null, duration: 100 },
    ] });
    expect(error).toBeNull(); expect(data).toBe(2);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id").eq("room_id", room.room_id).order("position");
    expect(rows).toEqual([{ youtube_video_id: "p1" }, { youtube_video_id: "p3" }]);
    const again = await addMany(room.room_id, member.token, ["p5"]);
    expect(again.error).toBeNull(); expect(again.data).toBe(0);
  });

  it("pending rows count; a rejected row frees a slot", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, admin.token, 2, true)).error).toBeNull();
    const first = await add(room.room_id, member.token, "v1"); expect(first.error).toBeNull();
    expect((await add(room.room_id, member.token, "v2")).error).toBeNull();
    expect((await add(room.room_id, member.token, "v3")).error?.message).toBe("order limit reached");
    expect((await db.rpc("reject_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: first.data })).error).toBeNull();
    expect((await add(room.room_id, member.token, "v3")).error).toBeNull();
  });

  it("settings: 0 = unlimited, omitted argument keeps the value, out of range rejected, member refused", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, member.token, 3)).error?.code).toBe("42501");
    expect((await settings(room.room_id, admin.token, 0)).error).toBeNull();
    for (let i = 1; i <= 7; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    expect((await settings(room.room_id, admin.token, null)).error).toBeNull();
    expect(await limitOf(room.room_id)).toBe(0);
    const over = await settings(room.room_id, admin.token, 101);
    expect(over.error?.code).toBe("22023"); expect(over.error?.message).toBe("invalid order limit");
    expect((await settings(room.room_id, admin.token, -1)).error?.code).toBe("22023");
    expect((await settings(room.room_id, admin.token, 100)).error).toBeNull();
    expect(await limitOf(room.room_id)).toBe(100);
  });
});
```

- [ ] **Step 5: Run the gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint 0 errors / 2 baseline warnings; vitest `81 passed | 36 skipped` (the 6 new cases skip without the env vars). Do NOT set `SUPABASE_TEST_URL` against the live project unless the user asked.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0009_v11_order_limit.sql tests/integration/v11.test.ts
git commit -m "feat: v11 migration — per-member order limit (default 5), exempt admin/dj, playlist fills remaining slots"
```

---

### Task 2: `lib/queue-rules.ts` + `lib/supabase.ts` + unit tests

**Files:**
- Modify: `lib/queue-rules.ts`
- Modify: `lib/supabase.ts` (`Room` interface, `RoomSettings`, `updateRoomSettings`)
- Modify: `tests/unit/queue-rules.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 (client only mirrors the SQL semantics).
- Produces (used verbatim by Task 3):
  - `RoomRules { max_duration_seconds: number; banned_keywords: string[]; max_orders_per_member: number }`
  - `RuleViolation` gains `{ code: "order_limit"; max: number }`
  - `countMyOrders(queue: Array<{ id: string; added_by_account_id: string | null }>, accountId: string | null, currentId: string | null): number`
  - `ordersRemaining(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): number | null`
  - `orderLimitViolation(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): RuleViolation | null`
  - `Room.max_orders_per_member: number`; `RoomSettings.maxOrdersPerMember: number`

- [ ] **Step 1: Write the failing unit tests** — append to `tests/unit/queue-rules.test.ts` and update the `rules` helper + imports at the top:

```ts
import { checkQueueRules, countMyOrders, normalizeForMatch, orderLimitViolation, ordersRemaining, ruleMessage, violationFromRpcError } from "@/lib/queue-rules";

const rules = (max: number, kws: string[] = [], maxOrders = 5) => ({ max_duration_seconds: max, banned_keywords: kws, max_orders_per_member: maxOrders });
```

Append:

```ts
describe("countMyOrders", () => {
  const q = [
    { id: "a", added_by_account_id: "me" },
    { id: "b", added_by_account_id: "me" },
    { id: "c", added_by_account_id: "other" },
    { id: "d", added_by_account_id: null },
    { id: "e", added_by_account_id: "me" },
  ];
  it("counts my rows regardless of status and excludes the playing one", () => {
    expect(countMyOrders(q, "me", null)).toBe(3);
    expect(countMyOrders(q, "me", "a")).toBe(2);
    expect(countMyOrders(q, "me", "c")).toBe(3);
  });
  it("returns 0 for an unknown or null account", () => {
    expect(countMyOrders(q, "nobody", null)).toBe(0);
    expect(countMyOrders(q, null, null)).toBe(0);
  });
});

describe("ordersRemaining / orderLimitViolation", () => {
  it("null when unlimited (0) or exempt; otherwise limit - mine clamped at 0", () => {
    expect(ordersRemaining(rules(0, [], 0), 3, false)).toBeNull();
    expect(ordersRemaining(rules(0, [], 5), 99, true)).toBeNull();
    expect(ordersRemaining(rules(0, [], 5), 3, false)).toBe(2);
    expect(ordersRemaining(rules(0, [], 5), 5, false)).toBe(0);
    expect(ordersRemaining(rules(0, [], 5), 7, false)).toBe(0);
  });
  it("violates only when no slot is left", () => {
    expect(orderLimitViolation(rules(0, [], 5), 4, false)).toBeNull();
    expect(orderLimitViolation(rules(0, [], 5), 5, false)).toEqual({ code: "order_limit", max: 5 });
    expect(orderLimitViolation(rules(0, [], 5), 5, true)).toBeNull();
    expect(orderLimitViolation(rules(0, [], 0), 50, false)).toBeNull();
  });
});

describe("order limit copy + RPC mapping", () => {
  it("renders the message and maps 'order limit reached'", () => {
    expect(ruleMessage({ code: "order_limit", max: 5 })).toBe("Bạn đã đặt đủ 5 bài — chờ bài phát xong rồi đặt tiếp.");
    expect(violationFromRpcError({ code: "23514", message: "order limit reached" }, rules(0, [], 3))).toEqual({ code: "order_limit", max: 3 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/queue-rules.test.ts`
Expected: FAIL — `countMyOrders` / `ordersRemaining` / `orderLimitViolation` are not exported.

- [ ] **Step 3: Implement in `lib/queue-rules.ts`**

Replace the `RoomRules` and `RuleViolation` declarations and append the helpers; extend `ruleMessage` and `violationFromRpcError`:

```ts
/** Client-side mirror of the SQL `_check_queue_rules` — for friendly messages BEFORE the RPC. The RPC remains the authority. */
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[]; max_orders_per_member: number }

export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string }
  | { code: "order_limit"; max: number };
```

```ts
/** Rows this account has waiting (pending + approved), excluding the playing one — mirrors SQL `_order_count`. */
export function countMyOrders(
  queue: Array<{ id: string; added_by_account_id: string | null }>,
  accountId: string | null, currentId: string | null,
): number {
  if (!accountId) return 0;
  return queue.filter((q) => q.added_by_account_id === accountId && q.id !== currentId).length;
}

/** null = unlimited (limit 0, or admin/dj); else max(0, limit - mine) — mirrors SQL `_orders_remaining`. */
export function ordersRemaining(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): number | null {
  const max = rules.max_orders_per_member;
  if (max <= 0 || exempt) return null;
  return Math.max(0, max - mine);
}

export function orderLimitViolation(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): RuleViolation | null {
  return ordersRemaining(rules, mine, exempt) === 0 ? { code: "order_limit", max: rules.max_orders_per_member } : null;
}
```

In `ruleMessage` add the case:

```ts
    case "order_limit": return `Bạn đã đặt đủ ${v.max} bài — chờ bài phát xong rồi đặt tiếp.`;
```

In `violationFromRpcError`, before the banned-keyword regex:

```ts
  if (e.message === "order limit reached") return { code: "order_limit", max: rules.max_orders_per_member };
```

Update the doc comment of `violationFromRpcError` to "raised by `_check_queue_rules` or the order limit (errcode 23514)".

- [ ] **Step 4: `lib/supabase.ts`**

`Room` interface — append to the last line of fields:

```ts
  max_duration_seconds: number; require_approval: boolean; banned_keywords: string[];
  max_orders_per_member: number;
```

`RoomSettings` + `updateRoomSettings`:

```ts
export interface RoomSettings { maxDurationSeconds: number; requireApproval: boolean; bannedKeywords: string[]; maxOrdersPerMember: number }
export async function updateRoomSettings(roomId: string, token: string, s: RoomSettings) {
  const { error } = await supabase.rpc("update_room_settings", {
    p_room_id: roomId, p_session_token: token,
    p_max_duration_seconds: s.maxDurationSeconds, p_require_approval: s.requireApproval, p_banned_keywords: s.bannedKeywords,
    p_max_orders_per_member: s.maxOrdersPerMember,
  });
  if (error) throw error;
}
```

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run tests/unit/queue-rules.test.ts && npx tsc --noEmit`
Expected: unit file green. **tsc will report errors** in `components/room/RoomShell.tsx` (the `rules` object literal lacks `max_orders_per_member`), `components/room/SettingsDialog.tsx` (`maxOrdersPerMember` missing) and `components/room/SearchResults.tsx` (`REASON[violation.code]` — `order_limit` not in the record). Fix them minimally in THIS task so the branch stays compilable:
  - `RoomShell.tsx`: `const rules = { max_duration_seconds: room.max_duration_seconds, banned_keywords: room.banned_keywords, max_orders_per_member: room.max_orders_per_member };`
  - `SettingsDialog.tsx`: pass `maxOrdersPerMember: room.max_orders_per_member` in the `updateRoomSettings` call (Task 3 replaces it with the field's value).
  - `SearchResults.tsx`: `const REASON: Record<RuleViolation["code"], string> = { too_long: "quá dài", unknown_duration: "không rõ thời lượng", banned: "từ khóa cấm", order_limit: "đủ order" };` (import `type RuleViolation`).

Re-run: `npx tsc --noEmit && npm run lint && npm test` → clean / 2 baseline warnings / `81 + new unit cases passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/queue-rules.ts lib/supabase.ts tests/unit/queue-rules.test.ts components/room/RoomShell.tsx components/room/SettingsDialog.tsx components/room/SearchResults.tsx
git commit -m "feat: queue-rules — order limit helpers (countMyOrders, ordersRemaining), copy, RPC mapping; Room/RoomSettings fields"
```

---

### Task 3: UI — counter, pre-checks, playlist notice, search rows, settings field, README

**Files:**
- Modify: `components/room/RoomShell.tsx`
- Modify: `components/room/AddSong.tsx`
- Modify: `components/room/SearchResults.tsx`
- Modify: `components/room/SettingsDialog.tsx`
- Modify: `README.md` (append a v11 section; file uses CRLF — keep it)

**Interfaces:**
- Consumes (Task 2): `countMyOrders`, `ordersRemaining`, `orderLimitViolation`, `ruleMessage`, `violationFromRpcError`, `RoomRules`, `RoomSettings.maxOrdersPerMember`, `Room.max_orders_per_member`.
- Produces: `AddSong` prop `orderLimit: { mine: number; exempt: boolean }`; `SearchResults` prop `orderLimit` (same shape).

- [ ] **Step 1: `RoomShell.tsx`**

Import: `import { countMyOrders } from "@/lib/queue-rules";`

After the `willPend` line:

```ts
  // Per-member order limit (v11): rows I have waiting (pending + approved), excluding the one playing. Admin/DJ exempt.
  const orderLimit = { mine: countMyOrders(state.queue, accountId, room.current_item_id), exempt: role.canManageQueue };
```

`<AddSong roomId={room.id} token={token} rules={rules} willPend={willPend} orderLimit={orderLimit} />`

- [ ] **Step 2: `AddSong.tsx`**

Imports: `import { checkQueueRules, orderLimitViolation, ordersRemaining, ruleMessage, violationFromRpcError, type RoomRules } from "@/lib/queue-rules";`

Props:

```ts
export default function AddSong({ roomId, token, rules, willPend, orderLimit }: {
  roomId: string; token: string; rules: RoomRules; willPend: boolean; orderLimit: { mine: number; exempt: boolean };
}) {
```

After `const link = …`:

```ts
  // null = unlimited / exempt (no counter); 0 = at the limit.
  const remaining = ordersRemaining(rules, orderLimit.mine, orderLimit.exempt);
```

In `onSubmit`, right after `if (!videoId && !playlistId) { setError("Link YouTube không hợp lệ."); return; }`:

```ts
    const limitViolation = orderLimitViolation(rules, orderLimit.mine, orderLimit.exempt);
    if (limitViolation) { setError(ruleMessage(limitViolation)); return; }
```

Playlist branch — replace the `skipped` / `setNotice(...)` block:

```ts
        const skipped = items.length - added;
        const hitLimit = remaining !== null && added < items.length && added >= remaining;
        setNotice(
          (hitLimit
            ? `Đã thêm ${added}/${items.length} bài — đạt giới hạn ${rules.max_orders_per_member} order.`
            : `Đã thêm ${added} bài từ playlist.` + (skipped > 0 ? ` Bỏ qua ${skipped} bài (quá dài / từ khóa cấm).` : "")) +
          (willPend && added > 0 ? " Đã gửi, chờ Admin/DJ duyệt." : ""),
        );
```

Counter — inside the `<form>` right after the submit `<button …>…</button>` and before `{error && …}`:

```tsx
        {remaining !== null && (
          <span className={`self-center whitespace-nowrap text-[11px] ${remaining === 0 ? "text-burgundy-accent" : "text-ink/60"}`}
            title="Số bài bạn đang đặt / giới hạn của phòng">
            Order: {orderLimit.mine}/{rules.max_orders_per_member}
          </span>
        )}
```

Forward to the results panel: `<SearchResults … rules={rules} willPend={willPend} orderLimit={orderLimit} onClose={() => setSearch(null)} />`

- [ ] **Step 3: `SearchResults.tsx`**

Imports: `import { checkQueueRules, ordersRemaining, ruleMessage, violationFromRpcError, type RoomRules, type RuleViolation } from "@/lib/queue-rules";` (the `REASON` record was already widened in Task 2).

Props:

```ts
export default function SearchResults({ query, results, roomId, token, rules, willPend, orderLimit, onClose }: {
  query: string; results: SearchResult[]; roomId: string; token: string; rules: RoomRules; willPend: boolean;
  orderLimit: { mine: number; exempt: boolean }; onClose: () => void;
}) {
```

After the `inFlight` ref:

```ts
  // At the limit every "+ Thêm" is disabled; `mine` updates live through realtime after each add.
  const atLimit = ordersRemaining(rules, orderLimit.mine, orderLimit.exempt) === 0;
  const limitTitle = atLimit ? ruleMessage({ code: "order_limit", max: rules.max_orders_per_member }) : undefined;
```

In `add(r)`: first line `if (atLimit) return;`.

Button:

```tsx
                  <button type="button" disabled={st.kind === "done" || atLimit} title={st.kind === "done" ? undefined : limitTitle}
                    onClick={() => add(r)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy disabled:opacity-60">
                    {st.kind === "done" ? (willPend ? "✓ Đã gửi" : "✓ Đã thêm") : "+ Thêm"}
                  </button>
```

- [ ] **Step 4: `SettingsDialog.tsx`**

Constant: `const MAX_ORDERS = 100;`

State (after `maxMinutes`): `const [maxOrders, setMaxOrders] = useState(String(room.max_orders_per_member));`

In `saveRules`, after the minutes validation:

```ts
    const orders = Number(maxOrders);
    if (!Number.isInteger(orders) || orders < 0 || orders > MAX_ORDERS) {
      setRulesMsg({ ok: false, text: `Số order tối đa phải từ 0 đến ${MAX_ORDERS}.` });
      return;
    }
```

Call: `await updateRoomSettings(roomId, token, { maxDurationSeconds: Math.round(mins * 60), requireApproval, bannedKeywords: keywords, maxOrdersPerMember: orders });`

Field — after the duration field's `<p className="mb-3 …">0 = không giới hạn</p>` and before the "Chờ duyệt" label:

```tsx
        <label className="mb-1 block text-sm text-ink">Số order tối đa mỗi người</label>
        <input type="number" min={0} max={MAX_ORDERS} step={1} value={maxOrders} onChange={(e) => setMaxOrders(e.target.value)}
          title="Số bài một thành viên được đặt cùng lúc (đang chờ + chờ duyệt; bài đang phát không tính). Admin/DJ không bị giới hạn."
          className="mb-1 w-28 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
        <p className="mb-3 text-[11px] text-ink/60">0 = không giới hạn</p>
```

- [ ] **Step 5: README — append after the v10 section (CRLF line endings)**

```markdown
## v11: Giới hạn số order mỗi người

### DB migration

`supabase/migrations/0009_v11_order_limit.sql` is **additive** (`add column if not exists`, `create or replace function`): run it in the Supabase SQL Editor (or `supabase db reset` on dev/staging). It drops and re-creates `update_room_settings` with one more optional argument — older clients that call it without the argument keep working.

### What's new in v11

- **Room rule (Admin + DJ)** in ⚙️ Setting → **Quy tắc hàng đợi** → *Số order tối đa mỗi người* (default **5**, `0` = unlimited, max 100): how many songs one member may have in the queue at once — pending **and** approved rows count, the song currently playing does not. **Admin and DJ are exempt.**
- Members see a live **`Order: 3/5`** counter next to the add box; at the limit the add box and every search-result **+ Thêm** button refuse with *"Bạn đã đặt đủ 5 bài — chờ bài phát xong rồi đặt tiếp."* The RPCs enforce the same rule (`order limit reached`), so it cannot be bypassed by calling the API directly.
- **Playlists** add as many songs as still fit, then stop: *"Đã thêm 2/10 bài — đạt giới hạn 5 order."* Songs skipped by the other rules do not use a slot.
- A slot frees up when the member's song starts playing, is rejected, or is withdrawn.
```

- [ ] **Step 6: Gates + manual check**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean / 2 baseline warnings / all green.

Manual (dev server on `http://localhost:3000`, two accounts): as Admin, ⚙️ → field `Số order tối đa mỗi người` shows 5; set 2, save → "Đã lưu quy tắc."; as a member, counter `Order: 0/2` next to the add box, add two songs → `Order: 2/2` in burgundy-accent, a third link → the violation message, search results' `+ Thêm` disabled with the tooltip; Admin skips a song → the counter drops and the buttons re-enable without reload; Admin/DJ see no counter.

- [ ] **Step 7: Commit**

```bash
git add components/room/RoomShell.tsx components/room/AddSong.tsx components/room/SearchResults.tsx components/room/SettingsDialog.tsx README.md
git commit -m "feat: v11 UI — order counter, limit pre-checks, playlist notice, settings field, README"
```

---

## Self-review

- **Spec coverage:** §2 migration/helpers/RPCs → Task 1; §3.1–3.2 → Task 2; §3.3–3.7 → Task 3; §4 error table → Task 1 (RPC copy/errcodes), Task 2 (mapping/message), Task 3 (pre-checks, playlist, settings validation); §5 unit → Task 2, integration → Task 1, migration validation → Task 1 Steps 2–3, manual → Task 3 Step 6.
- **Placeholders:** none — every step carries its code.
- **Type consistency:** `orderLimit: { mine: number; exempt: boolean }` identical in RoomShell → AddSong → SearchResults; `ordersRemaining(rules, mine, exempt)` and `orderLimitViolation(rules, mine, exempt)` match Task 2's signatures; `RoomSettings.maxOrdersPerMember` ↔ RPC `p_max_orders_per_member`; `RuleViolation["code"]` includes `order_limit` so `REASON` stays exhaustive.
- **Task 2 touches three component files** to keep `tsc` green mid-branch; Task 3 only extends those edits.
