-- =========================================================
-- 0005_v3_admin.sql — v3: feedback, root role, ban, rate-limits. ADDITIVE (no data drop).
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- columns ----------
alter table public.accounts add column if not exists is_root   boolean not null default false;
alter table public.accounts add column if not exists is_banned boolean not null default false;
alter table public.rooms    add column if not exists created_by_account_id uuid references public.accounts(id) on delete set null;

-- ---------- feedback table ----------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  username   text not null,
  category   text not null check (category in ('bug','suggestion','other')),
  message    text not null,
  status     text not null default 'new' check (status in ('new','handled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_status_created  on public.feedback (status, created_at desc);
create index if not exists idx_feedback_account_created on public.feedback (account_id, created_at desc);
alter table public.feedback enable row level security;
-- No policies on feedback -> never client-readable/writable; only SECURITY DEFINER RPCs touch it.

-- ---------- _auth_account: add ban check (signature unchanged -> replace) ----------
create or replace function public._auth_account(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text := encode(digest(p_session_token, 'sha256'), 'hex'); v_account uuid; v_banned boolean;
begin
  update public.sessions set last_seen = now() where token_hash = v_hash returning account_id into v_account;
  if v_account is null then raise exception 'invalid session' using errcode = '42501'; end if;
  select is_banned into v_banned from public.accounts where id = v_account;
  if v_banned then raise exception 'account banned' using errcode = '42501'; end if;
  return v_account;
end; $$;

-- ---------- _auth_root ----------
create or replace function public._auth_root(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_root boolean;
begin
  v_account := public._auth_account(p_session_token);
  select is_root into v_root from public.accounts where id = v_account;
  if not coalesce(v_root, false) then raise exception 'root role required' using errcode = '42501'; end if;
  return v_account;
end; $$;
revoke all on function public._auth_root(text) from public, anon, authenticated;

-- ---------- me: add is_root (OUT params change -> drop + create + re-grant) ----------
drop function if exists public.me(text);
create function public.me(p_token text, out account_id uuid, out username text, out is_root boolean)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  account_id := public._auth_account(p_token);
  select a.username, a.is_root into username, is_root from public.accounts a where a.id = account_id;
end; $$;
grant execute on function public.me(text) to anon, authenticated;

-- ---------- create_room: set created_by + rate-limit (signature unchanged -> replace; grant persists) ----------
create or replace function public.create_room(
  p_room_name text, p_password text, p_session_token text,
  out code text, out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_code text; v_recent int;
begin
  v_account := public._auth_account(p_session_token);
  select count(*) into v_recent from public.rooms
    where created_by_account_id = v_account and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'too many rooms, try later' using errcode = '53400'; end if;
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  room_id := gen_random_uuid(); code := v_code;
  insert into public.rooms (id, code, name, play_mode, created_by_account_id)
    values (room_id, v_code, p_room_name, 'order', v_account);
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, account_id) values (room_id, v_account) returning id into member_id;
  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end; $$;

-- ---------- feedback RPCs ----------
create or replace function public.submit_feedback(p_session_token text, p_category text, p_message text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_recent int; v_id uuid;
begin
  v_account := public._auth_account(p_session_token);
  if p_category not in ('bug','suggestion','other') then raise exception 'invalid category' using errcode='22023'; end if;
  if p_message is null or length(btrim(p_message)) = 0 then raise exception 'empty message' using errcode='22023'; end if;
  select count(*) into v_recent from public.feedback
    where account_id = v_account and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'too many feedback, try later' using errcode='53400'; end if;
  select username into v_name from public.accounts where id = v_account;
  insert into public.feedback (account_id, username, category, message)
    values (v_account, v_name, p_category, btrim(p_message)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.list_feedback(p_session_token text)
returns setof public.feedback language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select * from public.feedback order by created_at desc;
end; $$;

create or replace function public.set_feedback_status(p_session_token text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  if p_status not in ('new','handled') then raise exception 'invalid status' using errcode='22023'; end if;
  update public.feedback set status = p_status where id = p_id;
end; $$;

create or replace function public.delete_feedback(p_session_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  delete from public.feedback where id = p_id;
end; $$;

-- ---------- admin RPCs (root only) ----------
create or replace function public.admin_list_rooms(p_session_token text)
returns table(id uuid, code text, name text, is_playing boolean, created_at timestamptz, creator text, member_count bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query
    select r.id, r.code, r.name, r.is_playing, r.created_at,
           a.username,
           (select count(*) from public.members m where m.room_id = r.id)
    from public.rooms r
    left join public.accounts a on a.id = r.created_by_account_id
    order by r.created_at desc;
end; $$;

create or replace function public.admin_delete_room(p_session_token text, p_room_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  delete from public.rooms where id = p_room_id;
end; $$;

create or replace function public.admin_list_accounts(p_session_token text)
returns table(id uuid, username text, is_root boolean, is_banned boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select a.id, a.username, a.is_root, a.is_banned, a.created_at
               from public.accounts a order by a.created_at desc;
end; $$;

create or replace function public.admin_set_ban(p_session_token text, p_account_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot ban yourself' using errcode='42501'; end if;
  update public.accounts set is_banned = p_banned where id = p_account_id;
  if p_banned then delete from public.sessions where account_id = p_account_id; end if;
end; $$;

create or replace function public.admin_delete_account(p_session_token text, p_account_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot delete yourself' using errcode='42501'; end if;
  delete from public.accounts where id = p_account_id;
end; $$;

create or replace function public.admin_stats(p_session_token text)
returns table(total_rooms bigint, total_accounts bigint, feedback_new bigint, feedback_total bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select
    (select count(*) from public.rooms),
    (select count(*) from public.accounts),
    (select count(*) from public.feedback where status = 'new'),
    (select count(*) from public.feedback);
end; $$;

-- ---------- grants (public-facing RPCs; _auth_root NOT granted) ----------
grant execute on function public.submit_feedback(text,text,text)      to anon, authenticated;
grant execute on function public.list_feedback(text)                  to anon, authenticated;
grant execute on function public.set_feedback_status(text,uuid,text)  to anon, authenticated;
grant execute on function public.delete_feedback(text,uuid)           to anon, authenticated;
grant execute on function public.admin_list_rooms(text)               to anon, authenticated;
grant execute on function public.admin_delete_room(text,uuid)         to anon, authenticated;
grant execute on function public.admin_list_accounts(text)            to anon, authenticated;
grant execute on function public.admin_set_ban(text,uuid,boolean)     to anon, authenticated;
grant execute on function public.admin_delete_account(text,uuid)      to anon, authenticated;
grant execute on function public.admin_stats(text)                    to anon, authenticated;
