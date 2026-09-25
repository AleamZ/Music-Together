-- =========================================================
-- 0015_anticheat.sql — the anti-cheat layer (docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md):
-- username rules and server-only system chat lines (H5), the queue metadata checks (H4), the daily cast cap (H2), the
-- evidence log, strikes, the 5-minute lock, the ban with the owner's wipe, and the guarded game RPCs.
-- ADDITIVE (no data drop) and re-runnable. Requires 0012 and 0013; does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. It starts in log mode: strikes are recorded, nobody is locked or banned.
-- Character classes (§6.1), written as PostgreSQL ARE escapes:
--   C controls                  \u0001-\u001f\u007f-\u009f
--   S odd spaces                \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000
--   Z invisible and format      \u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e
--                               \u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff
--   M combining marks (names)   \u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f
-- =========================================================

-- ---------- A. Accounts and chat (§6.1) ----------
-- The form register and login compare: NFC, trimmed, single spaces, lower case (R27).
create or replace function public._name_norm(t text) returns text
language sql immutable set search_path = public, extensions
as $$ select lower(regexp_replace(btrim(normalize(coalesce(t, ''), NFC)), ' {2,}', ' ', 'g')) $$;

-- The key reserved names are compared on: no accents, nothing but a–z and 0–9 (R28).
create or replace function public._name_key(t text) returns text
language sql stable set search_path = public, extensions
as $$ select regexp_replace(lower(extensions.unaccent(normalize(coalesce(t, ''), NFC))), '[^a-z0-9]+', '', 'g') $$;

-- A queue title (R26): C and S characters become spaces, Z characters go, runs of spaces collapse, at most 200 characters.
create or replace function public._clean_title(t text) returns text
language sql immutable set search_path = public, extensions
as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]', ' ', 'g'),
    '[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff]',
    '', 'g'), ' {2,}', ' ', 'g')), 200)
$$;

-- The thumbnail of a video (R25): YouTube's 16:9 picture, derived from the id.
create or replace function public._yt_thumb(p_video_id text) returns text
language sql immutable set search_path = public, extensions
as $$ select 'https://i.ytimg.com/vi/' || p_video_id || '/mqdefault.jpg' $$;

revoke all on function public._name_norm(text) from public, anon, authenticated;
revoke all on function public._name_key(text) from public, anon, authenticated;
revoke all on function public._clean_title(text) from public, anon, authenticated;
revoke all on function public._yt_thumb(text) from public, anon, authenticated;

-- 2–24 characters, no control, odd-space, invisible or combining character, no reserved name; unique on the
-- normalized form. The stored name is the NFC form with single spaces, and the username OUT parameter returns it.
create or replace function public.register(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text := regexp_replace(btrim(normalize(coalesce(p_username, ''), NFC)), ' {2,}', ' ', 'g');
begin
  if char_length(v_name) not between 2 and 24
     or v_name ~ '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]'
     or public._name_key(v_name) in ('aoca', 'hoptacxa', 'hethong', 'quantri', 'quantrivien', 'admin', 'root', 'system') then
    raise exception 'invalid username' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts a where public._name_norm(a.username) = public._name_norm(v_name)) then
    raise exception 'username already taken' using errcode = '23505';
  end if;
  account_id := gen_random_uuid(); username := v_name; token := encode(gen_random_bytes(32), 'hex');
  insert into public.accounts (id, username) values (account_id, v_name);
  insert into public.account_secrets (account_id, password_hash) values (account_id, crypt(p_password, gen_salt('bf')));
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

-- The same normalized lookup (an exact match first); a banned account learns it only after the right password.
create or replace function public.login(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text; v_banned boolean;
begin
  select a.id, a.username, s.password_hash, a.is_banned into account_id, username, v_hash, v_banned
  from public.accounts a join public.account_secrets s on s.account_id = a.id
  where public._name_norm(a.username) = public._name_norm(p_username)
  order by (lower(a.username) = lower(btrim(p_username))) desc, a.created_at
  limit 1;
  if account_id is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid username or password' using errcode = '28P01';
  end if;
  if v_banned then
    raise exception 'account banned' using errcode = '42501';
  end if;
  token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

grant execute on function public.register(text, text) to anon, authenticated;
grant execute on function public.login(text, text) to anon, authenticated;

-- A system line is written by a SECURITY DEFINER function only (RLS has no write policy); about_account_id is the
-- catcher of a catch line and the buyer of a land line (R12), so a wipe deletes exactly that account's lines (D6).
alter table public.chat_messages add column if not exists system boolean not null default false;
alter table public.chat_messages add column if not exists about_account_id uuid;
create index if not exists idx_chat_about on public.chat_messages (about_account_id) where system;

-- Backfill (touches only system = false rows): well-formed author-less announcer lines. Land lines keep no account (R13).
update public.chat_messages
   set system = true,
       about_account_id = substring(body from '^\[catch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|')::uuid
 where not system and account_id is null and username = 'Ao cá'
   and body ~ '^\[catch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[a-z_]{1,32}\|[0-9]{1,6}\] ';
update public.chat_messages set system = true
 where not system and account_id is null and username = 'Hợp tác xã' and body ~ '^\[land:[0-9]{1,2}\] ';

-- ---------- B. Queue (§6.2) ----------
-- An 11-character YouTube id or 'invalid video'; the title cleaned (else the id); the thumbnail derived from the id
-- (p_thumb is ignored); a duration outside 1–86 400 s is unknown (R24). The room rules, the order limit and the
-- approval status then run on these values.
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_name text; v_status text; v_pos double precision; v_id uuid;
        v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid video' using errcode = '22023';
  end if;
  v_title := coalesce(nullif(public._clean_title(p_title), ''), p_video_id);
  v_duration := case when p_duration between 1 and 86400 then p_duration end;
  select username into v_name from public.accounts where id = v_account;
  perform public._check_queue_rules(p_room_id, v_title, v_duration);
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
  values (p_room_id, p_video_id, v_title, public._yt_thumb(p_video_id), v_duration, v_account, v_name, v_pos, v_status)
  returning id into v_id;
  return v_id;
end; $$;

-- The playlist add: an element whose id fails the pattern is skipped, as an empty id is; the same title, thumbnail and
-- duration rules.
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision; v_remaining int;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_video text; v_title text; v_num numeric; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  v_remaining := public._orders_remaining(p_room_id, v_member, v_account);   -- null = unlimited
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    v_video := v_item->>'video_id';
    if v_video is null or v_video !~ '^[A-Za-z0-9_-]{11}$' then continue; end if;
    v_title := coalesce(nullif(public._clean_title(v_item->>'title'), ''), v_video);
    v_num := case when jsonb_typeof(v_item->'duration') = 'number' then floor((v_item->>'duration')::numeric) end;
    v_duration := case when v_num between 1 and 86400 then v_num::int end;
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
      p_room_id, v_video, v_title, public._yt_thumb(v_video), v_duration,
      v_account, v_name,
      case when v_status = 'pending' then 0 else v_base + v_idx end,
      v_status
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.add_queue_item(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.add_queue_items(uuid, text, jsonb) to anon, authenticated;

-- Existing rows (idempotent): every thumbnail becomes the derived one; a row whose id fails the pattern gets none.
update public.queue_items
   set thumbnail_url = case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end
 where thumbnail_url is distinct from
       (case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end);
update public.play_history
   set thumbnail_url = case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end
 where thumbnail_url is distinct from
       (case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end);

-- ---------- C. Tables (§8) ----------
-- Private, like every per-account table: RLS on, no policies, no grants — only the SECURITY DEFINER functions touch them.
create table if not exists public.anticheat_config (          -- exactly one row
  id boolean primary key default true check (id),
  mode text not null default 'log' check (mode in ('log', 'enforce')),
  mode_changed_at timestamptz not null default now(),
  mode_changed_by uuid references public.accounts(id) on delete set null
);
insert into public.anticheat_config (id) values (true) on conflict (id) do nothing;   -- a re-run never resets the mode

create table if not exists public.anticheat_status (          -- one row per account ever flagged or counted
  account_id uuid primary key references public.accounts(id) on delete cascade,
  strikes smallint not null default 0 check (strikes between 0 and 2),
  last_strike_at timestamptz,
  last_strike_code text,
  locked_until timestamptz,
  ban_state text check (ban_state in ('pending_wipe', 'wiped')),   -- null = not banned by the anti-cheat
  banned_at timestamptz,
  wiped_at timestamptz,                                          -- the last wipe; kept after a pardon (R11)
  pardoned_at timestamptz,
  pardoned_by uuid references public.accounts(id) on delete set null,
  hug_on date,
  hug_count smallint not null default 0,
  events_on date,
  events_count smallint not null default 0
);

create table if not exists public.anticheat_events (          -- the evidence log: append-only, never wiped, no FK
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,                                       -- snapshot
  code text not null,                                           -- §7.2 / §7.4 codes
  outcome text not null check (outcome in ('soft', 'log_only', 'root', 'in_lock', 'strike_1', 'strike_2')),
  rpc text not null,
  room_id uuid,
  detail jsonb not null default '{}'::jsonb,                    -- inputs + server context; never a session token
  client text,                                                  -- X-Client-Info, at most 100 characters
  user_agent text,                                              -- User-Agent, at most 200 characters
  created_at timestamptz not null default now()
);
create index if not exists idx_ac_events_account on public.anticheat_events (account_id, created_at desc);
create index if not exists idx_ac_events_purge on public.anticheat_events (created_at)
  where outcome in ('soft', 'log_only', 'root', 'in_lock');

create table if not exists public.anticheat_wipes (           -- one row per confirmed wipe
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,
  wiped_at timestamptz not null default now(),
  wiped_by uuid,                                                -- root; no FK, the row outlives accounts
  snapshot jsonb not null                                       -- _ac_holdings() at the moment of the wipe (§9.6)
);
create index if not exists idx_ac_wipes_account on public.anticheat_wipes (account_id, wiped_at desc);

alter table public.anticheat_config enable row level security;
alter table public.anticheat_status enable row level security;
alter table public.anticheat_events enable row level security;
alter table public.anticheat_wipes enable row level security;
revoke all on public.anticheat_config, public.anticheat_status, public.anticheat_events, public.anticheat_wipes
  from anon, authenticated;

-- The daily cast cap counts per Vietnam day (§6.3).
alter table public.fishing_profiles add column if not exists day_on date;
alter table public.fishing_profiles add column if not exists day_casts smallint not null default 0;

-- The 0013 reasons plus the last ledger row of a wipe (§9.6).
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe'));

-- ---------- D. Helpers (§9.2; private) ----------
-- Lock gate for the 35 game RPCs. Reads stay open, so the UI can show the countdown.
create or replace function public._ac_guard(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_until timestamptz;
begin
  select locked_until into v_until from public.anticheat_status where account_id = p_account;
  if v_until > now() then
    raise exception 'account locked' using errcode = '42501', hint = 'anticheat',
      detail = ceil(extract(epoch from (v_until - now())))::int::text;
  end if;
end $$;

-- The account of a game RPC: the session, then the lock.
create or replace function public._ac_account(p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._ac_guard(v_account);
  return v_account;
end $$;

-- The account of a room game RPC: membership and the visit (_farm_auth), then the lock.
create or replace function public._ac_play(p_room_id uuid, p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  perform public._ac_guard(v_account);
  return v_account;
end $$;

-- The running lock for the fishing state (R14): {until, code}, or null.
create or replace function public._ac_lock_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select case when s.locked_until > now() then jsonb_build_object('until', s.locked_until, 'code', s.last_strike_code) end
    from public.anticheat_status s where s.account_id = p_account
$$;

-- Record a flagged input (§9.2) and return the envelope. It never raises for the input itself (R1): the caller returns
-- the envelope, so PostgREST commits the evidence row and any strike. Hard signals escalate: strike 1 locks the game
-- actions for 5 minutes, strike 2 bans. Soft signals, log mode, root and anything during a lock or ban never escalate.
create or replace function public._ac_flag(p_account uuid, p_code text, p_rpc text, p_detail jsonb, p_room uuid default null,
                                           p_error text default null, p_hard boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_mode text; v_name text; v_root boolean; s public.anticheat_status; v_outcome text; v_today date := public._vn_today();
        v_write boolean; v_h json; v_client text; v_agent text;
begin
  select mode into v_mode from public.anticheat_config where id;
  select username, is_root into v_name, v_root from public.accounts where id = p_account;
  -- one account escalates one call at a time
  insert into public.anticheat_status (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into s from public.anticheat_status where account_id = p_account for update;
  -- a lone strike 1 expires after 30 days (D4)
  if s.strikes = 1 and s.last_strike_at <= now() - interval '30 days' and s.ban_state is null then
    update public.anticheat_status set strikes = 0 where account_id = p_account;
    s.strikes := 0;
  end if;
  v_outcome := case
    when not p_hard then 'soft'
    when v_mode is distinct from 'enforce' then 'log_only'
    when coalesce(v_root, false) then 'root'
    when s.ban_state is not null or s.locked_until > now() then 'in_lock'
    when s.strikes = 0 then 'strike_1'
    else 'strike_2' end;
  -- the evidence: every strike row, and at most 200 other rows per account and Vietnam day (R31)
  if v_outcome in ('strike_1', 'strike_2') then
    v_write := true;
  else
    if s.events_on is distinct from v_today then
      s.events_on := v_today;
      s.events_count := 0;
    end if;
    v_write := s.events_count < 200;
    if v_write then
      s.events_count := s.events_count + 1;
    end if;
    update public.anticheat_status set events_on = s.events_on, events_count = s.events_count where account_id = p_account;
  end if;
  if v_write then
    begin
      v_h := nullif(current_setting('request.headers', true), '')::json;
      v_client := left(v_h->>'x-client-info', 100);
      v_agent := left(v_h->>'user-agent', 200);
    exception when others then
      v_client := null;
      v_agent := null;
    end;
    insert into public.anticheat_events (account_id, username, code, outcome, rpc, room_id, detail, client, user_agent)
    values (p_account, coalesce(v_name, '?'), p_code, v_outcome, p_rpc, p_room, coalesce(p_detail, '{}'::jsonb), v_client, v_agent);
  end if;
  if v_outcome = 'strike_1' then
    update public.anticheat_status
       set strikes = 1, last_strike_at = now(), last_strike_code = p_code, locked_until = now() + interval '5 minutes'
     where account_id = p_account;
  elsif v_outcome = 'strike_2' then
    update public.anticheat_status
       set strikes = 2, last_strike_at = now(), last_strike_code = p_code, locked_until = null,
           ban_state = 'pending_wipe', banned_at = now()
     where account_id = p_account;
    update public.accounts set is_banned = true where id = p_account;
    delete from public.sessions where account_id = p_account;
  end if;
  -- the lazy purge (§8.4): soft, log-only, root and in-lock rows live 90 days
  delete from public.anticheat_events
   where id in (select id from public.anticheat_events
                 where outcome in ('soft', 'log_only', 'root', 'in_lock') and created_at < now() - interval '90 days'
                 order by created_at limit 500);
  return jsonb_build_object('anticheat', jsonb_build_object(
    'code', p_code,
    'strike', case v_outcome when 'strike_1' then 1 when 'strike_2' then 2 else 0 end,
    'error', p_error,
    'locked_until', case when v_outcome = 'strike_1' then now() + interval '5 minutes' end,
    'banned', v_outcome = 'strike_2',
    'server_now', now()));
end $$;

-- A won reel close to the time gate (§7.4): counted per Vietnam day, logged once, at the 20th (R20).
create or replace function public._ac_hug(p_account uuid, p_ratio numeric, p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_today date := public._vn_today(); v_count integer;
begin
  insert into public.anticheat_status as s (account_id, hug_on, hug_count) values (p_account, v_today, 1)
  on conflict (account_id) do update
    set hug_count = case when s.hug_on = v_today then s.hug_count + 1 else 1 end, hug_on = v_today
  returning hug_count into v_count;
  if v_count = 20 then
    perform public._ac_flag(p_account, 'reel_gate_hug', 'finish_cast',
                            jsonb_build_object('day', v_today, 'count', 20, 'ratio', p_ratio), p_room, null, false);
  end if;
end $$;

-- What a wipe removes (§9.6): the snapshot shape, and the preview in /admin.
create or replace function public._ac_holdings(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'wallet', (select jsonb_build_object('coins', w.coins, 'daily_on', w.daily_on, 'bonus_on', w.bonus_on,
                                         'bonus_count', w.bonus_count)
                 from public.wallets w where w.account_id = p_account),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'qty', i.qty) order by i.item_id)
                             from public.inventory i where i.account_id = p_account), '[]'::jsonb),
    'fishing_profile', (select jsonb_build_object('rod', p.rod, 'bobber', p.bobber, 'bait', p.bait)
                          from public.fishing_profiles p where p.account_id = p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('species_id', f.species_id, 'weight_g', f.weight_g, 'price', f.price,
                                                          'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'personal_bests', coalesce((select jsonb_agg(jsonb_build_object('species_id', b.species_id, 'weight_g', b.weight_g,
                                                                    'caught_at', b.caught_at) order by b.species_id)
                                  from public.personal_bests b where b.account_id = p_account), '[]'::jsonb),
    'rice', coalesce((select jsonb_agg(jsonb_build_object('variety', r.variety, 'wet_kg', r.wet_kg, 'dry_kg', r.dry_kg)
                                       order by r.variety)
                        from public.rice_stock r where r.account_id = p_account), '[]'::jsonb),
    'plots', coalesce((select jsonb_agg(jsonb_build_object('room_id', fp.room_id, 'plot_no', fp.plot_no, 'kind', fp.kind,
                                                           'owned_at', fp.owned_at, 'sale_price', fp.sale_price,
                                                           'sublease_price', fp.sublease_price) order by fp.room_id, fp.plot_no)
                         from public.field_plots fp where fp.owner_id = p_account), '[]'::jsonb),
    'leases', coalesce((select jsonb_agg(jsonb_build_object('room_id', pl.room_id, 'plot_no', pl.plot_no, 'source', pl.source,
                                                            'price', pl.price, 'until', pl.until) order by pl.room_id, pl.plot_no)
                          from public.plot_leases pl where pl.farmer_id = p_account), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('room_id', lo.room_id, 'plot_no', lo.plot_no, 'price', lo.price,
                                                            'created_at', lo.created_at) order by lo.created_at, lo.id)
                          from public.land_offers lo where lo.buyer_id = p_account), '[]'::jsonb),
    'crops', coalesce((select jsonb_agg(jsonb_build_object('room_id', c.room_id, 'plot_no', c.plot_no, 'variety', c.variety,
                                                           'transplant_at', c.transplant_at) order by c.room_id, c.plot_no)
                         from public.crops c where c.farmer_id = p_account), '[]'::jsonb),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('room_id', d.room_id, 'slot', d.slot, 'variety', d.variety,
                                                            'kg', d.kg, 'ready_at', d.ready_at) order by d.room_id, d.slot)
                          from public.drying_slots d where d.account_id = p_account), '[]'::jsonb),
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- The wipe of the owner (§9.6), under the wallet lock the admin RPC takes first: the snapshot, the last ledger row, the
-- game data of the account and its catch and land lines. Land is released by each room at its next sweep (step 0b).
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb := public._ac_holdings(p_account); v_id bigint; v_coins integer;
begin
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot)
  values (p_account, (select username from public.accounts where id = p_account), p_by, v_snap)
  returning id into v_id;
  select coins into v_coins from public.wallets where account_id = p_account;
  if found then
    insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, -v_coins, 0, 'wipe', 'wipe #' || v_id);
    delete from public.wallets where account_id = p_account;
  end if;
  delete from public.inventory where account_id = p_account;
  delete from public.casts where account_id = p_account;
  delete from public.fish where account_id = p_account;
  delete from public.fishing_profiles where account_id = p_account;
  delete from public.personal_bests where account_id = p_account;
  delete from public.rice_stock where account_id = p_account;
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

-- Pardon (§9.7): unbanned, no strike, no lock; wiped_at stays (R11). No data comes back (R8).
create or replace function public._ac_pardon(p_account uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.anticheat_status;
begin
  select * into s from public.anticheat_status where account_id = p_account for update;
  if not found or (s.ban_state is null and not coalesce(s.locked_until > now(), false)
                   and not coalesce(s.strikes >= 1 and s.last_strike_at > now() - interval '30 days', false)) then
    raise exception 'nothing to pardon' using errcode = '22023';
  end if;
  update public.accounts set is_banned = false where id = p_account;
  update public.anticheat_status
     set strikes = 0, last_strike_at = null, last_strike_code = null, locked_until = null, ban_state = null, banned_at = null,
         pardoned_at = now(), pardoned_by = p_by
   where account_id = p_account;
end $$;

revoke all on function public._ac_guard(uuid) from public, anon, authenticated;
revoke all on function public._ac_account(text) from public, anon, authenticated;
revoke all on function public._ac_play(uuid, text) from public, anon, authenticated;
revoke all on function public._ac_lock_state(uuid) from public, anon, authenticated;
revoke all on function public._ac_flag(uuid, text, text, jsonb, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public._ac_hug(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
revoke all on function public._ac_pardon(uuid, uuid) from public, anon, authenticated;

-- ---------- E. Guarded RPCs (§10.2, §10.3) ----------
-- Every game RPC runs _ac_account or _ac_play (the session, then the lock), then its hard checks, then its body. A flagged
-- input returns the envelope of _ac_flag instead of raising (R1). Signatures stay; each grant is repeated.

-- Fishing (bodies from 0012; buy_item, and finish_cast with the fish price index, from 0013).
create or replace function public.claim_daily(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_today date := public._vn_today();
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  if w.daily_on is not distinct from v_today then
    return jsonb_build_object('claimed', false, 'amount', 0, 'state', public._fishing_state(v_account));
  end if;
  update public.wallets set daily_on = v_today where account_id = v_account;
  perform public._pay(v_account, 20, 'daily', v_today::text);
  return jsonb_build_object('claimed', true, 'amount', 20, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.dig_worms(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_total integer; v_cap integer; v_gain integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    raise exception 'dig cooldown' using errcode = '53400',
      detail = ceil(extract(epoch from (p.last_dig_at + interval '45 seconds' - now())))::int::text;
  end if;
  v_total := public._bait_total(v_account);
  v_cap := public._bait_cap(v_account);
  if v_total >= v_cap then
    raise exception 'bait full' using errcode = '22023';
  end if;
  v_gain := least(1 + floor(random() * 3)::int, v_cap - v_total);
  insert into public.inventory (account_id, item_id, qty) values (v_account, 'bait_worm', v_gain)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  update public.fishing_profiles set last_dig_at = now() where account_id = v_account;
  return jsonb_build_object('gained', v_gain, 'state', public._fishing_state(v_account));
end; $$;

-- A farm item is a soft kind_mismatch (the old v14 client lists them as bait, §7.3); then the quantity is a hard bad_qty:
-- bait 1–99, gear exactly 1. An unknown or unpriced item still raises 'item not available', unlogged.
create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('rod','bobber','bait','bait_box','bucket') then
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if (it.kind = 'bait' and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind <> 'bait' and p_qty is distinct from 1) then
    return public._ac_flag(v_account, 'bad_qty', 'buy_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind = 'bait' then
    if public._bait_total(v_account) + p_qty > public._bait_cap(v_account) then
      raise exception 'bait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    -- the selected bait ran out → the bought bait becomes the selection
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) = 0 then
      update public.fishing_profiles set bait = it.id where account_id = v_account;
    end if;
  else
    if public._owns(v_account, it.id)
       or (it.kind = 'bait_box' and public._bait_cap(v_account) >= it.capacity)
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity) then
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, 1)
    on conflict (account_id, item_id) do update set qty = 1;
    -- a better rod / bobber (by price; starter = 0) is equipped right away
    if it.kind in ('rod', 'bobber') then
      select coalesce(price, 0) into v_equipped from public.shop_items where id = case when it.kind = 'rod' then p.rod else p.bobber end;
      if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

create or replace function public.set_loadout(p_session_token text, p_rod text, p_bobber text, p_bait text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_rod and kind = 'rod') or not public._owns(v_account, p_rod)
     or not exists (select 1 from public.shop_items where id = p_bobber and kind = 'bobber') or not public._owns(v_account, p_bobber)
     or not exists (select 1 from public.shop_items where id = p_bait and kind = 'bait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  update public.fishing_profiles set rod = p_rod, bobber = p_bobber, bait = p_bait where account_id = v_account;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

-- The daily cap (§6.3): 300 casts per Vietnam day after the hourly 40; the 300th cast is logged as a soft signal.
create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90))
  returning id into v_id;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'state', public._fishing_state(v_account));
end; $$;

-- finish_cast is 0013 section H's, which prices the catch with the room's fish price index. A won reel reported before
-- the time gate is the hard reel_too_fast (§7.2): still the lost answer, plus the envelope.
-- A catch within 5 % of the gate counts a gate hug (§7.4). The catch line is a system line about the catcher (§6.1).
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then   -- the existing gate, unchanged
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3)),
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account))
           || coalesce(v_ac, '{}'::jsonb);
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_fish(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  perform public._pay(v_account, v_sum, 'sell', v_count || ' con');
  return jsonb_build_object('sold', v_count, 'earned', v_sum, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.release_fish(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.fish where account_id = v_account and id = p_fish_id;
  if not found then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

grant execute on function public.claim_daily(text) to anon, authenticated;
grant execute on function public.dig_worms(text) to anon, authenticated;
grant execute on function public.buy_item(text, text, integer) to anon, authenticated;
grant execute on function public.set_loadout(text, text, text, text) to anon, authenticated;
grant execute on function public.start_cast(uuid, text) to anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.sell_fish(text, uuid[]) to anon, authenticated;
grant execute on function public.release_fish(text, uuid) to anon, authenticated;

-- Farm and land (cores from 0013). The 24 room wrappers become plpgsql: the lock gate, the hard checks of §10.3 in
-- order, then the unchanged core with now(). The checks run before the core, so before the room's sweep.
create or replace function public.rent_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'rent_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_rent(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.buy_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'buy_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_buy_plot(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.sell_plot_to_village(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'sell_plot_to_village', jsonb_build_object('plot', p_plot), p_room_id,
                           'invalid plot');
  end if;
  return public._farm_do_sell_to_village(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.list_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'list_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is not null and p_price not between 1 and 5000000 then
    return public._ac_flag(v_account, 'bad_price', 'list_plot', jsonb_build_object('plot', p_plot, 'price', p_price), p_room_id,
                           'invalid price');
  end if;
  return public._farm_do_list(p_room_id, v_account, p_plot, p_price, now());
end $$;

create or replace function public.buy_listed_plot(p_room_id uuid, p_session_token text, p_plot integer,
                                                  p_expected_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'buy_listed_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_buy_listed(p_room_id, v_account, p_plot, p_expected_price, now());
end $$;

create or replace function public.offer_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'offer_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is null or p_price not between 1 and 5000000 then
    return public._ac_flag(v_account, 'bad_price', 'offer_plot', jsonb_build_object('plot', p_plot, 'price', p_price), p_room_id,
                           'invalid price');
  end if;
  return public._farm_do_offer(p_room_id, v_account, p_plot, p_price, now());
end $$;

-- foreign_offer (§7.2): an offer of this room whose buyer is someone else (R18: another room's id is a plain refusal).
create or replace function public.withdraw_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_buyer uuid;
begin
  select lo.buyer_id into v_buyer from public.land_offers lo where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_buyer <> v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'withdraw_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'buyer_id', v_buyer), p_room_id, 'offer not found');
  end if;
  return public._farm_do_withdraw_offer(p_room_id, v_account, p_offer_id, now());
end $$;

-- foreign_offer: an offer of this room on a plot the caller does not own (every change of owner deletes its offers).
create or replace function public.decline_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_plot integer; v_owner uuid;
begin
  select lo.plot_no, fp.owner_id into v_plot, v_owner
    from public.land_offers lo join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
   where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_owner is distinct from v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'decline_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'plot', v_plot, 'owner_id', v_owner), p_room_id,
                           'offer not found');
  end if;
  return public._farm_do_decline_offer(p_room_id, v_account, p_offer_id, now());
end $$;

create or replace function public.accept_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_plot integer; v_owner uuid;
begin
  select lo.plot_no, fp.owner_id into v_plot, v_owner
    from public.land_offers lo join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
   where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_owner is distinct from v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'accept_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'plot', v_plot, 'owner_id', v_owner), p_room_id,
                           'not your plot');
  end if;
  return public._farm_do_accept_offer(p_room_id, v_account, p_offer_id, now());
end $$;

create or replace function public.set_sublease(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'set_sublease', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is not null and p_price not between 1 and 100000 then
    return public._ac_flag(v_account, 'bad_price', 'set_sublease', jsonb_build_object('plot', p_plot, 'price', p_price),
                           p_room_id, 'invalid price');
  end if;
  return public._farm_do_set_sublease(p_room_id, v_account, p_plot, p_price, now());
end $$;

create or replace function public.rent_sublease(p_room_id uuid, p_session_token text, p_plot integer,
                                                p_expected_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'rent_sublease', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_rent_sublease(p_room_id, v_account, p_plot, p_expected_price, now());
end $$;

create or replace function public.abandon_crop(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'abandon_crop', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_abandon(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.prepare_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'prepare_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_prepare(p_room_id, v_account, p_plot, now());
end $$;

-- kind_mismatch (§7.4) is soft: an existing item of another kind; an unknown item is the core's plain refusal.
create or replace function public.apply_fertilizer(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'apply_fertilizer', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'fertilizer' then
    return public._ac_flag(v_account, 'kind_mismatch', 'apply_fertilizer', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_fertilize(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.soak_seed(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'soak_seed', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'seed' then
    return public._ac_flag(v_account, 'kind_mismatch', 'soak_seed', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_soak(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.sow_seed(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'sow_seed', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_sow(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'begin_work', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_work is null or p_work not in ('transplant', 'harvest') then
    return public._ac_flag(v_account, 'bad_work', 'begin_work', jsonb_build_object('plot', p_plot, 'work', p_work), p_room_id,
                           'invalid work');
  end if;
  return public._farm_do_begin_work(p_room_id, v_account, p_plot, p_work, now());
end $$;

-- quality_range (§6.4): NaN is larger than every number, so the range test catches it; the detail keeps it as text.
create or replace function public.transplant(p_room_id uuid, p_session_token text, p_plot integer,
                                             p_quality double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'transplant', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_quality is null or p_quality not between 0.9 - 1e-9 and 1.1 + 1e-9 then
    return public._ac_flag(v_account, 'quality_range', 'transplant', jsonb_build_object('plot', p_plot, 'quality', p_quality::text),
                           p_room_id, 'invalid quality');
  end if;
  return public._farm_do_transplant(p_room_id, v_account, p_plot, p_quality, now());
end $$;

create or replace function public.water(p_room_id uuid, p_session_token text, p_plot integer, p_delta integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'water', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_delta is null or p_delta not in (1, -1) then
    return public._ac_flag(v_account, 'bad_water', 'water', jsonb_build_object('plot', p_plot, 'delta', p_delta),
                           p_room_id, 'invalid quantity');
  end if;
  return public._farm_do_water(p_room_id, v_account, p_plot, p_delta, now());
end $$;

create or replace function public.spray(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'spray', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'pesticide' then
    return public._ac_flag(v_account, 'kind_mismatch', 'spray', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_spray(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.pick_snails(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'pick_snails', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_pick_snails(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.harvest(p_room_id uuid, p_session_token text, p_plot integer,
                                          p_quality double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'harvest', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_quality is null or p_quality not between 0.9 - 1e-9 and 1.1 + 1e-9 then
    return public._ac_flag(v_account, 'quality_range', 'harvest', jsonb_build_object('plot', p_plot, 'quality', p_quality::text),
                           p_room_id, 'invalid quality');
  end if;
  return public._farm_do_harvest(p_room_id, v_account, p_plot, p_quality, now());
end $$;

create or replace function public.dry_start(p_room_id uuid, p_session_token text, p_variety text, p_kg integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_kg is null or p_kg < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'dry_start', jsonb_build_object('variety', p_variety, 'kg', p_kg), p_room_id,
                           'invalid quantity');
  end if;
  return public._farm_do_dry_start(p_room_id, v_account, p_variety, p_kg, now());
end $$;

-- bad_slot (R17): the drying panel only offers slots 1–4.
create or replace function public.dry_collect(p_room_id uuid, p_session_token text, p_slot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_slot is null or p_slot not between 1 and 4 then
    return public._ac_flag(v_account, 'bad_slot', 'dry_collect', jsonb_build_object('slot', p_slot), p_room_id, 'invalid slot');
  end if;
  return public._farm_do_dry_collect(p_room_id, v_account, p_slot, now());
end $$;

-- The account-only farm RPCs (bodies from 0013).
create or replace function public.sell_rice(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 or p_dry is null then
    return public._ac_flag(v_account, 'bad_qty', 'sell_rice', jsonb_build_object('variety', p_variety, 'kg', p_kg, 'dry', p_dry),
                           null, 'invalid quantity');
  end if;
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
  end if;
  select * into rs from public.rice_stock where account_id = v_account and variety = p_variety for update;
  if not found or (case when p_dry then rs.dry_kg else rs.wet_kg end) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  v_pay := case when p_dry then p_kg * v.price_per_kg else (p_kg * v.price_per_kg * 7) / 10 end;
  update public.rice_stock
     set dry_kg = dry_kg - case when p_dry then p_kg else 0 end, wet_kg = wet_kg - case when p_dry then 0 else p_kg end
   where account_id = v_account and variety = p_variety;
  perform public._pay(v_account, v_pay, 'rice_sell',
                      p_variety || case when p_dry then ' dry ' else ' wet ' end || p_kg || ' kg');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- A fishing item is a soft kind_mismatch, a quantity outside 1–99 a hard bad_qty; more than 99 held stays a plain refusal.
create or replace function public.buy_farm_item(p_session_token text, p_item_id text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_cost integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('seed', 'fertilizer', 'pesticide') then
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_farm_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_account, 'bad_qty', 'buy_farm_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  v_cost := it.price * p_qty;
  if w.coins < v_cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(v_account, -v_cost, 'farm_buy', it.id || ' x' || p_qty);
  insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

create or replace function public.claim_farm_gift(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_gifted boolean;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  insert into public.farm_profiles (account_id) values (v_account) on conflict (account_id) do nothing;
  update public.farm_profiles set gift_at = now() where account_id = v_account and gift_at is null;
  v_gifted := found;
  if v_gifted then
    insert into public.inventory (account_id, item_id, qty) values (v_account, 'seed_short', 1), (v_account, 'fert_urea', 1)
    on conflict (account_id, item_id) do update set qty = least(99, public.inventory.qty + 1);
  end if;
  return jsonb_build_object('gifted', v_gifted, 'server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- A player-to-player sale (0013): the announcement is a system line about the buyer (R12); nothing else changes.
create or replace function public._land_sale(p_room uuid, p_plot integer, p_buyer uuid, p_price integer, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seller uuid;
begin
  select owner_id into v_seller from public.field_plots where room_id = p_room and plot_no = p_plot;
  perform public._wallet_lock(p_buyer);
  perform public._wallet_lock(v_seller);
  perform public._pay(p_buyer, -p_price, 'land_buy', 'plot ' || p_plot);
  perform public._pay(v_seller, p_price, 'land_sell', 'plot ' || p_plot);
  update public.field_plots set owner_id = p_buyer, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
  values (p_room, null, 'Hợp tác xã',
          format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', p_plot,
                 (select username from public.accounts where id = p_buyer), p_plot,
                 (select username from public.accounts where id = v_seller),
                 replace(to_char(p_price, 'FM9,999,999'), ',', '.')),
          true, p_buyer);
  delete from public.chat_messages
   where room_id = p_room
     and id not in (select id from public.chat_messages where room_id = p_room order by created_at desc limit 200);
end; $$;
revoke all on function public._land_sale(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;

grant execute on function public.rent_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.buy_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_plot_to_village(uuid, text, integer) to anon, authenticated;
grant execute on function public.list_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.buy_listed_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.offer_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.withdraw_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.decline_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.accept_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.set_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.rent_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.abandon_crop(uuid, text, integer) to anon, authenticated;
grant execute on function public.prepare_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.apply_fertilizer(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.soak_seed(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.sow_seed(uuid, text, integer) to anon, authenticated;
grant execute on function public.begin_work(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.transplant(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.water(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.spray(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.pick_snails(uuid, text, integer) to anon, authenticated;
grant execute on function public.harvest(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.dry_start(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.dry_collect(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_rice(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
grant execute on function public.claim_farm_gift(text) to anon, authenticated;

-- ---------- F. Shared functions (§10.4) ----------
-- The fishing state of 0013 plus the daily cap (casts_today_left, day_resets_at) and the running lock (R14).
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
        v_today date := public._vn_today(); v_day_left integer;
begin
  select * into w from public.wallets where account_id = p_account;
  select * into p from public.fishing_profiles where account_id = p_account;
  if p.window_start is not null and now() < p.window_start + interval '1 hour' then
    v_resets := p.window_start + interval '1 hour';
    v_left := greatest(0, 40 - p.window_casts);
  else
    v_resets := null;
    v_left := 40;
  end if;
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    v_dig := p.last_dig_at + interval '45 seconds';
  else
    v_dig := null;
  end if;
  v_day_left := case when p.day_on = v_today then greatest(0, 300 - p.day_casts) else 300 end;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = v_today, false),
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1 and s.kind in ('rod','bobber','bait_box','bucket')),
                      '[]'::jsonb),
    'bait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0))
               from public.shop_items s
               left join public.inventory i on i.item_id = s.id and i.account_id = p_account
              where s.kind = 'bait'),
    'bait_cap', public._bait_cap(p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g,
                                                          'price', f.price, 'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'fish_cap', 1 + public._bucket_cap(p_account),
    'casts_left', v_left,
    'window_resets_at', v_resets,
    'dig_ready_at', v_dig,
    'server_now', now(),
    'casts_today_left', v_day_left,
    'day_resets_at', case when v_day_left = 0 then (v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end,
    'lock', public._ac_lock_state(p_account)
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- The sweep of 0013 with step 0 first: a banned account leaves the land market (R10), and a wipe releases what the
-- account held at the time of the wipe, without refund (R11). Step 0 runs before the reclaim (step 3), so a wiped owner
-- is never refunded, and before the auto-collect (step 7), so a wiped batch never becomes dry rice.
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots;
begin
  -- 0a. banned accounts (review pending or wiped) leave the land market
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.ban_state is not null;
  update public.field_plots fp set sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.ban_state is not null
     and (fp.sale_price is not null or fp.sublease_price is not null);
  -- 0b. a wipe releases what the account held at the time of the wipe, without refund
  delete from public.plot_leases pl using public.anticheat_status s
   where pl.room_id = p_room and s.account_id = pl.farmer_id and s.wiped_at is not null and pl.starts_at <= s.wiped_at;
  update public.field_plots fp set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.wiped_at is not null
     and (fp.owned_at is null or fp.owned_at <= s.wiped_at);
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.wiped_at is not null and lo.created_at <= s.wiped_at;
  delete from public.drying_slots ds using public.anticheat_status s
   where ds.room_id = p_room and s.account_id = ds.account_id and s.wiped_at is not null
     and ds.ready_at <= s.wiped_at + interval '3 hours';
  -- 0c. offers on a plot that has no owner any more (a release above, or a deleted account)
  delete from public.land_offers lo using public.field_plots fp
   where lo.room_id = p_room and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id is null;
  -- 1. leases end (the leaseholder's crop goes in step 4)
  delete from public.plot_leases where room_id = p_room and until <= p_now;
  -- 2. offers expire after 24 h
  delete from public.land_offers where room_id = p_room and created_at <= p_now - interval '24 hours';
  -- 3. reclaim: the owner left the room or has not visited it for 14 days, and the plot is not leased out (§7.6)
  for f in select fp.* from public.field_plots fp
            where fp.room_id = p_room and fp.owner_id is not null
              and not exists (select 1 from public.members m
                               where m.room_id = p_room and m.account_id = fp.owner_id
                                 and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days')
              and not exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = fp.plot_no)
            order by fp.plot_no loop
    update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
     where room_id = p_room and plot_no = f.plot_no;
    delete from public.land_offers where room_id = p_room and plot_no = f.plot_no;
    perform public._wallet_lock(f.owner_id);
    perform public._pay(f.owner_id, 400000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and rv.id = cr.variety and cr.transplant_at is not null
     and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;

-- The song bonus of 0012, which never pays a banned account (R30).
create or replace function public._song_bonus() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare q public.queue_items; w public.wallets; v_today date;
begin
  begin
    select * into q from public.queue_items where id = old.current_item_id;
    if not found or q.added_by_account_id is null or coalesce(q.duration_seconds, 0) < 60
       or old.item_began_at is null
       or extract(epoch from (now() - old.item_began_at)) < 0.75 * q.duration_seconds
       or exists (select 1 from public.accounts a where a.id = q.added_by_account_id and a.is_banned) then
      return null;
    end if;
    v_today := public._vn_today();
    w := public._wallet_lock(q.added_by_account_id);
    if w.bonus_on is distinct from v_today then
      update public.wallets set bonus_on = v_today, bonus_count = 0 where account_id = q.added_by_account_id;
      w.bonus_count := 0;
    end if;
    if w.bonus_count >= 10 then
      return null;
    end if;
    update public.wallets set bonus_count = bonus_count + 1 where account_id = q.added_by_account_id;
    perform public._pay(q.added_by_account_id, 10, 'song', left(q.title, 80));
  exception when others then
    raise warning 'song bonus skipped: %', sqlerrm;
  end;
  return null;
end; $$;
revoke all on function public._song_bonus() from public, anon, authenticated;

-- The board of 0013 section H (with the room's fish prices) without banned accounts: no record, no place among the
-- richest, no rank (R30).
create or replace function public.fishing_board(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins integer; v_rank integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  v_coins := coalesce((select coins from public.wallets where account_id = v_account), 0);
  select 1 + count(*) into v_rank
    from public.members m join public.wallets w on w.account_id = m.account_id
    join public.accounts a on a.id = m.account_id
   where m.room_id = p_room_id and w.coins > v_coins and not a.is_banned;
  return jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', r.species_id, 'username', r.username, 'weight_g', r.weight_g)
                       order by r.species_id)
        from (select distinct on (pb.species_id) pb.species_id, a.username, pb.weight_g
                from public.personal_bests pb
                join public.members m on m.account_id = pb.account_id and m.room_id = p_room_id
                join public.accounts a on a.id = pb.account_id and not a.is_banned
               order by pb.species_id, pb.weight_g desc, pb.caught_at asc) r), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', species_id, 'weight_g', weight_g) order by species_id)
        from public.personal_bests where account_id = v_account), '[]'::jsonb),
    'richest', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'coins', t.coins) order by t.coins desc, t.username)
        from (select a.username, w.coins
                from public.members m
                join public.wallets w on w.account_id = m.account_id
                join public.accounts a on a.id = m.account_id
               where m.room_id = p_room_id and w.coins > 0 and not a.is_banned
               order by w.coins desc, a.username
               limit 10) t), '[]'::jsonb),
    'my_rank', v_rank,
    'my_coins', v_coins,
    'prices', public._fish_prices(p_room_id, now()));
end; $$;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;

-- ---------- G. Admin (§10.5): root only, granted like the other admin_* RPCs ----------
-- One case as the /admin tab lists it; null for an unknown account.
create or replace function public._ac_case(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'account_id', a.id, 'username', a.username, 'is_root', a.is_root, 'is_banned', a.is_banned,
    'strikes', coalesce(s.strikes, 0),
    'active_strikes', case when s.ban_state is not null then 2
                           when s.strikes >= 1 and s.last_strike_at > now() - interval '30 days' then 1 else 0 end,
    'last_strike_at', s.last_strike_at, 'last_strike_code', s.last_strike_code,
    'locked_until', case when s.locked_until > now() then s.locked_until end,
    'ban_state', s.ban_state, 'banned_at', s.banned_at, 'wiped_at', s.wiped_at, 'pardoned_at', s.pardoned_at,
    'hard_events', (select count(*) from public.anticheat_events e where e.account_id = a.id and e.outcome <> 'soft'),
    'soft_events', (select count(*) from public.anticheat_events e where e.account_id = a.id and e.outcome = 'soft'),
    'last_event_at', (select max(e.created_at) from public.anticheat_events e where e.account_id = a.id))
  from public.accounts a left join public.anticheat_status s on s.account_id = a.id
  where a.id = p_account
$$;
revoke all on function public._ac_case(uuid) from public, anon, authenticated;

-- The mode and the cases: pending wipes first, then running locks, then by the last event; at most 200.
create or replace function public.admin_anticheat_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.anticheat_config;
begin
  perform public._auth_root(p_session_token);
  select * into c from public.anticheat_config where id;
  return jsonb_build_object(
    'mode', coalesce(c.mode, 'log'), 'mode_changed_at', c.mode_changed_at, 'server_now', now(),
    'cases', coalesce((
      select jsonb_agg(public._ac_case(x.account_id) order by x.pending desc, x.locked desc, x.last_event_at desc nulls last)
        from (select s.account_id,
                     coalesce(s.ban_state = 'pending_wipe', false) as pending,
                     coalesce(s.locked_until > now(), false) as locked,
                     (select max(e.created_at) from public.anticheat_events e where e.account_id = s.account_id) as last_event_at
                from public.anticheat_status s
               where s.strikes > 0 or s.ban_state is not null or s.locked_until > now() or s.pardoned_at is not null
                  or exists (select 1 from public.anticheat_events e
                              where e.account_id = s.account_id and e.created_at > now() - interval '90 days')
               order by pending desc, locked desc, last_event_at desc nulls last
               limit 200) x), '[]'::jsonb));
end $$;

-- One account: the case, what a wipe would remove now, the newest 300 events and the wipes with their snapshots.
create or replace function public.admin_anticheat_account(p_session_token text, p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object(
    'case', public._ac_case(p_account_id),
    'holdings', public._ac_holdings(p_account_id),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'created_at', e.created_at, 'code', e.code, 'outcome', e.outcome,
                                          'rpc', e.rpc, 'room_id', e.room_id, 'detail', e.detail, 'client', e.client,
                                          'user_agent', e.user_agent) order by e.created_at desc, e.id desc)
        from (select * from public.anticheat_events where account_id = p_account_id
               order by created_at desc, id desc limit 300) e), '[]'::jsonb),
    'wipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'wiped_at', w.wiped_at, 'wiped_by', a.username, 'snapshot', w.snapshot)
                       order by w.wiped_at desc, w.id desc)
        from public.anticheat_wipes w left join public.accounts a on a.id = w.wiped_by
       where w.account_id = p_account_id), '[]'::jsonb));
end $$;

-- 'wipe' (§9.6: the wallet row, then the status row — R16) or 'pardon' (§9.7); the answer is the updated case.
create or replace function public.admin_anticheat_resolve(p_session_token text, p_account_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); s public.anticheat_status;
begin
  if p_action is null or p_action not in ('wipe', 'pardon') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_action = 'wipe' then
    if not exists (select 1 from public.accounts where id = p_account_id) then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._wallet_lock(p_account_id);
    select * into s from public.anticheat_status where account_id = p_account_id for update;
    if not found or s.ban_state is distinct from 'pending_wipe' then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._ac_wipe(p_account_id, v_root);
  else
    perform public._ac_pardon(p_account_id, v_root);
  end if;
  return public._ac_case(p_account_id);
end $$;

-- log or enforce; switching to log lifts the running locks, bans stay (R6).
create or replace function public.admin_anticheat_set_mode(p_session_token text, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); c public.anticheat_config;
begin
  if p_mode is null or p_mode not in ('log', 'enforce') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  update public.anticheat_config set mode = p_mode, mode_changed_at = now(), mode_changed_by = v_root where id
  returning * into c;
  if p_mode = 'log' then
    update public.anticheat_status set locked_until = null where locked_until > now();
  end if;
  return jsonb_build_object('mode', c.mode, 'mode_changed_at', c.mode_changed_at);
end $$;

-- The Accounts tab's unban of an anti-cheat ban is the pardon (R9); everything else as in 0005.
create or replace function public.admin_set_ban(p_session_token text, p_account_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot ban yourself' using errcode='42501'; end if;
  if not p_banned and exists (select 1 from public.anticheat_status where account_id = p_account_id and ban_state is not null) then
    perform public._ac_pardon(p_account_id, v_self);
    return;
  end if;
  update public.accounts set is_banned = p_banned where id = p_account_id;
  if p_banned then delete from public.sessions where account_id = p_account_id; end if;
end; $$;

grant execute on function public.admin_anticheat_list(text) to anon, authenticated;
grant execute on function public.admin_anticheat_account(text, uuid) to anon, authenticated;
grant execute on function public.admin_anticheat_resolve(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_anticheat_set_mode(text, text) to anon, authenticated;
grant execute on function public.admin_set_ban(text, uuid, boolean) to anon, authenticated;
