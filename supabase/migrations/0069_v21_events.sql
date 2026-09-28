-- 0069 — v21 foundation (owner 2026-09-29: the big feature list). Two shared pieces every v21 migration (0070+) builds on,
-- so they never re-create each other's objects:
--   A. the coin_ledger reason check with EVERY v21 reason (0052's 51 + v21's). No later v21 migration re-creates it.
--   B. public.game_events: an append-only feed of server-derived happenings (a fish caught, coins earned by reason, a
--      fight won …). Progression, quests, achievements, collections and professions subscribe with their own
--      AFTER INSERT triggers on it (their own migrations), instead of re-creating the gameplay RPCs. Emitters here are
--      triggers on the gameplay tables; a v21 feature emits its own kinds with public._game_event(…).
-- Only server code writes events, so everything hanging off them is as trustworthy as the RPCs behind them.

-- ---------- A. the ledger ----------
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy',
                    'dojo_tuition','dojo_exam',
                    'fight_stake','fight_win','fight_refund',
                    'ug_entry','ug_prize','ug_refund',
                    -- v21
                    'login_reward','level_reward','quest_reward','achievement_reward','collection_reward',
                    'ore_sell','mine_tool','potion','upgrade','gem_sell',
                    'trade','market_list','market_sell','market_buy','market_refund','auction_bid','auction_refund',
                    'auction_sell','shop_rent','shop_sell','shop_buy',
                    'pet_gacha','pet_train','pet_battle','aquarium','fish_battle',
                    'boss_reward','dungeon_entry','dungeon_reward','wild_sell',
                    'fishing_battle_entry','fishing_battle_prize','fishing_battle_refund','boat','treasure','machine',
                    'profession','skill_reset','buff_food',
                    'teleport','photo','arena_team_stake','arena_team_win','arena_team_refund'));

-- ---------- B. the event feed ----------
create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,                 -- 'fish_catch', 'earn', 'spend', 'fight_win', 'fight_done', … (v21 features add theirs)
  qty integer not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists game_events_account on public.game_events (account_id, kind, created_at);
create index if not exists game_events_created on public.game_events (created_at);
alter table public.game_events enable row level security;
revoke all on public.game_events from anon, authenticated;

create or replace function public._game_event(p_account uuid, p_kind text, p_qty integer default 1,
                                              p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public, extensions
as $$ insert into public.game_events (account_id, kind, qty, meta) values (p_account, p_kind, p_qty, coalesce(p_meta, '{}'::jsonb)) $$;
revoke all on function public._game_event(uuid, text, integer, jsonb) from public, anon, authenticated;

-- a catch (every path that lands a fish inserts into public.fish)
create or replace function public._ev_fish() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._game_event(new.account_id, 'fish_catch', 1,
    jsonb_build_object('species', new.species_id, 'weight_g', new.weight_g, 'price', new.price));
  return new;
end $$;
revoke all on function public._ev_fish() from public, anon, authenticated;
drop trigger if exists fish_ev on public.fish;
create trigger fish_ev after insert on public.fish for each row execute function public._ev_fish();

-- coins in and out, by reason (after the blacklist cap, so delta is what was really paid)
create or replace function public._ev_ledger() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.delta > 0 then
    perform public._game_event(new.account_id, 'earn', new.delta, jsonb_build_object('reason', new.reason));
  elsif new.delta < 0 then
    perform public._game_event(new.account_id, 'spend', -new.delta, jsonb_build_object('reason', new.reason));
  end if;
  return new;
end $$;
revoke all on function public._ev_ledger() from public, anon, authenticated;
drop trigger if exists coin_ledger_ev on public.coin_ledger;
create trigger coin_ledger_ev after insert on public.coin_ledger for each row execute function public._ev_ledger();

-- a finished fight: both sides get fight_done, the winner fight_win
create or replace function public._ev_fight() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public._game_event(new.p1, 'fight_done', 1, jsonb_build_object('kind', new.kind));
    if new.p2 is not null then
      perform public._game_event(new.p2, 'fight_done', 1, jsonb_build_object('kind', new.kind));
    end if;
    if new.winner = 1 then
      perform public._game_event(new.p1, 'fight_win', 1, jsonb_build_object('kind', new.kind));
    elsif new.winner = 2 and new.p2 is not null then
      perform public._game_event(new.p2, 'fight_win', 1, jsonb_build_object('kind', new.kind));
    end if;
  end if;
  return new;
end $$;
revoke all on function public._ev_fight() from public, anon, authenticated;
drop trigger if exists fight_matches_ev on public.fight_matches;
create trigger fight_matches_ev after update of status on public.fight_matches for each row execute function public._ev_fight();
