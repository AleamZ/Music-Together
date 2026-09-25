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
