-- =========================================================
-- 0071_quests.sql — v21 group "quests" (owner list #50 #51 #52 #53 #91 #69 #94/#95 #36). ADDITIVE and re-runnable.
-- Run after 0069 (the game_events feed and the v21 ledger reasons; this migration adds NO reason).
--   A. Quests. quest_defs is the data-driven objective map: a quest counts the game_events of its `kind` whose meta
--      contains its `filter` (jsonb @>), by 1 or by the event's qty (`use_qty`). A new event kind from another feature is
--      just a new seed row; unknown kinds match no row and are ignored. Categories:
--        daily   — 4 of the pool per VN day (picked by md5(id || day)), reset at VN midnight;
--        weekly  — 3 of the pool per VN week (Monday), bigger rewards;
--        npc     — chains given by bác Ba Làng on the hall (accept and hand in beside him, the server's position);
--        explore — "đến nơi chưa từng đến": counts 'area_discovered', emitted here the first time player_pos lands on a
--                  map (trigger quest_pos_visit on player_pos).
--      Progress is written ONLY by the trigger quest_ev on public.game_events (_quest_on_event). quest_claim pays
--      'quest_reward' coins and emits 'xp_grant' (meta {"source":"quest"}) and 'quest_done' (meta {"cat","quest"}).
--   B. Company quest (#53): one server-wide goal (company_quests, from the rotating company_pool); every event of its
--      kind adds to the bar and to the account's contribution; when full, everyone who contributed claims the reward
--      once (quest_company_claim) and the next goal of the pool opens.
--   C. Daily login (#69): a 7-day streak calendar, claimed once per VN day (claim_login_reward). It shares the day with
--      0015's claim_daily through wallets.daily_on: when the old +20 was already taken today, the calendar pays the rest.
--      Emits 'login_day' (qty = the day of the streak 1–7).
--   D. Album (#94/#95): photo_album keeps small JPEG/WEBP data URLs (≤ 150 000 chars, ≤ 24 per account, ≤ 12 saves per
--      10 minutes), checked here. The capture itself is client-side (the canvas); nothing is paid.
--   E. 2v2 tag team arena (#36): the fight engine is 1v1, so a team series is a best-of-3 of ordinary PvP bouts played at
--      Bãi đất's rings (bout 1: A1–B1, bout 2: A2–B2, bout 3: A1–B2). Each bout is read from public.fight_matches by the
--      trigger arena_team_fx (a finished 'pvp' match between the scheduled pair, created after the series started;
--      a draw is replayed). Stakes: the challenger and the accepter each pay 'arena_team_stake'; each winner gets
--      stake × 0.95 ('arena_team_win'); an expired series refunds ('arena_team_refund'). Team rating ±16.
-- Events emitted: quest_done, xp_grant, area_discovered, login_day, arena_team_win.
-- Events consumed: every kind named in quest_defs / company_pool (fish_catch, earn, spend, fight_done, fight_win,
--   login_day, quest_done, area_discovered, and the kinds other v21 features emit: ore_mined, potion_brewed,
--   crop_harvest, boss_hit, item_crafted).
-- Lock order: player_pos → quest rows → wallets.
-- =========================================================

-- ---------- A. Quests ----------
create table if not exists public.quest_defs (
  id text primary key,
  cat text not null check (cat in ('daily', 'weekly', 'npc', 'explore')),
  title text not null,
  descr text not null default '',
  kind text not null,
  filter jsonb not null default '{}'::jsonb,
  use_qty boolean not null default false,
  goal integer not null check (goal between 1 and 1000000),
  reward_coins integer not null default 0 check (reward_coins between 0 and 5000),
  reward_xp integer not null default 0 check (reward_xp between 0 and 5000),
  chain text null,               -- npc: the chain's name
  needs text null,               -- npc: the quest to hand in first
  sort integer not null default 0,
  active boolean not null default true
);
create index if not exists quest_defs_kind on public.quest_defs (kind) where active;
alter table public.quest_defs enable row level security;
revoke all on public.quest_defs from anon, authenticated;

insert into public.quest_defs (id, cat, title, descr, kind, filter, use_qty, goal, reward_coins, reward_xp, chain, needs, sort) values
  -- daily pool (4 a day)
  ('d_fish5',     'daily', 'Câu 5 con cá',            'Câu được 5 con cá bất kỳ.',                'fish_catch', '{}', false, 5,   40, 30, null, null, 1),
  ('d_fish12',    'daily', 'Mẻ lưới đầy',             'Câu được 12 con cá.',                      'fish_catch', '{}', false, 12,  80, 60, null, null, 2),
  ('d_sellfish',  'daily', 'Bán cá lấy tiền',          'Kiếm 150 xu từ bán cá.',                   'earn', '{"reason":"sell"}', true, 150, 40, 30, null, null, 3),
  ('d_rice',      'daily', 'Nhà nông chăm chỉ',        'Kiếm 100 xu từ bán lúa gạo.',              'earn', '{"reason":"rice_sell"}', true, 100, 50, 40, null, null, 4),
  ('d_produce',   'daily', 'Rau quả tươi',             'Kiếm 80 xu từ bán nông sản.',              'earn', '{"reason":"produce_sell"}', true, 80, 50, 40, null, null, 5),
  ('d_critter',   'daily', 'Bắt cua ốc',               'Kiếm 40 xu từ bán cua, ốc.',               'earn', '{"reason":"critter_sell"}', true, 40, 40, 30, null, null, 6),
  ('d_fight',     'daily', 'Luyện võ',                 'Đánh xong 2 trận bất kỳ.',                 'fight_done', '{}', false, 2, 40, 40, null, null, 7),
  ('d_meal',      'daily', 'Ăn một bữa ngon',          'Ăn ở quán Chợ Lớn.',                       'spend', '{"reason":"meal"}', false, 1, 25, 20, null, null, 8),
  -- weekly pool (3 a week)
  ('w_daily10',   'weekly', 'Chăm chỉ cả tuần',        'Hoàn thành 10 nhiệm vụ ngày.',             'quest_done', '{"cat":"daily"}', false, 10, 300, 250, null, null, 1),
  ('w_fish60',    'weekly', 'Ngư ông',                 'Câu được 60 con cá.',                      'fish_catch', '{}', false, 60, 300, 250, null, null, 2),
  ('w_win5',      'weekly', 'Võ sĩ',                   'Thắng 5 trận đấu.',                        'fight_win', '{}', false, 5, 350, 300, null, null, 3),
  ('w_earn2000',  'weekly', 'Làm giàu',                'Kiếm 2 000 xu từ bán cá.',                 'earn', '{"reason":"sell"}', true, 2000, 300, 250, null, null, 4),
  ('w_login5',    'weekly', 'Ghé làng mỗi ngày',       'Nhận quà đăng nhập 5 ngày.',               'login_day', '{}', false, 5, 250, 200, null, null, 5),
  -- npc chain "Chuyện làng" (existing kinds)
  ('n_lang_1',    'npc', 'Mồi đầu tiên',              'Bác Ba muốn ăn cá: câu 3 con cá.',         'fish_catch', '{}', false, 3, 60, 50, 'lang', null, 1),
  ('n_lang_2',    'npc', 'Ra chợ bán cá',             'Kiếm 100 xu từ bán cá.',                   'earn', '{"reason":"sell"}', true, 100, 80, 60, 'lang', 'n_lang_1', 2),
  ('n_lang_3',    'npc', 'Thăm đồng',                 'Kiếm 60 xu từ bán lúa gạo.',               'earn', '{"reason":"rice_sell"}', true, 60, 100, 80, 'lang', 'n_lang_2', 3),
  ('n_lang_4',    'npc', 'Hái lượm ven đồng',         'Kiếm 30 xu từ bán cua, ốc.',               'earn', '{"reason":"critter_sell"}', true, 30, 120, 100, 'lang', 'n_lang_3', 4),
  ('n_lang_5',    'npc', 'Rèn luyện thân thể',        'Đánh xong 3 trận.',                        'fight_done', '{}', false, 3, 150, 150, 'lang', 'n_lang_4', 5),
  ('n_lang_6',    'npc', 'Người làng thứ thiệt',      'Thắng 2 trận.',                            'fight_win', '{}', false, 2, 250, 250, 'lang', 'n_lang_5', 6),
  -- npc chain "Nghề mới" (kinds of the other v21 features)
  ('n_nghe_1',    'npc', 'Thu hoạch mùa màng',        'Thu hoạch 5 lần.',                         'crop_harvest', '{}', false, 5, 100, 80, 'nghe', 'n_lang_2', 11),
  ('n_nghe_2',    'npc', 'Xuống mỏ',                  'Đào được 10 cục quặng.',                   'ore_mined', '{}', true, 10, 150, 120, 'nghe', 'n_nghe_1', 12),
  ('n_nghe_3',    'npc', 'Thử chế tạo',               'Chế tạo 1 món đồ.',                        'item_crafted', '{}', false, 1, 150, 120, 'nghe', 'n_nghe_2', 13),
  ('n_nghe_4',    'npc', 'Pha thuốc',                 'Pha 2 lọ thuốc.',                          'potion_brewed', '{}', false, 2, 200, 150, 'nghe', 'n_nghe_3', 14),
  ('n_nghe_5',    'npc', 'Diệt trùm',                 'Đánh trúng boss 20 lần.',                  'boss_hit', '{}', false, 20, 300, 250, 'nghe', 'n_nghe_4', 15),
  -- explore (#91)
  ('e_pond',      'explore', 'Ao câu',                 'Lần đầu xuống ao câu cá.',                 'area_discovered', '{"area":"pond"}', false, 1, 20, 20, null, null, 1),
  ('e_field',     'explore', 'Đồng ruộng',             'Lần đầu ra đồng.',                         'area_discovered', '{"area":"field"}', false, 1, 20, 20, null, null, 2),
  ('e_market',    'explore', 'Chợ Lớn',                'Lần đầu đi Chợ Lớn.',                      'area_discovered', '{"area":"market"}', false, 1, 30, 30, null, null, 3),
  ('e_khu_nha',   'explore', 'Khu nhà',                'Lần đầu đến Khu nhà.',                     'area_discovered', '{"area":"khu_nha"}', false, 1, 40, 40, null, null, 4),
  ('e_bai_dat',   'explore', 'Bãi đất trống',          'Lần đầu đến Bãi đất trống.',               'area_discovered', '{"area":"bai_dat"}', false, 1, 40, 40, null, null, 5),
  ('e_ham_ngam',  'explore', 'Hầm ngầm',               'Lần đầu xuống Hầm ngầm.',                  'area_discovered', '{"area":"ham_ngam"}', false, 1, 60, 60, null, null, 6),
  ('e_all',       'explore', 'Nhà thám hiểm',          'Khám phá 6 vùng đất.',                     'area_discovered', '{}', false, 6, 200, 200, null, null, 7)
on conflict (id) do update set cat = excluded.cat, title = excluded.title, descr = excluded.descr, kind = excluded.kind,
  filter = excluded.filter, use_qty = excluded.use_qty, goal = excluded.goal, reward_coins = excluded.reward_coins,
  reward_xp = excluded.reward_xp, chain = excluded.chain, needs = excluded.needs, sort = excluded.sort;

-- period: the VN day (daily), the VN week's Monday (weekly), '' (npc, explore).
create table if not exists public.quest_progress (
  account_id uuid not null references public.accounts(id) on delete cascade,
  quest_id text not null references public.quest_defs(id) on delete cascade,
  period text not null default '',
  progress integer not null default 0,
  accepted_at timestamptz not null default now(),
  done_at timestamptz null,
  claimed_at timestamptz null,
  primary key (account_id, quest_id, period)
);
alter table public.quest_progress enable row level security;
revoke all on public.quest_progress from anon, authenticated;

create table if not exists public.quest_visits (
  account_id uuid not null references public.accounts(id) on delete cascade,
  area text not null,
  at timestamptz not null default now(),
  primary key (account_id, area)
);
alter table public.quest_visits enable row level security;
revoke all on public.quest_visits from anon, authenticated;

-- the quest giver: bác Ba Làng on the hall (lib/game/quests/npc.ts pins these)
create or replace function public._quest_giver() returns table (map text, x integer, y integer, reach integer)
language sql immutable parallel safe as $$ values ('hall', 368, 216, 72) $$;
revoke all on function public._quest_giver() from public, anon, authenticated;

create or replace function public._quest_week(p_day date) returns date
language sql immutable parallel safe as $$ select p_day - (extract(isodow from p_day)::int - 1) $$;
revoke all on function public._quest_week(date) from public, anon, authenticated;

create or replace function public._quest_period(p_cat text, p_day date) returns text
language sql immutable parallel safe as $$
  select case p_cat when 'daily' then p_day::text when 'weekly' then public._quest_week(p_day)::text else '' end
$$;
revoke all on function public._quest_period(text, date) from public, anon, authenticated;

-- The daily and weekly quests on offer for the period of p_day (4 and 3 of the pools).
create or replace function public._quest_offer(p_cat text, p_day date) returns setof text
language sql stable security definer set search_path = public, extensions as $$
  select id from public.quest_defs
   where cat = p_cat and active
   order by md5(id || public._quest_period(p_cat, p_day)), id
   limit case p_cat when 'daily' then 4 when 'weekly' then 3 else 1000 end
$$;
revoke all on function public._quest_offer(text, date) from public, anon, authenticated;

-- ---------- B. Company quest ----------
create table if not exists public.company_pool (
  seq integer primary key,
  title text not null,
  descr text not null default '',
  kind text not null,
  filter jsonb not null default '{}'::jsonb,
  use_qty boolean not null default false,
  goal integer not null check (goal between 1 and 100000000),
  reward_coins integer not null check (reward_coins between 0 and 5000),
  reward_xp integer not null default 0 check (reward_xp between 0 and 5000)
);
alter table public.company_pool enable row level security;
revoke all on public.company_pool from anon, authenticated;
insert into public.company_pool (seq, title, descr, kind, filter, use_qty, goal, reward_coins, reward_xp) values
  (1, 'Hội câu cá của làng', 'Cả làng câu 500 con cá.', 'fish_catch', '{}', false, 500, 150, 150),
  (2, 'Chợ phiên',           'Cả làng kiếm 20 000 xu từ bán cá.', 'earn', '{"reason":"sell"}', true, 20000, 150, 150),
  (3, 'Được mùa',            'Cả làng kiếm 10 000 xu từ bán lúa gạo.', 'earn', '{"reason":"rice_sell"}', true, 10000, 150, 150),
  (4, 'Hội võ',              'Cả làng đánh xong 150 trận.', 'fight_done', '{}', false, 150, 150, 150)
on conflict (seq) do update set title = excluded.title, descr = excluded.descr, kind = excluded.kind, filter = excluded.filter,
  use_qty = excluded.use_qty, goal = excluded.goal, reward_coins = excluded.reward_coins, reward_xp = excluded.reward_xp;

create table if not exists public.company_quests (
  id bigint generated always as identity primary key,
  seq integer not null,
  title text not null,
  descr text not null default '',
  kind text not null,
  filter jsonb not null default '{}'::jsonb,
  use_qty boolean not null default false,
  goal integer not null,
  progress integer not null default 0,
  reward_coins integer not null,
  reward_xp integer not null,
  status text not null default 'open' check (status in ('open', 'done')),
  started_at timestamptz not null default now(),
  done_at timestamptz null
);
create unique index if not exists company_quests_one_open on public.company_quests ((true)) where status = 'open';
alter table public.company_quests enable row level security;
revoke all on public.company_quests from anon, authenticated;

create table if not exists public.company_contrib (
  quest_id bigint not null references public.company_quests(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  qty integer not null default 0,
  claimed_at timestamptz null,
  primary key (quest_id, account_id)
);
alter table public.company_contrib enable row level security;
revoke all on public.company_contrib from anon, authenticated;

-- Open the next goal of the pool (after p_seq).
create or replace function public._company_next(p_seq integer) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p public.company_pool;
begin
  select * into p from public.company_pool where seq > coalesce(p_seq, 0) order by seq limit 1;
  if not found then select * into p from public.company_pool order by seq limit 1; end if;
  if not found then return; end if;
  insert into public.company_quests (seq, title, descr, kind, filter, use_qty, goal, reward_coins, reward_xp)
  values (p.seq, p.title, p.descr, p.kind, p.filter, p.use_qty, p.goal, p.reward_coins, p.reward_xp)
  on conflict do nothing;
end $$;
revoke all on function public._company_next(integer) from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from public.company_quests where status = 'open') then perform public._company_next(0); end if;
end $$;

-- ---------- The event trigger ----------
create or replace function public._quest_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_q integer; v_day date := public._vn_today(); v_per text; c public.company_quests;
begin
  begin
    for d in select q.* from public.quest_defs q where q.kind = new.kind and q.active and new.meta @> q.filter loop
      v_q := case when d.use_qty then greatest(new.qty, 0) else 1 end;
      continue when v_q = 0;
      if d.cat in ('daily', 'weekly') then
        continue when d.id not in (select public._quest_offer(d.cat, v_day));
      end if;
      v_per := public._quest_period(d.cat, v_day);
      if d.cat = 'npc' then
        update public.quest_progress
           set progress = least(d.goal, progress + v_q),
               done_at = case when progress + v_q >= d.goal then now() end
         where account_id = new.account_id and quest_id = d.id and period = '' and done_at is null;
      else
        insert into public.quest_progress as p (account_id, quest_id, period, progress, done_at)
        values (new.account_id, d.id, v_per, least(d.goal, v_q), case when v_q >= d.goal then now() end)
        on conflict (account_id, quest_id, period) do update
          set progress = least(d.goal, p.progress + v_q),
              done_at = coalesce(p.done_at, case when p.progress + v_q >= d.goal then now() end);
      end if;
    end loop;

    select * into c from public.company_quests
     where status = 'open' and kind = new.kind and new.meta @> filter for update;
    if found then
      v_q := case when c.use_qty then greatest(new.qty, 0) else 1 end;
      if v_q > 0 then
        insert into public.company_contrib as k (quest_id, account_id, qty) values (c.id, new.account_id, v_q)
        on conflict (quest_id, account_id) do update set qty = k.qty + v_q;
        update public.company_quests set progress = least(goal, progress + v_q),
               status = case when progress + v_q >= goal then 'done' else 'open' end,
               done_at = case when progress + v_q >= goal then now() end
         where id = c.id;
        if c.progress + v_q >= c.goal then perform public._company_next(c.seq); end if;
      end if;
    end if;
  exception when others then
    -- a quest must never break the gameplay RPC that emitted the event
    raise warning '_quest_on_event: % (%)', sqlerrm, new.kind;
  end;
  return new;
end $$;
revoke all on function public._quest_on_event() from public, anon, authenticated;
drop trigger if exists quest_ev on public.game_events;
create trigger quest_ev after insert on public.game_events for each row execute function public._quest_on_event();

-- The first landing on a map: 'area_discovered'.
create or replace function public._quest_on_pos() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_n integer;
begin
  if tg_op = 'UPDATE' and new.map is not distinct from old.map then return new; end if;
  begin
    insert into public.quest_visits (account_id, area) values (new.account_id, new.map) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 and new.map <> 'hall' then
      perform public._game_event(new.account_id, 'area_discovered', 1, jsonb_build_object('area', new.map));
    end if;
  exception when others then
    raise warning '_quest_on_pos: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public._quest_on_pos() from public, anon, authenticated;
drop trigger if exists quest_pos_visit on public.player_pos;
create trigger quest_pos_visit after insert or update of map on public.player_pos
  for each row execute function public._quest_on_pos();

-- ---------- Quest RPCs ----------
create or replace function public._quest_row_json(d public.quest_defs, p public.quest_progress, p_status text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', d.id, 'cat', d.cat, 'title', d.title, 'descr', d.descr, 'goal', d.goal,
    'progress', coalesce(p.progress, 0), 'coins', d.reward_coins, 'xp', d.reward_xp, 'chain', d.chain,
    'status', p_status)
$$;
revoke all on function public._quest_row_json(public.quest_defs, public.quest_progress, text) from public, anon, authenticated;

-- status: 'locked' (npc, needs another first), 'available' (npc, not accepted), 'active', 'done' (claimable), 'claimed'.
create or replace function public._quest_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_day date := public._vn_today(); v_list jsonb := '[]'::jsonb; d public.quest_defs; p public.quest_progress;
        v_st text; c public.company_quests; k public.company_contrib; v_claim jsonb;
begin
  for d in select * from public.quest_defs q
            where q.active and (q.cat in ('npc', 'explore')
                                or q.id in (select public._quest_offer('daily', v_day))
                                or q.id in (select public._quest_offer('weekly', v_day)))
            order by q.cat, q.sort, q.id loop
    select * into p from public.quest_progress
     where account_id = p_account and quest_id = d.id and period = public._quest_period(d.cat, v_day);
    v_st := case when p.claimed_at is not null then 'claimed' when p.done_at is not null then 'done'
                 when p.account_id is not null or d.cat <> 'npc' then 'active'
                 when d.needs is null or exists (select 1 from public.quest_progress x where x.account_id = p_account
                                                  and x.quest_id = d.needs and x.claimed_at is not null) then 'available'
                 else 'locked' end;
    v_list := v_list || public._quest_row_json(d, p, v_st);
  end loop;
  select * into c from public.company_quests where status = 'open';
  select * into k from public.company_contrib where quest_id = c.id and account_id = p_account;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'coins', q.reward_coins, 'xp', q.reward_xp)), '[]')
    into v_claim
    from public.company_quests q join public.company_contrib x on x.quest_id = q.id
   where q.status = 'done' and x.account_id = p_account and x.qty > 0 and x.claimed_at is null;
  return jsonb_build_object(
    'quests', v_list,
    'company', case when c.id is null then null else jsonb_build_object('id', c.id, 'title', c.title, 'descr', c.descr,
       'goal', c.goal, 'progress', c.progress, 'coins', c.reward_coins, 'xp', c.reward_xp, 'mine', coalesce(k.qty, 0),
       'contributors', (select count(*) from public.company_contrib x where x.quest_id = c.id)) end,
    'company_claimable', v_claim,
    'visited', coalesce((select jsonb_agg(area order by at) from public.quest_visits where account_id = p_account), '[]'),
    'day', v_day, 'week', public._quest_week(v_day),
    'server_now_ms', floor(extract(epoch from now()) * 1000)
  );
end $$;
revoke all on function public._quest_state(uuid) from public, anon, authenticated;

create or replace function public.quest_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public._quest_state(public._auth_account(p_session_token));
end $$;
revoke all on function public.quest_state(text) from public;
grant execute on function public.quest_state(text) to anon, authenticated;

-- Beside the giver? The claim goes through the server position (0057): refused = the anti-cheat envelope.
create or replace function public._quest_at_giver(p_account uuid, p_x integer, p_y integer, p_rpc text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare g record; v_ac jsonb;
begin
  select * into g from public._quest_giver();
  v_ac := public._pos_claim(p_account, g.map, p_x, p_y, p_rpc);
  if v_ac is not null then return v_ac; end if;
  if sqrt((p_x - g.x) ^ 2 + (p_y - g.y) ^ 2) > g.reach then
    raise exception 'too far' using errcode = '22023';
  end if;
  return null;
end $$;
revoke all on function public._quest_at_giver(uuid, integer, integer, text) from public, anon, authenticated;

create or replace function public.quest_accept(p_session_token text, p_quest text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); d public.quest_defs; v_ac jsonb;
begin
  select * into d from public.quest_defs where id = p_quest and active;
  if not found or d.cat <> 'npc' then raise exception 'unknown quest' using errcode = '22023'; end if;
  v_ac := public._quest_at_giver(v_account, p_x, p_y, 'quest_accept');
  if v_ac is not null then return v_ac; end if;
  if d.needs is not null and not exists (select 1 from public.quest_progress where account_id = v_account
                                           and quest_id = d.needs and claimed_at is not null) then
    raise exception 'quest locked' using errcode = '22023';
  end if;
  if (select count(*) from public.quest_progress p join public.quest_defs q on q.id = p.quest_id
       where p.account_id = v_account and q.cat = 'npc' and p.claimed_at is null) >= 3 then
    raise exception 'too many quests' using errcode = '22023';
  end if;
  insert into public.quest_progress (account_id, quest_id, period) values (v_account, d.id, '') on conflict do nothing;
  return public._quest_state(v_account);
end $$;
revoke all on function public.quest_accept(text, text, integer, integer) from public;
grant execute on function public.quest_accept(text, text, integer, integer) to anon, authenticated;

-- Hand in a finished quest (npc ones beside the giver: p_x, p_y; others ignore them).
create or replace function public.quest_claim(p_session_token text, p_quest text, p_x integer default null,
                                              p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); d public.quest_defs; p public.quest_progress; v_ac jsonb;
        v_per text; v_bal integer;
begin
  select * into d from public.quest_defs where id = p_quest;
  if not found then raise exception 'unknown quest' using errcode = '22023'; end if;
  if d.cat = 'npc' then
    v_ac := public._quest_at_giver(v_account, p_x, p_y, 'quest_claim');
    if v_ac is not null then return v_ac; end if;
  end if;
  v_per := public._quest_period(d.cat, public._vn_today());
  select * into p from public.quest_progress where account_id = v_account and quest_id = d.id and period = v_per for update;
  if not found or p.done_at is null then raise exception 'not done' using errcode = '22023'; end if;
  if p.claimed_at is not null then raise exception 'already claimed' using errcode = '22023'; end if;
  update public.quest_progress set claimed_at = now() where account_id = v_account and quest_id = d.id and period = v_per;
  perform public._wallet_lock(v_account);
  if d.reward_coins > 0 then v_bal := public._pay(v_account, d.reward_coins, 'quest_reward', d.id); end if;
  if d.reward_xp > 0 then
    perform public._game_event(v_account, 'xp_grant', d.reward_xp, jsonb_build_object('source', 'quest', 'quest', d.id));
  end if;
  perform public._game_event(v_account, 'quest_done', 1, jsonb_build_object('cat', d.cat, 'quest', d.id));
  return public._quest_state(v_account) || jsonb_build_object('paid', d.reward_coins, 'xp', d.reward_xp,
    'coins', (select coins from public.wallets where account_id = v_account));
end $$;
revoke all on function public.quest_claim(text, text, integer, integer) from public;
grant execute on function public.quest_claim(text, text, integer, integer) to anon, authenticated;

create or replace function public.quest_company_claim(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); r record; v_paid integer := 0; v_xp integer := 0;
begin
  perform public._wallet_lock(v_account);
  for r in select q.id, q.reward_coins, q.reward_xp from public.company_quests q
             join public.company_contrib x on x.quest_id = q.id
            where q.status = 'done' and x.account_id = v_account and x.qty > 0 and x.claimed_at is null
            for update of x loop
    update public.company_contrib set claimed_at = now() where quest_id = r.id and account_id = v_account;
    if r.reward_coins > 0 then perform public._pay(v_account, r.reward_coins, 'quest_reward', 'company:' || r.id); end if;
    if r.reward_xp > 0 then
      perform public._game_event(v_account, 'xp_grant', r.reward_xp, jsonb_build_object('source', 'quest', 'company', r.id));
    end if;
    perform public._game_event(v_account, 'quest_done', 1, jsonb_build_object('cat', 'company', 'quest', r.id::text));
    v_paid := v_paid + r.reward_coins; v_xp := v_xp + r.reward_xp;
  end loop;
  if v_paid = 0 and v_xp = 0 then raise exception 'nothing to claim' using errcode = '22023'; end if;
  return public._quest_state(v_account) || jsonb_build_object('paid', v_paid, 'xp', v_xp,
    'coins', (select coins from public.wallets where account_id = v_account));
end $$;
revoke all on function public.quest_company_claim(text) from public;
grant execute on function public.quest_company_claim(text) to anon, authenticated;

-- ---------- C. Daily login (#69) ----------
create table if not exists public.login_streaks (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  streak integer not null default 0,
  last_day date null,
  total integer not null default 0
);
alter table public.login_streaks enable row level security;
revoke all on public.login_streaks from anon, authenticated;

-- The calendar (lib/game/quests/login.ts pins it): day 1 … 7, then it starts again.
create or replace function public._login_rewards() returns integer[]
language sql immutable parallel safe as $$ select array[20, 30, 40, 50, 60, 80, 150] $$;
revoke all on function public._login_rewards() from public, anon, authenticated;

create or replace function public._login_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with s as (select * from public.login_streaks where account_id = p_account),
       t as (select public._vn_today() d)
  select jsonb_build_object(
    'claimed_today', coalesce((select last_day = t.d from s), false),
    -- the streak as it stands for today: broken when yesterday was missed
    'streak', coalesce((select case when s.last_day >= t.d - 1 then s.streak else 0 end from s), 0),
    'total', coalesce((select total from s), 0),
    'rewards', to_jsonb(public._login_rewards()),
    'day', t.d)
  from t
$$;
revoke all on function public._login_state(uuid) from public, anon, authenticated;

create or replace function public.login_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public._login_state(public._auth_account(p_session_token));
end $$;
revoke all on function public.login_state(text) from public;
grant execute on function public.login_state(text) to anon, authenticated;

create or replace function public.claim_login_reward(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); w public.wallets; s public.login_streaks;
        v_today date := public._vn_today(); v_streak integer; v_slot integer; v_amount integer; v_pay integer;
begin
  w := public._wallet_lock(v_account);
  insert into public.login_streaks (account_id) values (v_account) on conflict do nothing;
  select * into s from public.login_streaks where account_id = v_account for update;
  if s.last_day = v_today then
    return public._login_state(v_account) || jsonb_build_object('claimed', false, 'amount', 0);
  end if;
  v_streak := case when s.last_day = v_today - 1 then s.streak + 1 else 1 end;
  v_slot := ((v_streak - 1) % 7) + 1;
  v_amount := (public._login_rewards())[v_slot];
  -- 0015's claim_daily already paid its +20 today: the calendar pays the rest (one daily gift per VN day)
  v_pay := case when w.daily_on is not distinct from v_today then greatest(0, v_amount - 20) else v_amount end;
  update public.login_streaks set streak = v_streak, last_day = v_today, total = total + 1 where account_id = v_account;
  update public.wallets set daily_on = v_today where account_id = v_account;
  if v_pay > 0 then perform public._pay(v_account, v_pay, 'login_reward', v_today::text || '#' || v_slot); end if;
  perform public._game_event(v_account, 'login_day', v_slot, jsonb_build_object('streak', v_streak));
  perform public._game_event(v_account, 'xp_grant', 5 * v_slot, jsonb_build_object('source', 'quest', 'login', v_slot));
  return public._login_state(v_account) || jsonb_build_object('claimed', true, 'amount', v_amount, 'paid', v_pay,
    'slot', v_slot, 'coins', (select coins from public.wallets where account_id = v_account));
end $$;
revoke all on function public.claim_login_reward(text) from public;
grant execute on function public.claim_login_reward(text) to anon, authenticated;

-- ---------- D. Album (#94/#95) ----------
create table if not exists public.photo_album (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  data text not null check (length(data) <= 150000),
  w integer not null check (w between 16 and 1280),
  h integer not null check (h between 16 and 1280),
  map text null,
  caption text not null default '' check (length(caption) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists photo_album_account on public.photo_album (account_id, created_at);
alter table public.photo_album enable row level security;
revoke all on public.photo_album from anon, authenticated;

create or replace function public._photo_list(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('photos', coalesce(jsonb_agg(jsonb_build_object('id', id, 'w', w, 'h', h, 'map', map,
           'caption', caption, 'at', created_at) order by created_at desc, id desc), '[]'), 'max', 24)
    from public.photo_album where account_id = p_account
$$;
revoke all on function public._photo_list(uuid) from public, anon, authenticated;

create or replace function public.photo_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public._photo_list(public._auth_account(p_session_token));
end $$;
revoke all on function public.photo_list(text) from public;
grant execute on function public.photo_list(text) to anon, authenticated;

create or replace function public.photo_get(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._auth_account(p_session_token); v_data text;
begin
  select data into v_data from public.photo_album where id = p_id and account_id = v_account;
  if v_data is null then raise exception 'unknown photo' using errcode = '22023'; end if;
  return jsonb_build_object('id', p_id, 'data', v_data);
end $$;
revoke all on function public.photo_get(text, bigint) from public;
grant execute on function public.photo_get(text, bigint) to anon, authenticated;

create or replace function public.photo_save(p_session_token text, p_data text, p_w integer, p_h integer, p_map text,
                                             p_caption text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if p_data is null or length(p_data) > 150000
     or p_data !~ '^data:image/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'bad photo' using errcode = '22023';
  end if;
  if p_w is null or p_h is null or p_w not between 16 and 1280 or p_h not between 16 and 1280 then
    raise exception 'bad photo' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);        -- one account's saves run one after another
  if (select count(*) from public.photo_album where account_id = v_account) >= 24 then
    raise exception 'album full' using errcode = '22023';
  end if;
  if (select count(*) from public.photo_album where account_id = v_account and created_at > now() - interval '10 minutes') >= 12 then
    raise exception 'too many photos' using errcode = '53400';
  end if;
  insert into public.photo_album (account_id, data, w, h, map, caption)
  values (v_account, p_data, p_w, p_h, left(p_map, 16), left(coalesce(p_caption, ''), 60));
  perform public._game_event(v_account, 'photo_taken', 1, jsonb_build_object('map', left(p_map, 16)));
  return public._photo_list(v_account);
end $$;
revoke all on function public.photo_save(text, text, integer, integer, text, text) from public;
grant execute on function public.photo_save(text, text, integer, integer, text, text) to anon, authenticated;

create or replace function public.photo_delete(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  delete from public.photo_album where id = p_id and account_id = v_account;
  return public._photo_list(v_account);
end $$;
revoke all on function public.photo_delete(text, bigint) from public;
grant execute on function public.photo_delete(text, bigint) to anon, authenticated;

-- ---------- E. 2v2 tag team arena (#36) ----------
create table if not exists public.arena_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 24),
  code text not null unique,
  a uuid not null unique references public.accounts(id) on delete cascade,
  b uuid null unique references public.accounts(id) on delete set null,
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.arena_teams enable row level security;
revoke all on public.arena_teams from anon, authenticated;

create table if not exists public.arena_series (
  id uuid primary key default gen_random_uuid(),
  team_a uuid not null references public.arena_teams(id) on delete cascade,   -- the challenger
  team_b uuid not null references public.arena_teams(id) on delete cascade,
  stake integer not null check (stake between 0 and 500),
  payer_a uuid not null references public.accounts(id) on delete cascade,
  payer_b uuid null references public.accounts(id) on delete cascade,
  -- the members at the challenge (a team's roster may change later; the series keeps these)
  a1 uuid not null, a2 uuid not null, b1 uuid not null, b2 uuid not null,
  status text not null default 'open' check (status in ('open', 'live', 'done', 'void')),
  bout smallint not null default 1,
  score_a smallint not null default 0,
  score_b smallint not null default 0,
  bouts jsonb not null default '[]'::jsonb,
  winner uuid null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  ended_at timestamptz null
);
create index if not exists arena_series_live on public.arena_series (status) where status in ('open', 'live');
alter table public.arena_series enable row level security;
revoke all on public.arena_series from anon, authenticated;

-- bout n's pair: 1 A1–B1, 2 A2–B2, 3 A1–B2.
create or replace function public._arena_pair(s public.arena_series, n integer) returns uuid[]
language sql immutable as $$
  select case n when 1 then array[s.a1, s.b1] when 2 then array[s.a2, s.b2] else array[s.a1, s.b2] end
$$;
revoke all on function public._arena_pair(public.arena_series, integer) from public, anon, authenticated;

create or replace function public._arena_team_of(p_account uuid) returns public.arena_teams
language sql stable security definer set search_path = public, extensions as $$
  select * from public.arena_teams where a = p_account or b = p_account
$$;
revoke all on function public._arena_team_of(uuid) from public, anon, authenticated;

-- Void a series and give the stakes back.
create or replace function public._arena_void(p_id uuid, p_why text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.arena_series;
begin
  select * into s from public.arena_series where id = p_id and status in ('open', 'live') for update;
  if not found then return; end if;
  update public.arena_series set status = 'void', ended_at = now(), bouts = bouts || jsonb_build_array(jsonb_build_object('void', p_why))
   where id = p_id;
  if s.stake > 0 then
    perform public._wallet_lock(s.payer_a);
    perform public._pay(s.payer_a, s.stake, 'arena_team_refund', p_id::text);
    if s.payer_b is not null then
      perform public._wallet_lock(s.payer_b);
      perform public._pay(s.payer_b, s.stake, 'arena_team_refund', p_id::text);
    end if;
  end if;
end $$;
revoke all on function public._arena_void(uuid, text) from public, anon, authenticated;

-- Open challenges expire after 30 minutes, live series after 2 hours.
create or replace function public._arena_sweep() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in select id, status from public.arena_series
            where (status = 'open' and created_at < now() - interval '30 minutes')
               or (status = 'live' and accepted_at < now() - interval '2 hours') loop
    perform public._arena_void(r.id, case when r.status = 'open' then 'expired' else 'timeout' end);
  end loop;
end $$;
revoke all on function public._arena_sweep() from public, anon, authenticated;

create or replace function public._arena_series_json(s public.arena_series) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('id', s.id, 'status', s.status, 'stake', s.stake, 'bout', s.bout,
    'score_a', s.score_a, 'score_b', s.score_b, 'bouts', s.bouts, 'winner', s.winner,
    'team_a', jsonb_build_object('id', s.team_a, 'name', (select name from public.arena_teams where id = s.team_a)),
    'team_b', jsonb_build_object('id', s.team_b, 'name', (select name from public.arena_teams where id = s.team_b)),
    'pair', case when s.status = 'live' then (select jsonb_agg(u.username order by o) from unnest(public._arena_pair(s, s.bout))
                  with ordinality t(x, o) join public.accounts u on u.id = t.x) end,
    'created_at', s.created_at, 'accepted_at', s.accepted_at)
$$;
revoke all on function public._arena_series_json(public.arena_series) from public, anon, authenticated;

create or replace function public._arena_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare t public.arena_teams;
begin
  t := public._arena_team_of(p_account);
  return jsonb_build_object(
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name,
       'code', case when t.a = p_account then t.code end, 'rating', t.rating, 'wins', t.wins, 'losses', t.losses,
       'a', (select username from public.accounts where id = t.a), 'b', (select username from public.accounts where id = t.b),
       'leader', t.a = p_account) end,
    'series', coalesce((select jsonb_agg(public._arena_series_json(s) order by s.created_at desc) from public.arena_series s
                         where t.id is not null and (s.team_a = t.id or s.team_b = t.id)
                           and (s.status in ('open', 'live') or s.ended_at > now() - interval '1 day')), '[]'),
    'ranking', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'rating', x.rating, 'wins', x.wins,
                          'losses', x.losses, 'full', x.b is not null,
                          'a', (select username from public.accounts where id = x.a),
                          'b', (select username from public.accounts where id = x.b)) order by x.rating desc, x.wins desc)
                          from (select * from public.arena_teams order by rating desc, wins desc limit 20) x), '[]'));
end $$;
revoke all on function public._arena_state(uuid) from public, anon, authenticated;

create or replace function public.arena_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._arena_sweep();
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_state(text) from public;
grant execute on function public.arena_state(text) to anon, authenticated;

create or replace function public.arena_team_create(p_session_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) not between 2 and 24 then raise exception 'bad name' using errcode = '22023'; end if;
  if (public._arena_team_of(v_account)).id is not null then raise exception 'already in a team' using errcode = '22023'; end if;
  insert into public.arena_teams (name, code, a) values (v_name, upper(substr(md5(gen_random_uuid()::text), 1, 6)), v_account);
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_team_create(text, text) from public;
grant execute on function public.arena_team_create(text, text) to anon, authenticated;

create or replace function public.arena_team_join(p_session_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); t public.arena_teams;
begin
  if (public._arena_team_of(v_account)).id is not null then raise exception 'already in a team' using errcode = '22023'; end if;
  select * into t from public.arena_teams where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'unknown team' using errcode = '22023'; end if;
  if t.b is not null then raise exception 'team full' using errcode = '22023'; end if;
  update public.arena_teams set b = v_account where id = t.id;
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_team_join(text, text) from public;
grant execute on function public.arena_team_join(text, text) to anon, authenticated;

create or replace function public.arena_team_leave(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); t public.arena_teams;
begin
  perform public._arena_sweep();
  t := public._arena_team_of(v_account);
  if t.id is null then raise exception 'no team' using errcode = '22023'; end if;
  if exists (select 1 from public.arena_series where (team_a = t.id or team_b = t.id) and status in ('open', 'live')) then
    raise exception 'series running' using errcode = '22023';
  end if;
  if t.a = v_account and t.b is null then
    delete from public.arena_teams where id = t.id;
  elsif t.a = v_account then
    update public.arena_teams set a = b, b = null, code = upper(substr(md5(gen_random_uuid()::text), 1, 6)) where id = t.id;
  else
    update public.arena_teams set b = null where id = t.id;
  end if;
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_team_leave(text) from public;
grant execute on function public.arena_team_leave(text) to anon, authenticated;

create or replace function public.arena_challenge(p_session_token text, p_team uuid, p_stake integer) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); me public.arena_teams; them public.arena_teams;
        w public.wallets;
begin
  perform public._arena_sweep();
  me := public._arena_team_of(v_account);
  if me.id is null or me.b is null then raise exception 'team not full' using errcode = '22023'; end if;
  select * into them from public.arena_teams where id = p_team;
  if not found or them.b is null then raise exception 'team not full' using errcode = '22023'; end if;
  if them.id = me.id then raise exception 'same team' using errcode = '22023'; end if;
  if p_stake is null or p_stake not between 0 and 500 then raise exception 'bad stake' using errcode = '22023'; end if;
  if exists (select 1 from public.arena_series where status in ('open', 'live')
              and (team_a in (me.id, them.id) or team_b in (me.id, them.id))) then
    raise exception 'team busy' using errcode = '22023';
  end if;
  if p_stake > 0 and (select count(*) from public.arena_series
                       where stake > 0 and created_at >= public._vn_day_start()
                         and ((team_a = me.id and team_b = them.id) or (team_a = them.id and team_b = me.id))) >= 3 then
    raise exception 'pair cap' using errcode = '22023';
  end if;
  w := public._wallet_lock(v_account);
  if w.coins < p_stake then raise exception 'insufficient funds' using errcode = '22023'; end if;
  insert into public.arena_series (team_a, team_b, stake, payer_a, a1, a2, b1, b2)
  values (me.id, them.id, p_stake, v_account, me.a, me.b, them.a, them.b);
  if p_stake > 0 then perform public._pay(v_account, -p_stake, 'arena_team_stake', them.id::text); end if;
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_challenge(text, uuid, integer) from public;
grant execute on function public.arena_challenge(text, uuid, integer) to anon, authenticated;

create or replace function public.arena_accept(p_session_token text, p_series uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); s public.arena_series; me public.arena_teams;
        w public.wallets;
begin
  perform public._arena_sweep();
  me := public._arena_team_of(v_account);
  select * into s from public.arena_series where id = p_series for update;
  if not found or s.status <> 'open' then raise exception 'series gone' using errcode = '22023'; end if;
  if me.id is distinct from s.team_b then raise exception 'not your challenge' using errcode = '42501'; end if;
  if me.a <> s.b1 or me.b is distinct from s.b2 then
    perform public._arena_void(s.id, 'roster');
    raise exception 'roster changed' using errcode = '22023';
  end if;
  w := public._wallet_lock(v_account);
  if w.coins < s.stake then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if s.stake > 0 then perform public._pay(v_account, -s.stake, 'arena_team_stake', s.id::text); end if;
  update public.arena_series set status = 'live', payer_b = v_account, accepted_at = now() where id = s.id;
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_accept(text, uuid) from public;
grant execute on function public.arena_accept(text, uuid) to anon, authenticated;

-- The challenger withdraws, or the challenged declines, an open challenge (refunded).
create or replace function public.arena_cancel(p_session_token text, p_series uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); s public.arena_series; me public.arena_teams;
begin
  me := public._arena_team_of(v_account);
  select * into s from public.arena_series where id = p_series;
  if not found or s.status <> 'open' then raise exception 'series gone' using errcode = '22023'; end if;
  if me.id is null or me.id not in (s.team_a, s.team_b) then raise exception 'not your challenge' using errcode = '42501'; end if;
  perform public._arena_void(s.id, 'cancel');
  return public._arena_state(v_account);
end $$;
revoke all on function public.arena_cancel(text, uuid) from public;
grant execute on function public.arena_cancel(text, uuid) to anon, authenticated;

-- A finished PvP match between the pair of a live series' current bout counts for it.
create or replace function public._arena_on_fight() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s public.arena_series; v_pair uuid[]; v_win uuid; v_a boolean; v_each integer; ta public.arena_teams;
        tb public.arena_teams; v_d integer;
begin
  if new.status <> 'done' or old.status is not distinct from 'done' or new.kind <> 'pvp' or new.p2 is null
     or new.winner is null or new.winner = 0 then
    return new;
  end if;
  begin
    for s in select * from public.arena_series
              where status = 'live' and accepted_at <= new.created_at
                and new.p1 in (a1, a2, b1, b2) and new.p2 in (a1, a2, b1, b2)
              for update loop
      v_pair := public._arena_pair(s, s.bout);
      continue when not (new.p1 = any(v_pair) and new.p2 = any(v_pair));
      v_win := case when new.winner = 1 then new.p1 else new.p2 end;
      v_a := v_win in (s.a1, s.a2);
      s.score_a := s.score_a + case when v_a then 1 else 0 end;
      s.score_b := s.score_b + case when v_a then 0 else 1 end;
      update public.arena_series
         set score_a = s.score_a, score_b = s.score_b, bout = s.bout + 1,
             bouts = bouts || jsonb_build_array(jsonb_build_object('bout', s.bout, 'match', new.id,
                                                                   'side', case when v_a then 'a' else 'b' end))
       where id = s.id;
      if s.score_a >= 2 or s.score_b >= 2 then
        update public.arena_series set status = 'done', ended_at = now(),
               winner = case when s.score_a >= 2 then s.team_a else s.team_b end where id = s.id;
        select * into ta from public.arena_teams where id = s.team_a for update;
        select * into tb from public.arena_teams where id = s.team_b for update;
        -- Elo, K 32
        v_d := round(32 * ((case when s.score_a >= 2 then 1 else 0 end)
                           - 1.0 / (1 + power(10, (coalesce(tb.rating, 1000) - coalesce(ta.rating, 1000)) / 400.0))));
        update public.arena_teams set rating = rating + v_d, wins = wins + case when s.score_a >= 2 then 1 else 0 end,
               losses = losses + case when s.score_a >= 2 then 0 else 1 end where id = s.team_a;
        update public.arena_teams set rating = rating - v_d, wins = wins + case when s.score_b >= 2 then 1 else 0 end,
               losses = losses + case when s.score_b >= 2 then 0 else 1 end where id = s.team_b;
        v_each := floor(s.stake * 0.95);
        for v_win in select unnest(case when s.score_a >= 2 then array[s.a1, s.a2] else array[s.b1, s.b2] end) order by 1 loop
          if v_each > 0 then
            perform public._wallet_lock(v_win);
            perform public._pay(v_win, v_each, 'arena_team_win', s.id::text);
          end if;
          perform public._game_event(v_win, 'arena_team_win', 1, jsonb_build_object('series', s.id));
        end loop;
      end if;
      exit;
    end loop;
  exception when others then
    raise warning '_arena_on_fight: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public._arena_on_fight() from public, anon, authenticated;
drop trigger if exists arena_team_fx on public.fight_matches;
create trigger arena_team_fx after update of status on public.fight_matches
  for each row execute function public._arena_on_fight();
