-- =========================================================
-- 0006_v4_chat_roles.sql — v4: DJ-revoke→admin + persisted chat. ADDITIVE (no data drop).
-- Reactions are DB-free (Realtime Broadcast only).
-- =========================================================

-- ---------- A. assign_dj: revoke (null target) returns DJ to the room admin ----------
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
  -- v4: revoking (null) returns DJ to the current admin instead of clearing it.
  update public.rooms
     set dj_member_id = coalesce(p_target_member, admin_member_id)
   where id = p_room_id;
end;
$$;

-- ---------- B. chat_messages table (public read, RPC-only writes, realtime) ----------
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id)    on delete cascade,
  account_id uuid          references public.accounts(id) on delete set null,
  username   text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_room_created on public.chat_messages (room_id, created_at desc);

-- realtime DELETE payload must carry room_id so the client can filter by room
alter table public.chat_messages replica identity full;

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to anon using (true);
-- No insert/update/delete policy -> writes only via SECURITY DEFINER RPCs below.

-- add to realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ---------- C. send_chat_message (any member; validated + rate-limited + trimmed to 200) ----------
create or replace function public.send_chat_message(
  p_session_token text, p_room_id uuid, p_body text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_recent int; v_body text; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');   -- must be a member of the room
  v_account := public._auth_account(p_session_token);
  v_body := btrim(p_body);
  if v_body = '' or length(v_body) > 500 then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.chat_messages
   where room_id = p_room_id and account_id = v_account
     and created_at > now() - interval '15 seconds';
  if v_recent >= 10 then
    raise exception 'too many messages, slow down' using errcode = '53400';
  end if;
  select username into v_name from public.accounts where id = v_account;
  insert into public.chat_messages (room_id, account_id, username, body)
    values (p_room_id, v_account, v_name, v_body)
    returning id into v_id;
  -- keep only the newest 200 messages per room (bounded storage on free hosting)
  delete from public.chat_messages
   where room_id = p_room_id
     and id not in (
       select id from public.chat_messages
        where room_id = p_room_id
        order by created_at desc
        limit 200
     );
  return v_id;
end;
$$;

-- ---------- D. delete_chat_message (author or room admin) ----------
create or replace function public.delete_chat_message(
  p_session_token text, p_room_id uuid, p_message_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_msg_account uuid; v_is_admin boolean;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select account_id into v_msg_account from public.chat_messages
    where id = p_message_id and room_id = p_room_id;
  if not found then
    raise exception 'message not found' using errcode = '42704';
  end if;
  select (admin_member_id = v_member) into v_is_admin from public.rooms where id = p_room_id;
  if not (coalesce(v_is_admin, false) or v_msg_account is not distinct from v_account) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.chat_messages where id = p_message_id and room_id = p_room_id;
end;
$$;

-- ---------- grants (assign_dj grant persists from 0004; signature unchanged) ----------
grant execute on function public.send_chat_message(text,uuid,text)   to anon, authenticated;
grant execute on function public.delete_chat_message(text,uuid,uuid) to anon, authenticated;
