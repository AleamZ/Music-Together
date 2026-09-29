-- tests/sql/public-rooms-smoke.sql — 0093: three public halls, room creation closed, older rooms closed but kept.
-- Chain-level: run after the full chain (it re-applies 0093 twice with \i, so it is re-runnable). Rolls back its rows.
\set ON_ERROR_STOP on
begin;
-- an older room made before 0093 (by the pre-0093 rules: kind defaults to private)
insert into public.accounts (id, username, is_root) values
  ('00000000-0000-0000-0000-00000000a001', 'pr_owner', false),
  ('00000000-0000-0000-0000-00000000a002', 'pr_guest', false),
  ('00000000-0000-0000-0000-00000000a003', 'pr_root',  true);
insert into public.sessions (token_hash, account_id) values
  (encode(extensions.digest('tok-owner', 'sha256'), 'hex'), '00000000-0000-0000-0000-00000000a001'),
  (encode(extensions.digest('tok-guest', 'sha256'), 'hex'), '00000000-0000-0000-0000-00000000a002'),
  (encode(extensions.digest('tok-root',  'sha256'), 'hex'), '00000000-0000-0000-0000-00000000a003');
insert into public.rooms (id, code, name, created_by_account_id)
  values ('00000000-0000-0000-0000-00000000b001', 'salon-old001', 'Phòng cũ', '00000000-0000-0000-0000-00000000a001');
insert into public.room_secrets (room_id, password_hash) values ('00000000-0000-0000-0000-00000000b001', extensions.crypt('pw', extensions.gen_salt('bf')));
insert into public.members (id, room_id, account_id) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a002');
update public.rooms set admin_member_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-00000000b001';

\i supabase/migrations/0093_public_rooms.sql
\i supabase/migrations/0093_public_rooms.sql
-- the chain smokes run with the flag on (README); this one checks the closed rules (rolled back at the end)
update public.app_flags set enabled = false where key = 'room_creation_open';

do $$
declare v_n int; v_r record; v_ok boolean;
begin
  -- the halls
  assert (select string_agg(code || '=' || name, ',' order by pinned_order) from public.rooms where kind = 'public')
       = 'salon-592539=Sảnh Chính,salon-cho-dem=Sảnh Chợ Đêm,salon-song-que=Sảnh Sông Quê', 'three halls in order';
  assert (select count(*) from public.room_secrets s join public.rooms r on r.id = s.room_id where r.kind = 'public') = 3, 'hall secrets';
  assert (select kind from public.rooms where code = 'salon-old001') = 'private', 'old room private';
  assert (select enabled from public.app_flags where key = 'room_creation_open') = false, 'flag off';

  -- creation closed for a normal account
  v_ok := false;
  begin perform public.create_room('x', 'pw', 'tok-guest'); exception when others then
    v_ok := sqlerrm = 'room creation closed'; end;
  assert v_ok, 'guest cannot create';
  -- root can (private)
  select * into v_r from public.create_room('Phòng root', 'pw', 'tok-root');
  assert (select kind from public.rooms where id = v_r.room_id) = 'private', 'root room is private';
  -- flag on: a normal account can
  update public.app_flags set enabled = true where key = 'room_creation_open';
  perform public.create_room('x', 'pw', 'tok-guest');
  update public.app_flags set enabled = false where key = 'room_creation_open';

  -- a hall: no password, anyone
  select * into v_r from public.join_room('salon-cho-dem', '', 'tok-guest');
  assert v_r.member_id is not null, 'guest joined hall';
  perform public._auth(v_r.room_id, 'tok-guest', 'any');
  assert (select admin_member_id from public.rooms where id = v_r.room_id) is null, 'guest not made admin';
  select * into v_r from public.join_room('salon-cho-dem', null, 'tok-root');
  assert (select admin_member_id from public.rooms where id = v_r.room_id) = v_r.member_id, 'root adopts an ownerless hall';

  -- the old room: its guest member is refused, even with the right password; data kept
  v_ok := false;
  begin perform public.join_room('salon-old001', 'pw', 'tok-guest'); exception when others then v_ok := sqlerrm = 'room closed'; end;
  assert v_ok, 'old room closed for member';
  v_ok := false;
  begin perform public._auth('00000000-0000-0000-0000-00000000b001', 'tok-guest', 'any'); exception when others then v_ok := sqlerrm = 'room closed'; end;
  assert v_ok, 'old room read-only for member';
  assert (select count(*) from public.members where room_id = '00000000-0000-0000-0000-00000000b001') = 2, 'members kept';
  -- its admin and root still get in
  select * into v_r from public.join_room('salon-old001', '', 'tok-owner');
  assert v_r.member_id = '00000000-0000-0000-0000-00000000c001', 'admin rejoins';
  perform public._auth('00000000-0000-0000-0000-00000000b001', 'tok-owner', 'admin');
  select * into v_r from public.join_room('salon-old001', '', 'tok-root');
  perform public._auth('00000000-0000-0000-0000-00000000b001', 'tok-root', 'any');

  -- privileges
  assert not has_function_privilege('anon', 'public._room_open_for(uuid,uuid)', 'execute'), 'helper private';
  assert has_function_privilege('anon', 'public.join_room(text,text,text)', 'execute'), 'join_room granted';
end $$;
rollback;
\echo public-rooms-smoke OK
