-- =========================================================
-- 0004_v2_rebuild.sql — v2 teardown + rebuild (account-based auth)
-- Re-runnable AND self-contained: ensures pgcrypto exists, then drops v1 objects.
-- Every function relies on `set search_path = public, extensions`.
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

drop function if exists public._auth_member(uuid,uuid,text,text)                       cascade;
drop function if exists public.create_room(text,text,text)                             cascade;
drop function if exists public.join_room(text,text,text)                               cascade;
drop function if exists public.add_queue_item(uuid,uuid,text,text,text,text,integer)   cascade;
drop function if exists public.advance_queue(uuid,uuid,text)                           cascade;
drop function if exists public.set_playback(uuid,uuid,text,boolean,timestamptz,integer) cascade;
drop function if exists public.seek_playback(uuid,uuid,text,integer)                   cascade;
drop function if exists public.reorder_item(uuid,uuid,text,uuid,double precision)      cascade;
drop function if exists public.bump_to_top(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.delete_item(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.set_play_mode(uuid,uuid,text,text)                      cascade;
drop function if exists public.assign_dj(uuid,uuid,text,uuid)                          cascade;
drop function if exists public.transfer_admin(uuid,uuid,text,uuid)                     cascade;
drop function if exists public.kick_member(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.rename_room(uuid,uuid,text,text)                        cascade;

drop table if exists
  public.play_history, public.queue_items, public.member_secrets,
  public.members, public.room_secrets, public.rooms
cascade;
-- DROP TABLE auto-removes tables from publication supabase_realtime; re-added in Part 8.

-- =========================================================
-- Part 2 — tables + indexes + RLS + SELECT policies
-- =========================================================
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  created_at timestamptz not null default now()
);
create unique index accounts_username_lower_uniq on public.accounts (lower(username));

create table public.account_secrets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  password_hash text not null
);

create table public.sessions (
  token_hash text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index idx_sessions_account on public.sessions (account_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  play_mode text not null default 'order' check (play_mode in ('order','shuffle')),
  admin_member_id uuid, dj_member_id uuid, current_item_id uuid,
  is_playing boolean not null default false,
  started_at timestamptz, paused_elapsed_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);
create table public.members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (room_id, account_id)
);
create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null, title text not null, thumbnail_url text,
  duration_seconds integer,
  added_by_account_id uuid references public.accounts(id) on delete set null,
  added_by_name text not null,
  position double precision not null,
  created_at timestamptz not null default now()
);
create table public.play_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null, title text not null,
  added_by_name text, played_at timestamptz not null default now()
);

alter table public.rooms
  add constraint rooms_admin_member_fk foreign key (admin_member_id) references public.members(id) on delete set null,
  add constraint rooms_dj_member_fk    foreign key (dj_member_id)    references public.members(id) on delete set null,
  add constraint rooms_current_item_fk foreign key (current_item_id) references public.queue_items(id) on delete set null;

create index idx_queue_items_room_position on public.queue_items (room_id, position);
create index idx_members_room              on public.members (room_id);
create index idx_members_account           on public.members (account_id);
create index idx_play_history_room_played  on public.play_history (room_id, played_at desc);

alter table public.accounts        enable row level security;
alter table public.account_secrets enable row level security;
alter table public.sessions        enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_secrets    enable row level security;
alter table public.members         enable row level security;
alter table public.queue_items     enable row level security;
alter table public.play_history    enable row level security;

create policy accounts_select     on public.accounts     for select to anon using (true);
create policy rooms_select        on public.rooms        for select to anon using (true);
create policy members_select      on public.members      for select to anon using (true);
create policy queue_items_select  on public.queue_items  for select to anon using (true);
create policy play_history_select on public.play_history for select to anon using (true);
-- account_secrets, room_secrets, sessions: RLS on, NO policies -> never client-readable.

-- =========================================================
-- Part 3 — auth helpers _auth_account, _auth
-- =========================================================
create or replace function public._auth_account(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text := encode(digest(p_session_token, 'sha256'), 'hex'); v_account uuid;
begin
  update public.sessions set last_seen = now() where token_hash = v_hash returning account_id into v_account;
  if v_account is null then raise exception 'invalid session' using errcode = '42501'; end if;
  return v_account;
end; $$;
revoke all on function public._auth_account(text) from public, anon, authenticated;

create or replace function public._auth(p_room_id uuid, p_session_token text, p_required_role text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_member_id uuid; v_admin uuid; v_dj uuid;
begin
  v_account := public._auth_account(p_session_token);
  select id into v_member_id from public.members where room_id = p_room_id and account_id = v_account;
  if not found then raise exception 'account is not a member of this room' using errcode = '42501'; end if;
  select admin_member_id, dj_member_id into v_admin, v_dj from public.rooms where id = p_room_id;
  if p_required_role = 'admin' and v_admin is distinct from v_member_id then
    raise exception 'admin role required' using errcode = '42501';
  elsif p_required_role = 'dj' and v_dj is distinct from v_member_id then
    raise exception 'dj role required' using errcode = '42501';
  elsif p_required_role = 'admin_or_dj' and v_admin is distinct from v_member_id and v_dj is distinct from v_member_id then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;
  return v_member_id;
end; $$;
revoke all on function public._auth(uuid,text,text) from public, anon, authenticated;

-- =========================================================
-- Part 4 — account RPCs (register / login / me / logout)
-- =========================================================
create or replace function public.register(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
begin
  if exists (select 1 from public.accounts a where lower(a.username) = lower(p_username)) then
    raise exception 'username already taken' using errcode = '23505';
  end if;
  account_id := gen_random_uuid(); username := p_username; token := encode(gen_random_bytes(32), 'hex');
  insert into public.accounts (id, username) values (account_id, p_username);
  insert into public.account_secrets (account_id, password_hash) values (account_id, crypt(p_password, gen_salt('bf')));
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

create or replace function public.login(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text;
begin
  select a.id, a.username, s.password_hash into account_id, username, v_hash
  from public.accounts a join public.account_secrets s on s.account_id = a.id
  where lower(a.username) = lower(p_username);
  if account_id is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid username or password' using errcode = '28P01';
  end if;
  token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

create or replace function public.me(p_token text, out account_id uuid, out username text)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  account_id := public._auth_account(p_token);
  select a.username into username from public.accounts a where a.id = account_id;
end; $$;

create or replace function public.logout(p_token text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex');
end; $$;

-- =========================================================
-- Part 5 — create_room + join_room (session-based)
-- =========================================================
create or replace function public.create_room(
  p_room_name text, p_password text, p_session_token text,
  out code text, out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_code text;
begin
  v_account := public._auth_account(p_session_token);
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  room_id := gen_random_uuid(); code := v_code;
  insert into public.rooms (id, code, name, play_mode) values (room_id, v_code, p_room_name, 'order');
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, account_id) values (room_id, v_account) returning id into member_id;
  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end; $$;

create or replace function public.join_room(
  p_code text, p_password text, p_session_token text,
  out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
#variable_conflict use_column
declare v_account uuid; v_room uuid; v_hash text;
begin
  v_account := public._auth_account(p_session_token);
  select r.id, s.password_hash into v_room, v_hash
  from public.rooms r join public.room_secrets s on s.room_id = r.id
  where r.code = p_code;
  if v_room is null then raise exception 'room not found' using errcode = 'P0002'; end if;
  room_id := v_room;

  select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
  if found then return; end if;  -- already a member: skip password

  if crypt(p_password, v_hash) <> v_hash then raise exception 'invalid password' using errcode = '28P01'; end if;
  insert into public.members (room_id, account_id) values (v_room, v_account)
  on conflict (room_id, account_id) do nothing returning id into member_id;
  if member_id is null then
    select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
  end if;
end; $$;

-- =========================================================
-- Part 6 — add_queue_item + advance_queue (full)
-- =========================================================
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_pos double precision; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, v_account, v_name, v_pos)
  returning id into v_id;
  return v_id;
end; $$;

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
    select id into v_next from public.queue_items where room_id = p_room_id order by random() limit 1;
  else
    select id into v_next from public.queue_items where room_id = p_room_id order by position asc limit 1;
  end if;
  update public.rooms set
    current_item_id = v_next,
    started_at = case when v_next is not null then now() else null end,
    is_playing = v_next is not null, paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end; $$;

-- =========================================================
-- Part 7 — mechanically-ported RPCs (signature updated; body from 0002_rpc.sql; only auth line changed)
-- =========================================================

-- ---------- set_playback (DJ only) ----------
create or replace function public.set_playback(
  p_room_id uuid, p_session_token text,
  p_is_playing boolean, p_started_at timestamptz, p_paused_elapsed_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'dj');
  update public.rooms set
    is_playing = p_is_playing, started_at = p_started_at,
    paused_elapsed_ms = coalesce(p_paused_elapsed_ms, 0)
  where id = p_room_id;
end;
$$;

-- ---------- seek_playback (DJ only) ----------
create or replace function public.seek_playback(
  p_room_id uuid, p_session_token text, p_position_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_playing boolean;
begin
  perform public._auth(p_room_id, p_session_token, 'dj');
  select is_playing into v_playing from public.rooms where id = p_room_id;
  update public.rooms set
    started_at = case when v_playing then now() - make_interval(secs => p_position_ms / 1000.0) else null end,
    paused_elapsed_ms = p_position_ms
  where id = p_room_id;
end;
$$;

-- ---------- reorder_item (admin or dj) ----------
create or replace function public.reorder_item(
  p_room_id uuid, p_session_token text, p_item_id uuid, p_new_position double precision
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  update public.queue_items set position = p_new_position where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- bump_to_top (admin or dj) ----------
create or replace function public.bump_to_top(
  p_room_id uuid, p_session_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_min double precision;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  select coalesce(min(position), 0) into v_min from public.queue_items where room_id = p_room_id;
  update public.queue_items set position = v_min - 1 where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- delete_item (admin or dj) ----------
create or replace function public.delete_item(
  p_room_id uuid, p_session_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  if exists (select 1 from public.rooms where id = p_room_id and current_item_id = p_item_id) then
    raise exception 'cannot delete the currently playing item' using errcode = '42501';
  end if;
  delete from public.queue_items where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- set_play_mode (admin) ----------
create or replace function public.set_play_mode(
  p_room_id uuid, p_session_token text, p_play_mode text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin');
  if p_play_mode not in ('order','shuffle') then
    raise exception 'invalid play_mode' using errcode = '22023';
  end if;
  update public.rooms set play_mode = p_play_mode where id = p_room_id;
end;
$$;

-- ---------- assign_dj (admin) ----------
create or replace function public.assign_dj(
  p_room_id uuid, p_session_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin');
  if p_target_member is not null and not exists (
       select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set dj_member_id = p_target_member where id = p_room_id;
end;
$$;

-- ---------- transfer_admin (admin) ----------
create or replace function public.transfer_admin(
  p_room_id uuid, p_session_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin');
  if not exists (select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set admin_member_id = p_target_member where id = p_room_id;
end;
$$;

-- ---------- rename_room (admin) ----------
create or replace function public.rename_room(
  p_room_id uuid, p_session_token text, p_new_name text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin');
  update public.rooms set name = p_new_name where id = p_room_id;
end;
$$;

-- =========================================================
-- Part 7b — kick_member (full; self-kick guard uses _auth return value)
-- =========================================================
create or replace function public.kick_member(p_room_id uuid, p_session_token text, p_target_member uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth(p_room_id, p_session_token, 'admin');
  if p_target_member = v_self then raise exception 'admin cannot kick themselves' using errcode = '42501'; end if;
  update public.rooms set
    dj_member_id    = case when dj_member_id    = p_target_member then null else dj_member_id    end,
    admin_member_id = case when admin_member_id = p_target_member then null else admin_member_id end
  where id = p_room_id;
  delete from public.members where id = p_target_member and room_id = p_room_id;
end; $$;

-- =========================================================
-- Part 8 — grants + realtime publication
-- =========================================================
grant execute on function public.register(text,text)                                  to anon, authenticated;
grant execute on function public.login(text,text)                                     to anon, authenticated;
grant execute on function public.me(text)                                             to anon, authenticated;
grant execute on function public.logout(text)                                         to anon, authenticated;
grant execute on function public.create_room(text,text,text)                          to anon, authenticated;
grant execute on function public.join_room(text,text,text)                            to anon, authenticated;
grant execute on function public.add_queue_item(uuid,text,text,text,text,integer)     to anon, authenticated;
grant execute on function public.advance_queue(uuid,text)                             to anon, authenticated;
grant execute on function public.set_playback(uuid,text,boolean,timestamptz,integer)  to anon, authenticated;
grant execute on function public.seek_playback(uuid,text,integer)                     to anon, authenticated;
grant execute on function public.reorder_item(uuid,text,uuid,double precision)        to anon, authenticated;
grant execute on function public.bump_to_top(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.delete_item(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.set_play_mode(uuid,text,text)                        to anon, authenticated;
grant execute on function public.assign_dj(uuid,text,uuid)                            to anon, authenticated;
grant execute on function public.transfer_admin(uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.kick_member(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.rename_room(uuid,text,text)                          to anon, authenticated;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.queue_items;
-- Do NOT add accounts/account_secrets/room_secrets/sessions.
