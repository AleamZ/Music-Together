-- v18.11 Báo Làng (spec §18.11): the dev blog (global posts, written by root in /admin) and the village news (big
-- events, written only by the server, scoped to the room, the last 300 per room), with per-viewer read markers for the
-- unread dot and the 24 h dev-blog popup. Clients read everything through the RPCs below; no table has a policy.
--
-- Event kinds emitted here: fish_legend (a rarity-5 catch), ban (an anti-cheat ban), car (a car bought), card_win (a big
-- card-game win). Kinds other features emit through public._news_event(room, kind, text, meta) when they land:
-- lightning (a strike on a player), drown / rescue (the pond), overboard (pulled into the pond by a huge fish),
-- house (land or a house bought, v19). Each passes its own Vietnamese headline, built with public._news_name(account).

-- ---------- A. Tables ----------
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  emoji text not null default '📢' check (char_length(emoji) between 1 and 16),
  body text not null default '' check (char_length(body) <= 8000),
  pinned boolean not null default false,
  author_id uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_news_posts_created on public.news_posts (created_at desc);
alter table public.news_posts enable row level security;

create table if not exists public.news_events (
  id bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 32),
  text text not null check (char_length(text) between 1 and 500),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_news_events_room on public.news_events (room_id, created_at desc, id desc);
alter table public.news_events enable row level security;

-- The dev blog is global: one marker per viewer. The village news is per room: one marker per viewer and room.
create table if not exists public.news_post_reads (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_post_seen_at timestamptz not null
);
alter table public.news_post_reads enable row level security;

create table if not exists public.news_event_reads (
  account_id uuid not null references public.accounts(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  last_event_seen_at timestamptz not null,
  primary key (account_id, room_id)
);
alter table public.news_event_reads enable row level security;

-- ---------- B. Internal helpers (never granted) ----------
-- The name a headline prints.
create or replace function public._news_name(p_account uuid) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select username from public.accounts where id = p_account), 'Một người lạ')
$$;

-- The room an account-wide event (a ban, a car) is reported in: the room the account was seen in last.
create or replace function public._news_home_room(p_account uuid) returns uuid
language sql stable security definer set search_path = public, extensions
as $$
  select m.room_id from public.members m join public.rooms r on r.id = m.room_id
   where m.account_id = p_account
   order by m.last_seen_at desc nulls last, m.joined_at desc
   limit 1
$$;

-- Write one village-news line and keep the room's newest 300. A null or unknown room writes nothing.
create or replace function public._news_event(p_room uuid, p_kind text, p_text text, p_meta jsonb) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_room is null or p_text is null or not exists (select 1 from public.rooms where id = p_room) then
    return;
  end if;
  insert into public.news_events (room_id, kind, text, meta)
  values (p_room, left(p_kind, 32), left(p_text, 500), coalesce(p_meta, '{}'::jsonb));
  delete from public.news_events
   where room_id = p_room
     and id < (select id from public.news_events where room_id = p_room order by id desc offset 299 limit 1);
end $$;

-- ---------- C. Hooks into existing events ----------
-- A legendary catch: finish_cast (0015, and 0031's version) writes the `[catch:account|species|grams]` system line for
-- rare+ catches; a trigger on that line keeps finish_cast untouched.
create or replace function public._news_on_catch() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare m text[]; sp public.fish_species;
begin
  m := regexp_match(new.body, '^\[catch:([0-9a-f-]{36})\|([^|\]]+)\|([0-9]+)\]');
  if m is null then
    return null;
  end if;
  select * into sp from public.fish_species where id = m[2];
  if not found or sp.rarity < 5 then
    return null;
  end if;
  perform public._news_event(new.room_id, 'fish_legend',
    format('🐉 CHẤN ĐỘNG AO LÀNG: %s vừa kéo lên một con %s nặng %s — cá Huyền thoại! Bà con đổ ra bờ ao xem đông nghịt.',
           public._news_name(m[1]::uuid), sp.name, public._weight_text(m[3]::int)),
    jsonb_build_object('account_id', m[1], 'species_id', sp.id, 'weight_g', m[3]::int));
  return null;
end $$;
drop trigger if exists news_on_catch on public.chat_messages;
create trigger news_on_catch after insert on public.chat_messages
  for each row when (new.system and new.body like '[catch:%') execute function public._news_on_catch();

-- An anti-cheat ban (_ac_flag strike 2): reported in the room of the strike, else the account's last room. No reason.
create or replace function public._news_on_ban() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_room uuid;
begin
  select e.room_id into v_room from public.anticheat_events e
   where e.account_id = new.account_id and e.room_id is not null
   order by e.created_at desc, e.id desc limit 1;
  perform public._news_event(coalesce(v_room, public._news_home_room(new.account_id)), 'ban',
    format('🚨 Cảnh sát tóm được %s! Tài khoản đã bị niêm phong để điều tra. Bà con nhớ làm ăn chân chính nhé.',
           public._news_name(new.account_id)),
    jsonb_build_object('account_id', new.account_id));
  return null;
end $$;
drop trigger if exists news_on_ban on public.anticheat_status;
create trigger news_on_ban after update of ban_state on public.anticheat_status
  for each row when (old.ban_state is null and new.ban_state = 'pending_wipe') execute function public._news_on_ban();

-- A car bought (buy_vehicle, 0027): reported in the buyer's last room.
create or replace function public._news_on_vehicle() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._news_event(public._news_home_room(new.account_id), 'car',
    format('🚗 Làng có xe hơi mới! %s vừa tậu một chiếc %s, bóp còi inh ỏi khắp đầu làng.',
           public._news_name(new.account_id),
           lower(coalesce((select name from public.vehicle_catalog where id = new.vehicle_id), 'xe hơi'))),
    jsonb_build_object('account_id', new.account_id, 'vehicle_id', new.vehicle_id));
  return null;
end $$;
drop trigger if exists news_on_vehicle on public.owned_vehicles;
create trigger news_on_vehicle after insert on public.owned_vehicles
  for each row when (new.vehicle_id = 'car') execute function public._news_on_vehicle();

-- A big card-game win: _card_settle (0017, the only definition) re-created with the report before the payouts. The net is
-- the seat's balance minus what the hand held from it (its card_hold ledger rows); big means ≥ 5 × stake and ≥ 5 000 xu.
create or replace function public._card_settle(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record; t public.card_tables; v_held integer; v_net integer;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game and escrow > 0
            order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  -- v18.11: the village news of a big win
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  if coalesce(t.stake, 0) > 0 then
    for r in select account_id, escrow from public.card_seats where room_id = p_room and game = p_game and escrow > 0
              order by seat loop
      select coalesce(-sum(delta), 0) into v_held from public.coin_ledger
       where account_id = r.account_id and reason = 'card_hold' and ref = public._card_ref(p_game, t.hand_no);
      v_net := r.escrow - v_held;
      if v_held > 0 and v_net >= greatest(5 * t.stake, 5000) then
        perform public._news_event(p_room, 'card_win',
          format('🃏 THẮNG LỚN CHIẾU BẠC: %s ẵm trọn %s xu ở bàn %s (cược %s xu). Cả xóm xôn xao bàn tán!',
                 public._news_name(r.account_id), v_net,
                 case p_game when 'tienlen' then 'Tiến lên' when 'cao' then 'Cào' when 'xidach' then 'Xì dách'
                             when 'poker' then 'Poker' else p_game end,
                 t.stake),
          jsonb_build_object('account_id', r.account_id, 'game', p_game, 'net', v_net, 'stake', t.stake));
      end if;
    end loop;
  end if;
  for r in select seat from public.card_seats where room_id = p_room and game = p_game and escrow > 0 order by seat loop
    perform public._card_payout(p_room, p_game, r.seat, 'card_settle');
  end loop;
end $$;

revoke all on function public._news_name(uuid) from public, anon, authenticated;
revoke all on function public._news_home_room(uuid) from public, anon, authenticated;
revoke all on function public._news_event(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._news_on_catch() from public, anon, authenticated;
revoke all on function public._news_on_ban() from public, anon, authenticated;
revoke all on function public._news_on_vehicle() from public, anon, authenticated;
revoke all on function public._card_settle(uuid, text) from public, anon, authenticated;

-- ---------- D. Reader RPCs ----------
create or replace function public._news_post_json(p public.news_posts) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', p.id, 'title', p.title, 'emoji', p.emoji, 'body', p.body, 'pinned', p.pinned,
                            'created_at', p.created_at, 'updated_at', p.updated_at)
$$;
revoke all on function public._news_post_json(public.news_posts) from public, anon, authenticated;

-- The stand: the pinned posts then the newest (30 in all), the room's newest 50 events, the unread counts, and the popup
-- (posts of the last 24 h newer than the viewer's marker, oldest first).
create or replace function public.news_feed(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token); v_post_seen timestamptz; v_event_seen timestamptz;
begin
  select last_post_seen_at into v_post_seen from public.news_post_reads where account_id = v_account;
  select last_event_seen_at into v_event_seen from public.news_event_reads where account_id = v_account and room_id = p_room_id;
  return jsonb_build_object(
    'posts', coalesce((select jsonb_agg(public._news_post_json(p) order by p.pinned desc, p.created_at desc)
                         from (select * from public.news_posts order by pinned desc, created_at desc limit 30) p), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'text', e.text,
                                                            'created_at', e.created_at) order by e.created_at desc, e.id desc)
                          from (select * from public.news_events where room_id = p_room_id
                                 order by created_at desc, id desc limit 50) e), '[]'::jsonb),
    'unread', jsonb_build_object(
      'posts', (select count(*) from public.news_posts where v_post_seen is null or created_at > v_post_seen),
      'events', (select count(*) from public.news_events
                  where room_id = p_room_id and (v_event_seen is null or created_at > v_event_seen))),
    'popup', coalesce((select jsonb_agg(public._news_post_json(p) order by p.created_at, p.id)
                         from public.news_posts p
                        where p.created_at > now() - interval '24 hours'
                          and (v_post_seen is null or p.created_at > v_post_seen)), '[]'::jsonb),
    'server_now', now());
end $$;

-- Mark the dev blog ('posts'), the room's news ('events') or both ('all') read up to now.
create or replace function public.news_mark_read(p_room_id uuid, p_session_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  if p_kind is null or p_kind not in ('posts', 'events', 'all') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_kind in ('posts', 'all') then
    insert into public.news_post_reads (account_id, last_post_seen_at) values (v_account, now())
    on conflict (account_id) do update set last_post_seen_at = greatest(news_post_reads.last_post_seen_at, excluded.last_post_seen_at);
  end if;
  if p_kind in ('events', 'all') then
    insert into public.news_event_reads (account_id, room_id, last_event_seen_at) values (v_account, p_room_id, now())
    on conflict (account_id, room_id) do update
      set last_event_seen_at = greatest(news_event_reads.last_event_seen_at, excluded.last_event_seen_at);
  end if;
  return jsonb_build_object('ok', true, 'server_now', now());
end $$;

-- ---------- E. Admin (root, like the other admin_* RPCs) ----------
create or replace function public.news_admin_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return coalesce((select jsonb_agg(public._news_post_json(p) order by p.pinned desc, p.created_at desc)
                     from public.news_posts p), '[]'::jsonb);
end $$;

-- Create (p_id null) or edit a post; the answer is the post.
create or replace function public.news_post_upsert(p_session_token text, p_id uuid, p_title text, p_emoji text,
                                                   p_body text, p_pinned boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); p public.news_posts; v_title text := btrim(coalesce(p_title, ''));
        v_emoji text := coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), '📢');
begin
  if char_length(v_title) not between 1 and 120 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if char_length(v_emoji) > 16 then
    raise exception 'invalid emoji' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 8000 then
    raise exception 'body too long' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.news_posts (title, emoji, body, pinned, author_id)
    values (v_title, v_emoji, coalesce(p_body, ''), coalesce(p_pinned, false), v_root)
    returning * into p;
  else
    update public.news_posts
       set title = v_title, emoji = v_emoji, body = coalesce(p_body, ''), pinned = coalesce(p_pinned, false),
           updated_at = now()
     where id = p_id
    returning * into p;
    if not found then
      raise exception 'post not found' using errcode = '22023';
    end if;
  end if;
  return public._news_post_json(p);
end $$;

create or replace function public.news_post_delete(p_session_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  delete from public.news_posts where id = p_id;
  if not found then
    raise exception 'post not found' using errcode = '22023';
  end if;
end $$;

revoke all on function public.news_feed(uuid, text) from public;
revoke all on function public.news_mark_read(uuid, text, text) from public;
revoke all on function public.news_admin_list(text) from public;
revoke all on function public.news_post_upsert(text, uuid, text, text, text, boolean) from public;
revoke all on function public.news_post_delete(text, uuid) from public;
grant execute on function public.news_feed(uuid, text) to anon, authenticated;
grant execute on function public.news_mark_read(uuid, text, text) to anon, authenticated;
grant execute on function public.news_admin_list(text) to anon, authenticated;
grant execute on function public.news_post_upsert(text, uuid, text, text, text, boolean) to anon, authenticated;
grant execute on function public.news_post_delete(text, uuid) to anon, authenticated;
