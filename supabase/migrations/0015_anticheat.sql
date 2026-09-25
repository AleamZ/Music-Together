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
