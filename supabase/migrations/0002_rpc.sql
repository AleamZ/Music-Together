-- =========================================================
-- 0002_rpc.sql — SECURITY DEFINER write RPCs
-- =========================================================

-- ---------- PRIVATE AUTH HELPER ----------
-- Resolves + authorizes a member by (id, token) and required role.
-- p_required_role in: 'any' | 'admin' | 'dj' | 'admin_or_dj'. RAISES on failure.
create or replace function public._auth_member(
  p_room_id uuid, p_member_id uuid, p_token text, p_required_role text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_exists boolean;
  v_hash   text;
  v_admin  uuid;
  v_dj     uuid;
begin
  select true into v_exists from public.members
  where id = p_member_id and room_id = p_room_id;
  if not found then
    raise exception 'member not found in room' using errcode = '42501';
  end if;

  select token_hash into v_hash from public.member_secrets where member_id = p_member_id;
  if v_hash is distinct from encode(digest(p_token, 'sha256'), 'hex') then
    raise exception 'invalid token' using errcode = '42501';
  end if;

  select admin_member_id, dj_member_id into v_admin, v_dj
  from public.rooms where id = p_room_id;

  if p_required_role = 'admin' and v_admin is distinct from p_member_id then
    raise exception 'admin role required' using errcode = '42501';
  elsif p_required_role = 'dj' and v_dj is distinct from p_member_id then
    raise exception 'dj role required' using errcode = '42501';
  elsif p_required_role = 'admin_or_dj'
        and v_admin is distinct from p_member_id
        and v_dj    is distinct from p_member_id then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;

  return p_member_id;
end;
$$;
revoke all on function public._auth_member(uuid,uuid,text,text) from public, anon, authenticated;

-- ---------- create_room ----------
create or replace function public.create_room(
  p_room_name text, p_password text, p_user_name text,
  out code text, out room_id uuid, out member_id uuid, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_code text;
begin
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;

  token   := encode(gen_random_bytes(32), 'hex');
  room_id := gen_random_uuid();
  code    := v_code;

  insert into public.rooms (id, code, name, play_mode) values (room_id, v_code, p_room_name, 'order');
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, name) values (room_id, p_user_name) returning id into member_id;
  insert into public.member_secrets (member_id, token_hash) values (member_id, encode(digest(token, 'sha256'), 'hex'));

  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end;
$$;

-- ---------- join_room ----------
create or replace function public.join_room(
  p_code text, p_user_name text, p_password text,
  out room_id uuid, out member_id uuid, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text;
begin
  select r.id, s.password_hash into room_id, v_hash
  from public.rooms r join public.room_secrets s on s.room_id = r.id
  where r.code = p_code;

  if room_id is null then
    raise exception 'room not found' using errcode = 'P0002';
  end if;
  if crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid password' using errcode = '28P01';
  end if;

  token := encode(gen_random_bytes(32), 'hex');
  insert into public.members (room_id, name) values (room_id, p_user_name) returning id into member_id;
  insert into public.member_secrets (member_id, token_hash) values (member_id, encode(digest(token, 'sha256'), 'hex'));
end;
$$;

-- ---------- add_queue_item (any member) ----------
create or replace function public.add_queue_item(
  p_room_id uuid, p_member_id uuid, p_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision; v_name text; v_id uuid;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'any');
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id;
  select name into v_name from public.members where id = p_member_id;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_member_id, added_by_name, position)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, p_member_id, v_name, v_pos)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- advance_queue (DJ only) ----------
create or replace function public.advance_queue(
  p_room_id uuid, p_member_id uuid, p_token text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur public.queue_items%rowtype; v_mode text; v_next uuid;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
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
    current_item_id   = v_next,
    started_at        = case when v_next is not null then now() else null end,
    is_playing        = v_next is not null,
    paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end;
$$;

-- ---------- set_playback (DJ only) ----------
create or replace function public.set_playback(
  p_room_id uuid, p_member_id uuid, p_token text,
  p_is_playing boolean, p_started_at timestamptz, p_paused_elapsed_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
  update public.rooms set
    is_playing = p_is_playing, started_at = p_started_at,
    paused_elapsed_ms = coalesce(p_paused_elapsed_ms, 0)
  where id = p_room_id;
end;
$$;

-- ---------- seek_playback (DJ only) ----------
create or replace function public.seek_playback(
  p_room_id uuid, p_member_id uuid, p_token text, p_position_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_playing boolean;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
  select is_playing into v_playing from public.rooms where id = p_room_id;
  update public.rooms set
    started_at = case when v_playing then now() - make_interval(secs => p_position_ms / 1000.0) else null end,
    paused_elapsed_ms = p_position_ms
  where id = p_room_id;
end;
$$;

-- ---------- reorder_item / bump_to_top / delete_item (admin or dj) ----------
create or replace function public.reorder_item(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid, p_new_position double precision
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  update public.queue_items set position = p_new_position where id = p_item_id and room_id = p_room_id;
end;
$$;

create or replace function public.bump_to_top(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_min double precision;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  select coalesce(min(position), 0) into v_min from public.queue_items where room_id = p_room_id;
  update public.queue_items set position = v_min - 1 where id = p_item_id and room_id = p_room_id;
end;
$$;

create or replace function public.delete_item(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  if exists (select 1 from public.rooms where id = p_room_id and current_item_id = p_item_id) then
    raise exception 'cannot delete the currently playing item' using errcode = '42501';
  end if;
  delete from public.queue_items where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- admin RPCs ----------
create or replace function public.set_play_mode(
  p_room_id uuid, p_member_id uuid, p_token text, p_play_mode text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_play_mode not in ('order','shuffle') then
    raise exception 'invalid play_mode' using errcode = '22023';
  end if;
  update public.rooms set play_mode = p_play_mode where id = p_room_id;
end;
$$;

create or replace function public.assign_dj(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_target_member is not null and not exists (
       select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set dj_member_id = p_target_member where id = p_room_id;
end;
$$;

create or replace function public.transfer_admin(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if not exists (select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set admin_member_id = p_target_member where id = p_room_id;
end;
$$;

create or replace function public.kick_member(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_target_member = p_member_id then
    raise exception 'admin cannot kick themselves' using errcode = '42501';
  end if;
  update public.rooms set
    dj_member_id    = case when dj_member_id    = p_target_member then null else dj_member_id    end,
    admin_member_id = case when admin_member_id = p_target_member then null else admin_member_id end
  where id = p_room_id;
  delete from public.members where id = p_target_member and room_id = p_room_id;
end;
$$;

create or replace function public.rename_room(
  p_room_id uuid, p_member_id uuid, p_token text, p_new_name text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  update public.rooms set name = p_new_name where id = p_room_id;
end;
$$;

-- ---------- GRANTS (public-facing RPCs only; _auth_member intentionally omitted) ----------
grant execute on function public.create_room(text,text,text)                          to anon, authenticated;
grant execute on function public.join_room(text,text,text)                            to anon, authenticated;
grant execute on function public.add_queue_item(uuid,uuid,text,text,text,text,integer) to anon, authenticated;
grant execute on function public.advance_queue(uuid,uuid,text)                        to anon, authenticated;
grant execute on function public.set_playback(uuid,uuid,text,boolean,timestamptz,integer) to anon, authenticated;
grant execute on function public.seek_playback(uuid,uuid,text,integer)                to anon, authenticated;
grant execute on function public.reorder_item(uuid,uuid,text,uuid,double precision)   to anon, authenticated;
grant execute on function public.bump_to_top(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.delete_item(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.set_play_mode(uuid,uuid,text,text)                   to anon, authenticated;
grant execute on function public.assign_dj(uuid,uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.transfer_admin(uuid,uuid,text,uuid)                  to anon, authenticated;
grant execute on function public.kick_member(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.rename_room(uuid,uuid,text,text)                     to anon, authenticated;
