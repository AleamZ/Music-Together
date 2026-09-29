-- =========================================================
-- 0093_public_rooms.sql — rooms are no longer created at will. ADDITIVE (no data dropped).
--   A. rooms.kind ('public' | 'private', default 'private') + rooms.pinned_order (the halls' order on the home page).
--   B. Three public halls, the only rooms listed and joinable by everyone, without a password:
--        1. salon-592539   'Sảnh Chính'     (the existing room keeps its name, data, admin and DJ; created only if missing)
--        2. salon-cho-dem  'Sảnh Chợ Đêm'
--        3. salon-song-que 'Sảnh Sông Quê'
--   C. app_flags 'room_creation_open' (FALSE): create_room refuses everyone but root while it is off. Root keeps
--      create_room (it makes a 'private' room) — the path the paid private rooms will use later. Turned ON it
--      brings back the pre-0093 rules whole (anyone creates, every room open); the chain smokes run that way
--      (tests/sql/README.md). Turned ON it brings back
--      the pre-0093 rules whole (anyone creates, every room open) — the chain smokes run that way (tests/sql/README.md).
--   D. Every other (older) room is 'private': nothing is deleted, but it is closed — join_room and every RPC gated by
--      _auth refuse ('room closed', 42501) anyone but root and that room's admin. Its rows stay readable (RLS unchanged).
--   E. A public hall with no admin: the first root to join becomes its admin and DJ.
-- Re-runnable.
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

alter table public.rooms add column if not exists kind text not null default 'private';
alter table public.rooms add column if not exists pinned_order integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_kind_check') then
    alter table public.rooms add constraint rooms_kind_check check (kind in ('public','private'));
  end if;
end $$;
create index if not exists idx_rooms_public on public.rooms (pinned_order) where kind = 'public';

insert into public.app_flags (key, enabled) values ('room_creation_open', false) on conflict (key) do nothing;

-- ---------- B. the halls ----------
do $$
declare v_hall record; v_id uuid;
begin
  for v_hall in select * from (values
      ('salon-592539',   'Sảnh Chính',    1),
      ('salon-cho-dem',  'Sảnh Chợ Đêm',  2),
      ('salon-song-que', 'Sảnh Sông Quê', 3)) h(code, name, ord)
  loop
    select id into v_id from public.rooms where code = v_hall.code;
    if v_id is null then
      v_id := gen_random_uuid();
      insert into public.rooms (id, code, name, play_mode, kind, pinned_order)
        values (v_id, v_hall.code, v_hall.name, 'order', 'public', v_hall.ord);
    else
      update public.rooms set kind = 'public', pinned_order = v_hall.ord where id = v_id;
    end if;
    -- join_room joins room_secrets; a hall's password is never checked (a random one keeps the row shape)
    insert into public.room_secrets (room_id, password_hash)
      values (v_id, extensions.crypt(encode(extensions.gen_random_bytes(16), 'hex'), extensions.gen_salt('bf')))
      on conflict (room_id) do nothing;
  end loop;
end $$;

-- ---------- helper: may this account act in this room? ----------
create or replace function public._room_open_for(p_room_id uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select r.kind = 'public' from public.rooms r where r.id = p_room_id), false)
      or coalesce((select f.enabled from public.app_flags f where f.key = 'room_creation_open'), false)
      or coalesce((select a.is_root from public.accounts a where a.id = p_account), false)
      or exists (select 1 from public.rooms r join public.members m on m.id = r.admin_member_id
                  where r.id = p_room_id and m.account_id = p_account);
$$;
revoke all on function public._room_open_for(uuid,uuid) from public, anon, authenticated;

-- ---------- D. _auth: a closed room is read-only (signature unchanged -> replace) ----------
create or replace function public._auth(p_room_id uuid, p_session_token text, p_required_role text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_member_id uuid; v_admin uuid; v_dj uuid;
begin
  v_account := public._auth_account(p_session_token);
  select id into v_member_id from public.members where room_id = p_room_id and account_id = v_account;
  if not found then raise exception 'account is not a member of this room' using errcode = '42501'; end if;
  if not public._room_open_for(p_room_id, v_account) then
    raise exception 'room closed' using errcode = '42501';
  end if;
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

-- ---------- C. create_room: closed unless root or the flag is on (signature unchanged -> replace) ----------
create or replace function public.create_room(
  p_room_name text, p_password text, p_session_token text,
  out code text, out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_code text; v_recent int; v_root boolean;
begin
  v_account := public._auth_account(p_session_token);
  select coalesce(a.is_root, false) into v_root from public.accounts a where a.id = v_account;
  if not v_root and not coalesce((select f.enabled from public.app_flags f where f.key = 'room_creation_open'), false) then
    raise exception 'room creation closed' using errcode = '42501';
  end if;
  select count(*) into v_recent from public.rooms
    where created_by_account_id = v_account and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'too many rooms, try later' using errcode = '53400'; end if;
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  room_id := gen_random_uuid(); code := v_code;
  insert into public.rooms (id, code, name, play_mode, created_by_account_id, kind)
    values (room_id, v_code, p_room_name, 'order', v_account, 'private');
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, account_id) values (room_id, v_account) returning id into member_id;
  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end; $$;

-- ---------- B/D/E. join_room: halls without a password, closed rooms refused (signature unchanged -> replace) ----------
create or replace function public.join_room(
  p_code text, p_password text, p_session_token text,
  out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
#variable_conflict use_column
declare v_account uuid; v_room uuid; v_hash text; v_kind text; v_root boolean; v_admin uuid;
begin
  v_account := public._auth_account(p_session_token);
  select r.id, s.password_hash, r.kind, r.admin_member_id into v_room, v_hash, v_kind, v_admin
  from public.rooms r join public.room_secrets s on s.room_id = r.id
  where r.code = p_code;
  if v_room is null then raise exception 'room not found' using errcode = 'P0002'; end if;
  room_id := v_room;
  if not public._room_open_for(v_room, v_account) then
    raise exception 'room closed' using errcode = '42501';
  end if;
  select coalesce(a.is_root, false) into v_root from public.accounts a where a.id = v_account;

  select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
  if member_id is null then
    if v_kind <> 'public' and not v_root and crypt(coalesce(p_password, ''), v_hash) <> v_hash then
      raise exception 'invalid password' using errcode = '28P01';
    end if;
    insert into public.members (room_id, account_id) values (v_room, v_account)
    on conflict (room_id, account_id) do nothing returning id into member_id;
    if member_id is null then
      select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
    end if;
  end if;

  if v_kind = 'public' and v_admin is null and v_root then
    update public.rooms set admin_member_id = member_id, dj_member_id = coalesce(dj_member_id, member_id)
     where id = v_room and admin_member_id is null;
  end if;
end; $$;

grant execute on function public.create_room(text,text,text) to anon, authenticated;
grant execute on function public.join_room(text,text,text)   to anon, authenticated;
