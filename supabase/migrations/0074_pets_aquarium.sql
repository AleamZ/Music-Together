-- =========================================================
-- 0074_pets_aquarium.sql — v21 group "pets": Pets v2 (#8), combat pets (#9), battle fish (#12), the aquarium (#15) and
-- the house decoration additions (#7). ADDITIVE and re-runnable. Run after 0069 (game_events, the v21 ledger reasons).
--   A. Pets v2 columns (rarity 1 Common … 5 Mythic, level/xp, affection, form, training points, skills) and the owner's
--      gacha pity, daily XP cap and daily battle counters.
--   B. Catalogs: pet_skill_catalog, pet_npc_catalog, aquarium decor (lib/game/pets/v2.ts mirrors them; pinned by
--      tests/unit/pets-v2.test.ts).
--   C. Rules: stats, XP & levels (_fighter_gain_xp), care XP with a daily cap, evolution.
--   D. The egg machine: pet_gacha_roll (server RNG, pity), pet_release.
--   E. Care: pet_pat; pet_feed / pet_play re-created from 0036 (the lines marked 0074 add affection and XP).
--      _pet_json / _pets_state re-created from 0036 (the lines marked 0074 add the v2 fields and the pity).
--   F. Following XP: an AFTER INSERT trigger on game_events — a following pet earns XP from its owner's activities.
--   G. Battle fish: fish_fighters, fish_to_fighter, fish_fighter_release.
--   H. Training & skills (pets and fish): fighter_train, fighter_learn.
--   I. Turn-based battles (pets and fish): pet_battles; PvE vs wild/trainer NPCs, PvP challenges with an escrowed
--      stake. The client only picks a skill per turn; order, hits, damage, crits and the NPC's moves are server RNG.
--   J. The aquarium: furniture kinds 'aquarium' (+ 'cabinet', 'painting'), aquarium_fish, aquarium_tanks, RPCs to put
--      fish in, take them out, decorate, and view a home's tanks as a visitor (the rare fish showcase).
--   K. #7: more furniture rows; houses get the apartments' knock → admit flow (house_knocks, house_guests,
--      _house_can_enter re-created from 0042 with the line marked 0074).
--   L. A wipe (anticheat_wipes insert) also clears the fish fighters and battles (own trigger, _ac_wipe untouched).
-- Ledger reasons used (all already in 0069): 'pet_gacha', 'pet_train', 'pet_battle', 'fish_battle', 'aquarium'.
-- game_events emitted: 'pet_gacha' (meta rarity, species), 'pet_levelup' (qty = new level), 'pet_evolved' (qty = form),
--   'pet_battle_win' / 'fish_battle_win' (meta mode, npc), 'pet_battle_done' (meta mode, won, kind), 'pet_trained',
--   'fish_fighter_new', 'aquarium_add', 'xp_grant' (meta {"source":"pet"}).
-- game_events consumed: every kind except earn/spend/xp*/…level…/pet_*/fish_battle*/fish_fighter*/aquarium* → +2 XP
--   for the owner's following pet, at most once per 5 s and 300 care+follow XP per Vietnam day.
-- =========================================================

-- ---------- A. Columns ----------
alter table public.pets add column if not exists rarity smallint not null default 1 check (rarity between 1 and 5);
alter table public.pets add column if not exists level smallint not null default 1 check (level between 1 and 50);
alter table public.pets add column if not exists xp integer not null default 0 check (xp >= 0);
alter table public.pets add column if not exists affection smallint not null default 0 check (affection between 0 and 100);
alter table public.pets add column if not exists form smallint not null default 0 check (form between 0 and 2);
alter table public.pets add column if not exists trn_hp smallint not null default 0 check (trn_hp >= 0);
alter table public.pets add column if not exists trn_atk smallint not null default 0 check (trn_atk >= 0);
alter table public.pets add column if not exists trn_def smallint not null default 0 check (trn_def >= 0);
alter table public.pets add column if not exists trn_spd smallint not null default 0 check (trn_spd >= 0);
alter table public.pets add column if not exists skills text[] not null default '{tackle}';
alter table public.pets add column if not exists pat_at timestamptz;
alter table public.pets add column if not exists train_at timestamptz;
alter table public.pets add column if not exists origin text not null default 'shop' check (origin in ('shop','gacha'));

alter table public.pet_owner add column if not exists pity integer not null default 0;
alter table public.pet_owner add column if not exists gacha_at timestamptz;
alter table public.pet_owner add column if not exists xp_day date;
alter table public.pet_owner add column if not exists xp_today integer not null default 0;
alter table public.pet_owner add column if not exists follow_at timestamptz;
alter table public.pet_owner add column if not exists battle_day date;
alter table public.pet_owner add column if not exists battles_today integer not null default 0;
alter table public.pet_owner add column if not exists wins_today integer not null default 0;

-- ---------- B. Catalogs ----------
create table if not exists public.pet_skill_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('hit','guard','heal')),
  power smallint not null,
  acc smallint not null check (acc between 1 and 100),
  min_level smallint not null,
  min_form smallint not null,
  price integer not null check (price >= 0),
  who text not null check (who in ('pet','fish','both')),
  sort_order smallint not null
);
alter table public.pet_skill_catalog enable row level security;
revoke all on public.pet_skill_catalog from anon, authenticated;
insert into public.pet_skill_catalog (id, name, kind, power, acc, min_level, min_form, price, who, sort_order) values
  ('tackle', 'Húc', 'hit', 10, 100, 1, 0, 0, 'both', 1),
  ('splash', 'Quẫy nước', 'hit', 14, 95, 1, 0, 0, 'fish', 2),
  ('guard', 'Thủ thế', 'guard', 0, 100, 2, 0, 250, 'both', 3),
  ('bite', 'Cắn', 'hit', 16, 90, 3, 0, 300, 'both', 4),
  ('heal', 'Liếm vết thương', 'heal', 0, 100, 5, 0, 500, 'pet', 5),
  ('fury', 'Cuồng nộ', 'hit', 26, 75, 10, 0, 1200, 'both', 6),
  ('ultimate', 'Tuyệt kỹ', 'hit', 40, 70, 15, 1, 3000, 'pet', 7)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, power = excluded.power, acc = excluded.acc,
  min_level = excluded.min_level, min_form = excluded.min_form, price = excluded.price, who = excluded.who,
  sort_order = excluded.sort_order;

create table if not exists public.pet_npc_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('wild','trainer')),
  species text not null,
  variant text not null,
  level smallint not null,
  hp integer not null, atk integer not null, def integer not null, spd integer not null,
  skills text[] not null,
  reward integer not null,
  sort_order smallint not null
);
alter table public.pet_npc_catalog enable row level security;
revoke all on public.pet_npc_catalog from anon, authenticated;
insert into public.pet_npc_catalog (id, name, kind, species, variant, level, hp, atk, def, spd, skills, reward, sort_order) values
  ('meo_hoang', 'Mèo hoang', 'wild', 'meo', 'den', 3, 60, 12, 9, 12, '{tackle,bite}', 40, 1),
  ('cho_co', 'Chó cỏ', 'wild', 'cho', 'vang', 6, 80, 15, 12, 11, '{tackle,bite,guard}', 70, 2),
  ('soc_nui', 'Sóc núi', 'wild', 'soc', 'do', 9, 85, 17, 12, 18, '{tackle,bite,guard}', 90, 3),
  ('thay_tu', 'Thầy Tư', 'trainer', 'cho', 'nau', 14, 120, 22, 17, 14, '{tackle,bite,guard,heal}', 150, 4),
  ('co_bay', 'Cô Bảy', 'trainer', 'vet', 'lam', 22, 160, 30, 22, 22, '{tackle,bite,heal,fury}', 250, 5),
  ('ho_than', 'Hổ thần', 'wild', 'meo', 'cam', 32, 240, 42, 32, 20, '{bite,fury,guard,heal}', 450, 6)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, species = excluded.species,
  variant = excluded.variant, level = excluded.level, hp = excluded.hp, atk = excluded.atk, def = excluded.def,
  spd = excluded.spd, skills = excluded.skills, reward = excluded.reward, sort_order = excluded.sort_order;

-- The aquarium decorations: id → price (null: unknown).
create or replace function public._aqua_decor_price(p_id text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_id when 'rong' then 150 when 'da' then 100 when 'san_ho' then 300 when 'ruong' then 350 when 'lau_dai' then 400 end $$;
revoke all on function public._aqua_decor_price(text) from public, anon, authenticated;

-- The rules (lib/game/pets/v2.ts mirrors each literal; tests pin them).
create or replace function public._pv2(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_what
    when 'gacha_price' then 1500 when 'pity' then 40 when 'max_pets' then 12 when 'max_level' then 50
    when 'day_xp' then 300 when 'max_fish' then 6 when 'fish_rarity' then 3 when 'pve_day' then 40
    when 'pve_paid' then 10 when 'max_stake' then 1000 when 'max_decor' then 4 when 'max_turns' then 30 end
$$;
revoke all on function public._pv2(text) from public, anon, authenticated;

-- ---------- C. Rules ----------
-- XP from level L to L + 1.
create or replace function public._pet_xp_need(p_level integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select 20 * p_level $$;
revoke all on function public._pet_xp_need(integer) from public, anon, authenticated;

-- A pet's battle stats: the species' base, + per level, + training, × rarity (+15 % a tier) × form (+10 % a form).
create or replace function public._pet_stats(p public.pets) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare b int[]; m numeric;
begin
  b := case p.species when 'hamster' then array[40,8,8,14] when 'tho' then array[42,9,8,15] when 'soc' then array[44,10,8,13]
                      when 'meo' then array[46,11,9,12] when 'cho' then array[52,12,10,10] else array[40,11,7,16] end;
  m := (1 + 0.15 * (p.rarity - 1)) * (1 + 0.1 * p.form);
  return jsonb_build_object(
    'hp', round((b[1] + 4 * (p.level - 1) + 5 * p.trn_hp) * m)::int,
    'atk', round((b[2] + 1.2 * (p.level - 1) + 2 * p.trn_atk) * m)::int,
    'def', round((b[3] + 1.0 * (p.level - 1) + 2 * p.trn_def) * m)::int,
    'spd', round((b[4] + 0.8 * (p.level - 1) + 2 * p.trn_spd) * m)::int);
end $$;
revoke all on function public._pet_stats(public.pets) from public, anon, authenticated;

-- The owner's row (created when missing), locked.
create or replace function public._pet_owner_row(p_account uuid) returns public.pet_owner
language plpgsql security definer set search_path = public, extensions
as $$
declare o public.pet_owner;
begin
  insert into public.pet_owner (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into o from public.pet_owner where account_id = p_account for update;
  return o;
end $$;
revoke all on function public._pet_owner_row(uuid) from public, anon, authenticated;

-- ---------- G (table first: the XP helper reads it). Battle fish ----------
create table if not exists public.fish_fighters (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  fish_id uuid not null unique,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  name text not null check (char_length(name) between 1 and 16),
  level smallint not null default 1 check (level between 1 and 50),
  xp integer not null default 0 check (xp >= 0),
  trn_hp smallint not null default 0, trn_atk smallint not null default 0,
  trn_def smallint not null default 0, trn_spd smallint not null default 0,
  skills text[] not null default '{tackle,splash}',
  train_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fish_fighters_account on public.fish_fighters (account_id);
alter table public.fish_fighters enable row level security;
revoke all on public.fish_fighters from anon, authenticated;

create or replace function public._fish_stats(f public.fish_fighters) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare r int := coalesce((select rarity from public.fish_species where id = f.species_id), 1);
begin
  return jsonb_build_object(
    'hp', (40 + 10 * r + least(40, f.weight_g / 250) + 4 * (f.level - 1) + 5 * f.trn_hp)::int,
    'atk', round(8 + 3 * r + 1.2 * (f.level - 1) + 2 * f.trn_atk)::int,
    'def', round(6 + 2 * r + 1.0 * (f.level - 1) + 2 * f.trn_def)::int,
    'spd', round(10 + 2 * r + 0.8 * (f.level - 1) + 2 * f.trn_spd)::int,
    'rarity', r);
end $$;
revoke all on function public._fish_stats(public.fish_fighters) from public, anon, authenticated;

-- Add XP to a pet or a battle fish (a gone fighter is skipped); levels up (max 50). A pet's level-up emits pet_levelup
-- and grants the owner player XP. Returns the new level (null: no such fighter).
create or replace function public._fighter_gain_xp(p_kind text, p_id bigint, p_xp integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_lv int; v_old int; v_xp int; v_sp text; v_ra int;
begin
  if p_xp is null or p_xp <= 0 then return null; end if;
  if p_kind = 'pet' then
    select account_id, level, xp, species, rarity into v_acc, v_lv, v_xp, v_sp, v_ra from public.pets where id = p_id for update;
  else
    select account_id, level, xp, species_id, 0 into v_acc, v_lv, v_xp, v_sp, v_ra from public.fish_fighters where id = p_id for update;
  end if;
  if v_acc is null then return null; end if;
  v_old := v_lv;
  v_xp := v_xp + p_xp;
  while v_lv < public._pv2('max_level') and v_xp >= public._pet_xp_need(v_lv) loop
    v_xp := v_xp - public._pet_xp_need(v_lv);
    v_lv := v_lv + 1;
  end loop;
  if v_lv >= public._pv2('max_level') then v_xp := 0; end if;
  if p_kind = 'pet' then
    update public.pets set level = v_lv, xp = v_xp where id = p_id;
  else
    update public.fish_fighters set level = v_lv, xp = v_xp where id = p_id;
  end if;
  if v_lv > v_old then
    if p_kind = 'pet' then
      perform public._game_event(v_acc, 'pet_levelup', v_lv, jsonb_build_object('pet', p_id, 'species', v_sp, 'rarity', v_ra));
    else
      perform public._game_event(v_acc, 'fish_fighter_levelup', v_lv, jsonb_build_object('fighter', p_id, 'species', v_sp));
    end if;
    perform public._game_event(v_acc, 'xp_grant', 10 * (v_lv - v_old), '{"source":"pet"}'::jsonb);
  end if;
  return v_lv;
end $$;
revoke all on function public._fighter_gain_xp(text, bigint, integer) from public, anon, authenticated;

-- Care / follow XP under the owner's daily cap (300 per Vietnam day). Returns the XP actually given.
create or replace function public._pet_care_xp(p_account uuid, p_pet bigint, p_xp integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare o public.pet_owner; v_today date := public._vn_today(); v_done int; v_n int;
begin
  o := public._pet_owner_row(p_account);
  v_done := case when o.xp_day = v_today then o.xp_today else 0 end;
  v_n := least(p_xp, public._pv2('day_xp') - v_done);
  if v_n <= 0 then return 0; end if;
  update public.pet_owner set xp_day = v_today, xp_today = v_done + v_n where account_id = p_account;
  perform public._fighter_gain_xp('pet', p_pet, v_n);
  return v_n;
end $$;
revoke all on function public._pet_care_xp(uuid, bigint, integer) from public, anon, authenticated;

-- ---------- E. JSON (re-created from 0036; the lines marked 0074 are new) ----------
create or replace function public._pet_json(p public.pets) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id, 'species', p.species, 'variant', p.variant, 'name', p.name,
    'fullness', round(p.fullness, 2), 'happy', round(p.happy, 2), 'sulking', p.fullness <= 0,
    'head', p.head, 'neck', p.neck, 'body', p.body,
    'play_ready_ms', case when p.played_at > now() - interval '10 minutes'
                          then (extract(epoch from p.played_at + interval '10 minutes') * 1000)::bigint end)
    || jsonb_build_object(                                                                              -- 0074
    'rarity', p.rarity, 'level', p.level, 'xp', p.xp, 'xp_need', public._pet_xp_need(p.level),          -- 0074
    'affection', p.affection, 'form', p.form, 'skills', to_jsonb(p.skills), 'origin', p.origin,         -- 0074
    'trn', jsonb_build_object('hp', p.trn_hp, 'atk', p.trn_atk, 'def', p.trn_def, 'spd', p.trn_spd),    -- 0074
    'stats', public._pet_stats(p),                                                                      -- 0074
    'pat_ready_ms', case when p.pat_at > now() - interval '60 seconds'                                  -- 0074
                         then (extract(epoch from p.pat_at + interval '60 seconds') * 1000)::bigint end) -- 0074
$$;

create or replace function public._pets_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'pets', coalesce((select jsonb_agg(public._pet_json(public._pet_now(p)) order by p.id)
                      from public.pets p where p.account_id = p_account), '[]'::jsonb),
    'active', (select o.active_pet from public.pet_owner o where o.account_id = p_account),
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty) from public.pet_items i
                       where i.account_id = p_account and i.qty > 0), '{}'::jsonb),
    'forage_today', coalesce((select case when o.forage_day = (now() at time zone 'Asia/Ho_Chi_Minh')::date
                                          then o.forage_today else 0 end
                              from public.pet_owner o where o.account_id = p_account), 0),
    'pity', coalesce((select o.pity from public.pet_owner o where o.account_id = p_account), 0),              -- 0074
    'xp_today', coalesce((select case when o.xp_day = public._vn_today() then o.xp_today else 0 end          -- 0074
                          from public.pet_owner o where o.account_id = p_account), 0),                        -- 0074
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;
revoke all on function public._pet_json(public.pets) from public, anon, authenticated;
revoke all on function public._pets_state(uuid) from public, anon, authenticated;

-- ---------- D. The egg machine ----------
create or replace function public._pet_variants(p_species text) returns text[]
language sql immutable set search_path = public, extensions
as $$
  select case p_species
    when 'hamster' then array['vang','trang','xam'] when 'tho' then array['trang','nau','xam']
    when 'soc' then array['nau','do','xam'] when 'meo' then array['cam','den','trang']
    when 'cho' then array['vang','nau','trang'] when 'vet' then array['xanh','do','lam'] end
$$;
revoke all on function public._pet_variants(text) from public, anon, authenticated;

-- The rarity of a roll r ∈ [0,1): Mythic 0.5 %, Legendary 2.5 %, Epic 10 %, Rare 27 %, Common 60 %.
create or replace function public._gacha_tier(p_r numeric) returns smallint
language sql immutable set search_path = public, extensions
as $$ select (case when p_r < 0.005 then 5 when p_r < 0.03 then 4 when p_r < 0.13 then 3 when p_r < 0.40 then 2 else 1 end)::smallint $$;
revoke all on function public._gacha_tier(numeric) from public, anon, authenticated;

-- One egg: 1500 xu. The 40th egg without a Legendary or better is a Legendary (a tenth of those a Mythic).
create or replace function public.pet_gacha_roll(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); o public.pet_owner; v_coins int; v_bal int;
        v_tier smallint; v_pool text[]; v_sp text; v_var text; v_id bigint; v_pity int;
begin
  perform public._wallet_lock(v_account);
  o := public._pet_owner_row(v_account);
  if o.gacha_at > now() - interval '2 seconds' then raise exception 'too soon' using errcode = '53400'; end if;
  if (select count(*) from public.pets where account_id = v_account) >= public._pv2('max_pets') then
    raise exception 'too many pets' using errcode = '53400';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._pv2('gacha_price') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._pv2('gacha_price'), 'pet_gacha', 'egg');
  v_pity := o.pity + 1;
  if v_pity >= public._pv2('pity') then
    v_tier := case when random() < 0.1 then 5 else 4 end;
  else
    v_tier := public._gacha_tier(random()::numeric);
  end if;
  if v_tier >= 4 then v_pity := 0; end if;
  v_pool := case v_tier when 1 then array['hamster','tho'] when 2 then array['soc','meo'] when 3 then array['cho','vet']
                        else array['hamster','tho','soc','meo','cho','vet'] end;
  v_sp := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
  v_var := (public._pet_variants(v_sp))[1 + floor(random() * 3)::int];
  insert into public.pets (account_id, species, variant, name, rarity, origin, fullness, happy)
  values (v_account, v_sp, v_var, public._pet_species_name(v_sp), v_tier, 'gacha', 80, 80)
  returning id into v_id;
  update public.pet_owner set pity = v_pity, gacha_at = now(), active_pet = coalesce(active_pet, v_id)
   where account_id = v_account;
  perform public._game_event(v_account, 'pet_gacha', 1, jsonb_build_object('rarity', v_tier, 'species', v_sp));
  return public._pets_state(v_account)
         || jsonb_build_object('coins', v_bal, 'pet_id', v_id, 'rolled', jsonb_build_object('rarity', v_tier, 'species', v_sp, 'variant', v_var));
end $$;

-- Let a pet go (not while it fights).
create or replace function public.pet_release(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets;
begin
  p := public._pet_mine(v_account, p_pet);
  if exists (select 1 from public.pet_battles where status <> 'done' and (p1 = v_account or p2 = v_account)
               and ((f1->>'kind' = 'pet' and (f1->>'id')::bigint = p.id) or (f2->>'kind' = 'pet' and (f2->>'id')::bigint = p.id))) then
    raise exception 'in battle' using errcode = '53400';
  end if;
  update public.pet_owner set active_pet = null where account_id = v_account and active_pet = p.id;
  delete from public.pets where id = p.id;
  return public._pets_state(v_account);
end $$;

-- ---------- E. Care ----------
-- Pat a pet: +2 affection, +3 XP (under the daily cap), once a minute per pet. Not while sulking.
create or replace function public.pet_pat(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets;
begin
  p := public._pet_mine(v_account, p_pet);
  if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
  if p.pat_at > now() - interval '60 seconds' then raise exception 'too soon' using errcode = '53400'; end if;
  update public.pets set affection = least(100, p.affection + 2), pat_at = now() where id = p.id;
  perform public._pet_care_xp(v_account, p.id, 3);
  return public._pets_state(v_account);
end $$;

-- 0036's pet_feed, verbatim but for the lines marked 0074: the lock gate, +3 affection, +5 XP.
create or replace function public.pet_feed(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets;   -- 0074 was: _auth_account
begin
  p := public._pet_mine(v_account, p_pet);
  update public.pet_items set qty = qty - 1
   where account_id = v_account and item_id = 'food_' || p.species and qty > 0;
  if not found then raise exception 'no food' using errcode = '53400'; end if;
  update public.pets set fullness = least(100, p.fullness + 40), happy = least(100, p.happy + 5), stats_at = now()
   , affection = least(100, p.affection + 3)                                     -- 0074
   where id = p.id;
  perform public._pet_care_xp(v_account, p.id, 5);                               -- 0074
  return public._pets_state(v_account);
end $$;

-- 0036's pet_play, verbatim but for the lines marked 0074: the lock gate, +5 affection, +10 XP.
create or replace function public.pet_play(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets;   -- 0074 was: _auth_account
begin
  p := public._pet_mine(v_account, p_pet);
  if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
  if not exists (select 1 from public.pet_items i join public.pet_item_catalog c on c.id = i.item_id
                  where i.account_id = v_account and i.qty > 0 and c.kind = 'toy' and c.species = p.species) then
    raise exception 'no toy' using errcode = '53400';
  end if;
  if p.played_at > now() - interval '10 minutes' then raise exception 'too soon' using errcode = '53400'; end if;
  update public.pets set fullness = p.fullness, happy = least(100, p.happy + 25), stats_at = now(), played_at = now()
   , affection = least(100, p.affection + 5)                                     -- 0074
   where id = p.id;
  perform public._pet_care_xp(v_account, p.id, 10);                              -- 0074
  return public._pets_state(v_account);
end $$;

-- Evolve: form 1 at level 10 with affection ≥ 40, form 2 at level 25 with affection ≥ 80.
create or replace function public.pet_evolve(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets;
begin
  p := public._pet_mine(v_account, p_pet);
  if p.form >= 2 then raise exception 'max form' using errcode = '53400'; end if;
  if p.level < (case p.form when 0 then 10 else 25 end) then raise exception 'level too low' using errcode = '53400'; end if;
  if p.affection < (case p.form when 0 then 40 else 80 end) then raise exception 'affection too low' using errcode = '53400'; end if;
  update public.pets set form = p.form + 1 where id = p.id;
  perform public._game_event(v_account, 'pet_evolved', p.form + 1, jsonb_build_object('pet', p.id, 'species', p.species));
  perform public._game_event(v_account, 'xp_grant', 50, '{"source":"pet"}'::jsonb);
  return public._pets_state(v_account);
end $$;

-- ---------- F. Following XP ----------
create or replace function public._pet_ev_follow() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.pets; o public.pet_owner;
begin
  begin
    p := public._pet_following(new.account_id);
    if p.id is null then return null; end if;
    o := public._pet_owner_row(new.account_id);
    if o.follow_at > now() - interval '5 seconds' then return null; end if;
    update public.pet_owner set follow_at = now() where account_id = new.account_id;
    perform public._pet_care_xp(new.account_id, p.id, 2);
  exception when others then
    raise warning 'pet follow xp skipped: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public._pet_ev_follow() from public, anon, authenticated;
drop trigger if exists game_events_pet_follow on public.game_events;
create trigger game_events_pet_follow after insert on public.game_events for each row
  when (new.kind not in ('earn', 'spend') and new.kind not like 'xp%' and new.kind not like '%level%'
        and new.kind not like 'pet\_%' and new.kind not like 'fish\_battle%' and new.kind not like 'fish\_fighter%'
        and new.kind not like 'aquarium%')
  execute function public._pet_ev_follow();

-- ---------- G. Battle fish RPCs ----------
create or replace function public._fish_fighter_json(f public.fish_fighters) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g, 'name', f.name,
    'level', f.level, 'xp', f.xp, 'xp_need', public._pet_xp_need(f.level), 'skills', to_jsonb(f.skills),
    'trn', jsonb_build_object('hp', f.trn_hp, 'atk', f.trn_atk, 'def', f.trn_def, 'spd', f.trn_spd),
    'stats', public._fish_stats(f))
$$;
revoke all on function public._fish_fighter_json(public.fish_fighters) from public, anon, authenticated;

-- Keep a rare (rarity ≥ 3) fish from the bag as a fighter (max 6). The fish leaves the bag for good.
create or replace function public.fish_to_fighter(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.fish; v_ra int; v_name text; v_skills text[];
begin
  perform public._wallet_lock(v_account);
  if (select count(*) from public.fish_fighters where account_id = v_account) >= public._pv2('max_fish') then
    raise exception 'too many fighters' using errcode = '53400';
  end if;
  select * into r from public.fish where id = p_fish_id and account_id = v_account for update;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  select rarity, left(name, 16) into v_ra, v_name from public.fish_species where id = r.species_id;
  if coalesce(v_ra, 0) < public._pv2('fish_rarity') then raise exception 'not rare' using errcode = '53400'; end if;
  delete from public.fish where id = r.id;
  v_skills := case when v_ra >= 5 then array['tackle','splash','bite'] else array['tackle','splash'] end;
  insert into public.fish_fighters (account_id, fish_id, species_id, weight_g, name, skills)
  values (v_account, r.id, r.species_id, r.weight_g, v_name, v_skills);
  perform public._game_event(v_account, 'fish_fighter_new', 1, jsonb_build_object('species', r.species_id, 'rarity', v_ra));
  return public._battle_state(v_account, null);
end $$;

create or replace function public.fish_fighter_release(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if exists (select 1 from public.pet_battles where status <> 'done' and (p1 = v_account or p2 = v_account)
               and ((f1->>'kind' = 'fish' and (f1->>'id')::bigint = p_id) or (f2->>'kind' = 'fish' and (f2->>'id')::bigint = p_id))) then
    raise exception 'in battle' using errcode = '53400';
  end if;
  delete from public.fish_fighters where id = p_id and account_id = v_account;
  if not found then raise exception 'not your fighter' using errcode = '42501'; end if;
  return public._battle_state(v_account, null);
end $$;

-- ---------- H. Training & skills ----------
-- +1 training point in hp/atk/def/spd: at most 5 + level points per stat (≤ 30), 100 + 50 × points xu, once per 20 s per
-- fighter. A pet must not be sulking and pays 5 no; both gain 8 XP.
create or replace function public.fighter_train(p_session_token text, p_kind text, p_id bigint, p_stat text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; f public.fish_fighters; v_pts int; v_lv int;
        v_at timestamptz; v_cost int; v_coins int; v_bal int; v_reason text;
begin
  if p_stat is null or p_stat not in ('hp','atk','def','spd') then raise exception 'bad stat' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if p_kind = 'pet' then
    p := public._pet_mine(v_account, p_id);
    if p.fullness <= 5 then raise exception 'hungry' using errcode = '53400'; end if;
    v_pts := case p_stat when 'hp' then p.trn_hp when 'atk' then p.trn_atk when 'def' then p.trn_def else p.trn_spd end;
    v_lv := p.level; v_at := p.train_at; v_reason := 'pet_train';
  elsif p_kind = 'fish' then
    select * into f from public.fish_fighters where id = p_id and account_id = v_account for update;
    if not found then raise exception 'not your fighter' using errcode = '42501'; end if;
    v_pts := case p_stat when 'hp' then f.trn_hp when 'atk' then f.trn_atk when 'def' then f.trn_def else f.trn_spd end;
    v_lv := f.level; v_at := f.train_at; v_reason := 'fish_battle';
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if v_at > now() - interval '20 seconds' then raise exception 'too soon' using errcode = '53400'; end if;
  if v_pts >= least(30, 5 + v_lv) then raise exception 'train cap' using errcode = '53400'; end if;
  v_cost := 100 + 50 * v_pts;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_cost then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_cost, v_reason, 'train ' || p_kind || ' #' || p_id || ' ' || p_stat);
  if p_kind = 'pet' then
    update public.pets set trn_hp = trn_hp + (p_stat = 'hp')::int, trn_atk = trn_atk + (p_stat = 'atk')::int,
      trn_def = trn_def + (p_stat = 'def')::int, trn_spd = trn_spd + (p_stat = 'spd')::int,
      fullness = greatest(0, p.fullness - 5), happy = p.happy, stats_at = now(), train_at = now() where id = p.id;
  else
    update public.fish_fighters set trn_hp = trn_hp + (p_stat = 'hp')::int, trn_atk = trn_atk + (p_stat = 'atk')::int,
      trn_def = trn_def + (p_stat = 'def')::int, trn_spd = trn_spd + (p_stat = 'spd')::int, train_at = now() where id = f.id;
  end if;
  perform public._fighter_gain_xp(p_kind, p_id, 8);
  perform public._game_event(v_account, 'pet_trained', 1, jsonb_build_object('kind', p_kind, 'stat', p_stat));
  return public._battle_state(v_account, null) || public._pets_state(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Learn a skill: the catalog's level, form and price (pets: 'pet_train', fish: 'fish_battle'), who may learn it.
create or replace function public.fighter_learn(p_session_token text, p_kind text, p_id bigint, p_skill text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); s public.pet_skill_catalog; p public.pets; f public.fish_fighters;
        v_lv int; v_form int; v_has text[]; v_coins int; v_bal int;
begin
  select * into s from public.pet_skill_catalog where id = p_skill;
  if not found then raise exception 'unknown skill' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if p_kind = 'pet' then
    p := public._pet_mine(v_account, p_id); v_lv := p.level; v_form := p.form; v_has := p.skills;
  elsif p_kind = 'fish' then
    select * into f from public.fish_fighters where id = p_id and account_id = v_account for update;
    if not found then raise exception 'not your fighter' using errcode = '42501'; end if;
    v_lv := f.level; v_form := 0; v_has := f.skills;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if s.who <> 'both' and s.who <> p_kind then raise exception 'wrong kind' using errcode = '22023'; end if;
  if p_skill = any(v_has) then raise exception 'already known' using errcode = '22023'; end if;
  if v_lv < s.min_level or v_form < s.min_form then raise exception 'level too low' using errcode = '53400'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < s.price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if s.price > 0 then
    v_bal := public._pay(v_account, -s.price, case p_kind when 'pet' then 'pet_train' else 'fish_battle' end, 'skill ' || p_skill);
  end if;
  if p_kind = 'pet' then update public.pets set skills = skills || p_skill where id = p.id;
  else update public.fish_fighters set skills = skills || p_skill where id = f.id; end if;
  return public._battle_state(v_account, null) || public._pets_state(v_account)
         || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end;
end $$;

-- ---------- I. Battles ----------
create table if not exists public.pet_battles (
  id bigserial primary key,
  mode text not null check (mode in ('pve','pvp')),
  status text not null default 'active' check (status in ('pending','active','done')),
  p1 uuid not null references public.accounts(id) on delete cascade,
  p2 uuid references public.accounts(id) on delete cascade,
  f1 jsonb not null,
  f2 jsonb,
  npc text references public.pet_npc_catalog(id),
  hp1 integer, hp2 integer,
  heals1 smallint not null default 0, heals2 smallint not null default 0,
  a1 text, a2 text,                        -- this turn's picks (never shown to the other side)
  turn integer not null default 1,
  log jsonb not null default '[]'::jsonb,  -- the last turn
  stake integer not null default 0 check (stake >= 0),
  winner smallint,                         -- 1, 2, 0 = draw
  reward integer not null default 0,       -- what side 1 was paid (PvE) / the winner's prize (PvP)
  created_at timestamptz not null default now(),
  acted_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists pet_battles_p1 on public.pet_battles (p1, status);
create index if not exists pet_battles_p2 on public.pet_battles (p2, status);
create index if not exists pet_battles_open on public.pet_battles (status, acted_at) where status <> 'done';
alter table public.pet_battles enable row level security;
revoke all on public.pet_battles from anon, authenticated;

-- My fighter as a battle snapshot (locked; a pet must have ≥ 10 no and pays 8 of it).
create or replace function public._fighter_snap(p_account uuid, p_kind text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.pets; f public.fish_fighters;
begin
  if p_kind = 'pet' then
    select * into p from public.pets where id = p_id and account_id = p_account for update;
    if not found then raise exception 'not your fighter' using errcode = '42501'; end if;
    p := public._pet_now(p);
    if p.fullness < 10 then raise exception 'hungry' using errcode = '53400'; end if;
    update public.pets set fullness = p.fullness - 8, happy = p.happy, stats_at = now() where id = p.id;
    return jsonb_build_object('kind', 'pet', 'id', p.id, 'name', p.name, 'species', p.species, 'variant', p.variant,
      'rarity', p.rarity, 'form', p.form, 'level', p.level, 'skills', to_jsonb(p.skills)) || public._pet_stats(p);
  elsif p_kind = 'fish' then
    select * into f from public.fish_fighters where id = p_id and account_id = p_account for update;
    if not found then raise exception 'not your fighter' using errcode = '42501'; end if;
    return jsonb_build_object('kind', 'fish', 'id', f.id, 'name', f.name, 'species', f.species_id, 'variant', '',
      'form', 0, 'level', f.level, 'skills', to_jsonb(f.skills)) || public._fish_stats(f);
  end if;
  raise exception 'bad kind' using errcode = '22023';
end $$;
revoke all on function public._fighter_snap(uuid, text, bigint) from public, anon, authenticated;

create or replace function public._npc_snap(n public.pet_npc_catalog) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select jsonb_build_object('kind', 'npc', 'id', n.id, 'name', n.name, 'species', n.species, 'variant', n.variant,
    'rarity', 0, 'form', 0, 'level', n.level, 'skills', to_jsonb(n.skills), 'hp', n.hp, 'atk', n.atk, 'def', n.def, 'spd', n.spd)
$$;
revoke all on function public._npc_snap(public.pet_npc_catalog) from public, anon, authenticated;

-- The NPC's pick: heal when low (60 %), guard now and then (12 %), else a random attack it knows.
create or replace function public._battle_ai(p_f jsonb, p_hp integer, p_heals integer) returns text
language plpgsql volatile set search_path = public, extensions
as $$
declare v_sk text[] := array(select jsonb_array_elements_text(p_f->'skills')); v_hits text[];
begin
  if 'heal' = any(v_sk) and p_heals < 2 and p_hp < (p_f->>'hp')::int * 0.35 and random() < 0.6 then return 'heal'; end if;
  if 'guard' = any(v_sk) and random() < 0.12 then return 'guard'; end if;
  v_hits := array(select c.id from public.pet_skill_catalog c where c.kind = 'hit' and c.id = any(v_sk) order by c.sort_order);
  if coalesce(array_length(v_hits, 1), 0) = 0 then return 'tackle'; end if;
  return v_hits[1 + floor(random() * array_length(v_hits, 1))::int];
end $$;
revoke all on function public._battle_ai(jsonb, integer, integer) from public, anon, authenticated;

-- One hit's damage: power × atk / (atk + def) × 2.2 × [0.85, 1.15), × 1.5 on a crit, × 0.4 into a guard; at least 1.
create or replace function public._battle_dmg(p_power integer, p_atk integer, p_def integer, p_roll numeric, p_crit boolean,
                                              p_guard boolean) returns integer
language sql immutable set search_path = public, extensions
as $$
  select greatest(1, round(p_power * p_atk::numeric / greatest(1, p_atk + p_def) * 2.2 * (0.85 + p_roll * 0.3)
                           * (case when p_crit then 1.5 else 1 end) * (case when p_guard then 0.4 else 1 end)))::int
$$;
revoke all on function public._battle_dmg(integer, integer, integer, numeric, boolean, boolean) from public, anon, authenticated;

-- End a battle: XP to both sides' fighters, the PvE reward (the first 10 wins a day), the PvP pot (the winner takes the
-- two stakes less 10 %; a draw refunds them), the events.
create or replace function public._battle_finish(p_id bigint, p_winner smallint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles; s int; v_acc uuid; v_f jsonb; v_won boolean; v_reason text; v_xp int; v_npc public.pet_npc_catalog;
        o public.pet_owner; v_today date := public._vn_today(); v_reward int := 0; v_wins int;
begin
  select * into b from public.pet_battles where id = p_id for update;
  if not found or b.status = 'done' then return; end if;
  if b.npc is not null then select * into v_npc from public.pet_npc_catalog where id = b.npc; end if;
  for s in 1..2 loop
    v_acc := case s when 1 then b.p1 else b.p2 end;
    v_f := case s when 1 then b.f1 else b.f2 end;
    continue when v_acc is null or v_f is null or v_f->>'kind' not in ('pet','fish');
    v_won := p_winner = s;
    v_reason := case v_f->>'kind' when 'pet' then 'pet_battle' else 'fish_battle' end;
    v_xp := case when b.mode = 'pve' then case when v_won then 10 + v_npc.level else 4 end
                 else case when v_won then 30 else 10 end end;
    perform public._fighter_gain_xp(v_f->>'kind', (v_f->>'id')::bigint, v_xp);
    if b.mode = 'pve' and v_won then
      perform public._wallet_lock(v_acc);
      o := public._pet_owner_row(v_acc);
      v_wins := case when o.battle_day = v_today then o.wins_today else 0 end;
      if v_wins < public._pv2('pve_paid') then
        v_reward := v_npc.reward;
        perform public._pay(v_acc, v_reward, v_reason, 'pve ' || b.npc || ' #' || b.id);
      end if;
      update public.pet_owner set battle_day = v_today, wins_today = v_wins + 1,
        battles_today = case when o.battle_day = v_today then o.battles_today else 0 end
       where account_id = v_acc;
    elsif b.mode = 'pvp' and b.stake > 0 then
      if p_winner = 0 then
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, b.stake, v_reason, 'pvp refund #' || b.id);
      elsif v_won then
        v_reward := 2 * b.stake - (2 * b.stake) / 10;
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, v_reward, v_reason, 'pvp win #' || b.id);
      end if;
    end if;
    if v_won then
      perform public._game_event(v_acc, case v_f->>'kind' when 'pet' then 'pet_battle_win' else 'fish_battle_win' end, 1,
                                 jsonb_build_object('mode', b.mode, 'npc', b.npc));
      perform public._game_event(v_acc, 'xp_grant', case b.mode when 'pve' then 15 else 25 end, '{"source":"pet"}'::jsonb);
    end if;
    perform public._game_event(v_acc, 'pet_battle_done', 1, jsonb_build_object('mode', b.mode, 'won', v_won, 'kind', v_f->>'kind'));
  end loop;
  update public.pet_battles set status = 'done', winner = p_winner, reward = v_reward, a1 = null, a2 = null,
    finished_at = now() where id = p_id;
end $$;
revoke all on function public._battle_finish(bigint, smallint) from public, anon, authenticated;

-- Resolve one turn from a1 and a2: the faster side first (a tie: a coin), a guard holds for the whole turn, heals
-- (+25 % of max hp) twice per battle. The battle ends at 0 hp or after 30 turns (the higher hp share wins).
create or replace function public._battle_turn(p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles; f jsonb[]; hp int[]; mx int[]; heals int[]; act text[]; grd boolean[]; ord int[];
        me int; foe int; s public.pet_skill_catalog; lg jsonb := '[]'::jsonb; v_dmg int; v_crit boolean; v_heal int;
        v_win smallint;
begin
  select * into b from public.pet_battles where id = p_id for update;
  if b.status <> 'active' or b.a1 is null or b.a2 is null then return; end if;
  f := array[b.f1, b.f2];
  hp := array[b.hp1, b.hp2];
  mx := array[(b.f1->>'hp')::int, (b.f2->>'hp')::int];
  heals := array[b.heals1::int, b.heals2::int];
  act := array[b.a1, b.a2];
  grd := array[b.a1 = 'guard', b.a2 = 'guard'];
  if (f[1]->>'spd')::int > (f[2]->>'spd')::int or ((f[1]->>'spd')::int = (f[2]->>'spd')::int and random() < 0.5) then
    ord := array[1, 2];
  else
    ord := array[2, 1];
  end if;
  foreach me in array ord loop
    foe := 3 - me;
    continue when hp[me] <= 0 or hp[foe] <= 0;
    select * into s from public.pet_skill_catalog where id = act[me];
    if s.kind = 'guard' then
      lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'guard', true);
    elsif s.kind = 'heal' then
      if heals[me] < 2 then
        v_heal := least(mx[me] - hp[me], round(mx[me] * 0.25)::int);
        hp[me] := hp[me] + v_heal; heals[me] := heals[me] + 1;
        lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'heal', v_heal);
      else
        lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'fail', true);
      end if;
    elsif random() * 100 >= s.acc then
      lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'miss', true);
    else
      v_crit := random() < 0.08;
      v_dmg := public._battle_dmg(s.power, (f[me]->>'atk')::int, (f[foe]->>'def')::int, random()::numeric, v_crit, grd[foe]);
      hp[foe] := greatest(0, hp[foe] - v_dmg);
      lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'dmg', v_dmg, 'crit', v_crit, 'guarded', grd[foe]);
    end if;
  end loop;
  update public.pet_battles set hp1 = hp[1], hp2 = hp[2], heals1 = heals[1], heals2 = heals[2], a1 = null, a2 = null,
    turn = b.turn + 1, log = lg, acted_at = now() where id = p_id;
  if hp[1] <= 0 or hp[2] <= 0 or b.turn >= public._pv2('max_turns') then
    v_win := case when hp[2] <= 0 and hp[1] > 0 then 1 when hp[1] <= 0 and hp[2] > 0 then 2
                  when hp[1]::numeric / mx[1] > hp[2]::numeric / mx[2] then 1
                  when hp[1]::numeric / mx[1] < hp[2]::numeric / mx[2] then 2 else 0 end;
    perform public._battle_finish(p_id, v_win);
  end if;
end $$;
revoke all on function public._battle_turn(bigint) from public, anon, authenticated;

-- The lazy sweep: pending challenges expire after 5 min; an active battle idle for 2 min ends — PvE as a loss, PvP won
-- by the side that picked (neither: a draw).
create or replace function public._battle_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles;
begin
  delete from public.pet_battles where status = 'pending' and created_at < now() - interval '5 minutes';
  for b in select * from public.pet_battles where status = 'active' and acted_at < now() - interval '120 seconds'
            order by id limit 20 for update skip locked loop
    perform public._battle_finish(b.id, (case when b.mode = 'pve' then 2
                                              when b.a1 is not null and b.a2 is null then 1
                                              when b.a2 is not null and b.a1 is null then 2 else 0 end)::smallint);
  end loop;
end $$;
revoke all on function public._battle_sweep() from public, anon, authenticated;

create or replace function public._battle_json(b public.pet_battles, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'side', case when b.p1 = p_viewer then 1 else 2 end,
    'npc', b.npc, 'turn', b.turn, 'f1', b.f1, 'f2', b.f2, 'hp1', b.hp1, 'hp2', b.hp2, 'log', b.log, 'stake', b.stake,
    'winner', b.winner, 'reward', b.reward,
    'p1_name', (select username from public.accounts where id = b.p1),
    'p2_name', (select username from public.accounts where id = b.p2),
    'acted', case when b.p1 = p_viewer then b.a1 is not null else b.a2 is not null end,
    'foe_acted', case when b.p1 = p_viewer then b.a2 is not null else b.a1 is not null end,
    'deadline_ms', (extract(epoch from b.acted_at + interval '120 seconds') * 1000)::bigint)
$$;
revoke all on function public._battle_json(public.pet_battles, uuid) from public, anon, authenticated;

-- Everything the battle panel shows: my running battle, the last finished one, challenges to and from me, my fish
-- fighters, the NPCs, today's counters, and (with a room) who else is there to challenge.
create or replace function public._battle_state(p_account uuid, p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'battle', (select public._battle_json(b, p_account) from public.pet_battles b
                where b.status = 'active' and (b.p1 = p_account or b.p2 = p_account) order by b.id desc limit 1),
    'last', (select public._battle_json(b, p_account) from public.pet_battles b
              where b.status = 'done' and (b.p1 = p_account or b.p2 = p_account) and b.finished_at > now() - interval '10 minutes'
              order by b.finished_at desc limit 1),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'from', a.username, 'stake', b.stake, 'fighter', b.f1) order by b.id)
                            from public.pet_battles b join public.accounts a on a.id = b.p1
                           where b.status = 'pending' and b.p2 = p_account), '[]'::jsonb),
    'outgoing', (select jsonb_build_object('id', b.id, 'to', a.username, 'stake', b.stake) from public.pet_battles b
                   join public.accounts a on a.id = b.p2 where b.status = 'pending' and b.p1 = p_account order by b.id desc limit 1),
    'fish', coalesce((select jsonb_agg(public._fish_fighter_json(f) order by f.id) from public.fish_fighters f
                       where f.account_id = p_account), '[]'::jsonb),
    'npcs', (select jsonb_agg(public._npc_snap(n) || jsonb_build_object('reward', n.reward, 'npc_kind', n.kind) order by n.sort_order)
               from public.pet_npc_catalog n),
    'wins_today', coalesce((select case when o.battle_day = public._vn_today() then o.wins_today else 0 end
                              from public.pet_owner o where o.account_id = p_account), 0),
    'battles_today', coalesce((select case when o.battle_day = public._vn_today() then o.battles_today else 0 end
                                 from public.pet_owner o where o.account_id = p_account), 0),
    'rivals', case when p_room is null then '[]'::jsonb else coalesce((
                select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.username) order by a.username)
                  from public.members m join public.accounts a on a.id = m.account_id
                 where m.room_id = p_room and m.account_id <> p_account
                   and exists (select 1 from public.members me where me.room_id = p_room and me.account_id = p_account)
                   and (exists (select 1 from public.pets pp where pp.account_id = a.id)
                        or exists (select 1 from public.fish_fighters ff where ff.account_id = a.id))), '[]'::jsonb) end,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;
revoke all on function public._battle_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.battle_state(p_session_token text, p_room_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  perform public._battle_sweep();
  return public._battle_state(v_account, p_room_id);
end $$;

create or replace function public._battle_busy(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.pet_battles where status = 'active' and (p1 = p_account or p2 = p_account)) $$;
revoke all on function public._battle_busy(uuid) from public, anon, authenticated;

-- A PvE battle against an NPC (40 a day; the first 10 wins pay the NPC's reward).
create or replace function public.battle_start_pve(p_session_token text, p_kind text, p_id bigint, p_npc text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); n public.pet_npc_catalog; o public.pet_owner;
        v_today date := public._vn_today(); v_n int; v_f jsonb; v_id bigint;
begin
  perform public._battle_sweep();
  select * into n from public.pet_npc_catalog where id = p_npc;
  if not found then raise exception 'unknown npc' using errcode = '22023'; end if;
  o := public._pet_owner_row(v_account);
  if public._battle_busy(v_account) then raise exception 'in battle' using errcode = '53400'; end if;
  v_n := case when o.battle_day = v_today then o.battles_today else 0 end;
  if v_n >= public._pv2('pve_day') then raise exception 'daily limit' using errcode = '53400'; end if;
  v_f := public._fighter_snap(v_account, p_kind, p_id);
  update public.pet_owner set battles_today = v_n + 1,
    wins_today = case when o.battle_day = v_today then o.wins_today else 0 end, battle_day = v_today
   where account_id = v_account;
  insert into public.pet_battles (mode, status, p1, f1, f2, npc, hp1, hp2)
  values ('pve', 'active', v_account, v_f, public._npc_snap(n), n.id, (v_f->>'hp')::int, n.hp) returning id into v_id;
  return public._battle_state(v_account, null);
end $$;

-- Challenge another member of my music room (stake 0–1000 xu, escrowed when they accept).
create or replace function public.battle_challenge(p_session_token text, p_room_id uuid, p_target uuid, p_kind text,
                                                   p_id bigint, p_stake integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_f jsonb; v_stake int := coalesce(p_stake, 0);
begin
  perform public._battle_sweep();
  if p_target is null or p_target = v_account then raise exception 'bad target' using errcode = '22023'; end if;
  if v_stake < 0 or v_stake > public._pv2('max_stake') then raise exception 'bad stake' using errcode = '22023'; end if;
  if p_room_id is null
     or not exists (select 1 from public.members where room_id = p_room_id and account_id = v_account)
     or not exists (select 1 from public.members where room_id = p_room_id and account_id = p_target) then
    raise exception 'not in room' using errcode = '42501';
  end if;
  perform public._pet_owner_row(v_account);
  if public._battle_busy(v_account) then raise exception 'in battle' using errcode = '53400'; end if;
  if exists (select 1 from public.pet_battles where status = 'pending' and p1 = v_account) then
    raise exception 'already challenging' using errcode = '53400';
  end if;
  if v_stake > coalesce((select coins from public.wallets where account_id = v_account), 0) then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  -- the snapshot is taken now only to check the fighter; it is taken again (and paid in no) when the battle starts
  if p_kind = 'pet' then
    if not exists (select 1 from public.pets where id = p_id and account_id = v_account) then raise exception 'not your fighter' using errcode = '42501'; end if;
  elsif p_kind = 'fish' then
    if not exists (select 1 from public.fish_fighters where id = p_id and account_id = v_account) then raise exception 'not your fighter' using errcode = '42501'; end if;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  v_f := jsonb_build_object('kind', p_kind, 'id', p_id);
  insert into public.pet_battles (mode, status, p1, p2, f1, stake) values ('pvp', 'pending', v_account, p_target, v_f, v_stake);
  return public._battle_state(v_account, p_room_id);
end $$;

-- Accept a challenge with one of my fighters: both stakes are escrowed, both fighters snapshotted, the battle starts.
create or replace function public.battle_accept(p_session_token text, p_battle bigint, p_kind text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles; v_f1 jsonb; v_f2 jsonb;
begin
  perform public._battle_sweep();
  select * into b from public.pet_battles where id = p_battle for update;
  if not found or b.status <> 'pending' or b.p2 <> v_account then raise exception 'no challenge' using errcode = '22023'; end if;
  if public._battle_busy(v_account) or public._battle_busy(b.p1) then raise exception 'in battle' using errcode = '53400'; end if;
  -- both wallets, in a fixed order
  perform public._wallet_lock(least(b.p1, b.p2));
  perform public._wallet_lock(greatest(b.p1, b.p2));
  if b.stake > coalesce((select coins from public.wallets where account_id = b.p1), 0) then
    delete from public.pet_battles where id = b.id;
    raise exception 'challenger broke' using errcode = '53400';
  end if;
  if b.stake > coalesce((select coins from public.wallets where account_id = v_account), 0) then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  v_f1 := public._fighter_snap(b.p1, b.f1->>'kind', (b.f1->>'id')::bigint);
  v_f2 := public._fighter_snap(v_account, p_kind, p_id);
  if b.stake > 0 then
    perform public._pay(b.p1, -b.stake, case v_f1->>'kind' when 'pet' then 'pet_battle' else 'fish_battle' end, 'pvp stake #' || b.id);
    perform public._pay(v_account, -b.stake, case v_f2->>'kind' when 'pet' then 'pet_battle' else 'fish_battle' end, 'pvp stake #' || b.id);
  end if;
  update public.pet_battles set status = 'active', f1 = v_f1, f2 = v_f2, hp1 = (v_f1->>'hp')::int, hp2 = (v_f2->>'hp')::int,
    acted_at = now() where id = b.id;
  return public._battle_state(v_account, null);
end $$;

-- Decline (the challenged) or withdraw (the challenger) a pending challenge.
create or replace function public.battle_decline(p_session_token text, p_battle bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  delete from public.pet_battles where id = p_battle and status = 'pending' and (p1 = v_account or p2 = v_account);
  return public._battle_state(v_account, null);
end $$;

-- Pick this turn's skill (one the fighter knows). PvE: the NPC picks at once and the turn resolves. PvP: the turn
-- resolves when both sides picked.
create or replace function public.battle_act(p_session_token text, p_battle bigint, p_skill text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles; v_side int;
begin
  perform public._battle_sweep();
  select * into b from public.pet_battles where id = p_battle for update;
  if not found or b.status <> 'active' or (b.p1 <> v_account and b.p2 is distinct from v_account) then
    raise exception 'no battle' using errcode = '22023';
  end if;
  v_side := case when b.p1 = v_account then 1 else 2 end;
  if not ((case v_side when 1 then b.f1 else b.f2 end)->'skills' ? p_skill) then
    raise exception 'unknown skill' using errcode = '22023';
  end if;
  if (case v_side when 1 then b.a1 else b.a2 end) is not null then raise exception 'already acted' using errcode = '53400'; end if;
  if b.mode = 'pve' then
    if b.acted_at > now() - interval '300 milliseconds' then raise exception 'too soon' using errcode = '53400'; end if;
    update public.pet_battles set a1 = p_skill, a2 = public._battle_ai(b.f2, b.hp2, b.heals2) where id = b.id;
  elsif v_side = 1 then
    update public.pet_battles set a1 = p_skill where id = b.id;
  else
    update public.pet_battles set a2 = p_skill where id = b.id;
  end if;
  perform public._battle_turn(b.id);
  return public._battle_state(v_account, null)
         || jsonb_build_object('battle_now', (select public._battle_json(x, v_account) from public.pet_battles x where x.id = b.id));
end $$;

-- Give up: the other side wins.
create or replace function public.battle_forfeit(p_session_token text, p_battle bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles;
begin
  select * into b from public.pet_battles where id = p_battle and status = 'active' and (p1 = v_account or p2 = v_account) for update;
  if not found then raise exception 'no battle' using errcode = '22023'; end if;
  perform public._battle_finish(b.id, (case when b.p1 = v_account then 2 else 1 end)::smallint);
  return public._battle_state(v_account, null);
end $$;

-- ---------- J. The aquarium ----------
alter table public.furniture_catalog drop constraint if exists furniture_catalog_kind_check;
alter table public.furniture_catalog add constraint furniture_catalog_kind_check
  check (kind in ('bed','table','chair','sofa','lamp','plant','rug','shelf','tv','fridge','wall','floor',
                  'aquarium','cabinet','painting'));

-- ---------- K. More furniture (#7) and the tanks (lib/game/housing/apartment.ts's FURNITURE mirrors the rows) ----------
insert into public.furniture_catalog (id, name, kind, style, w, h, price, cap) values
  ('bed_tang', 'Giường tầng', 'bed', 'go', 2, 3, 1600, 0),
  ('bed_doi', 'Giường đôi hoa', 'bed', 'hien_dai', 3, 3, 2600, 0),
  ('cabinet_go', 'Tủ áo gỗ', 'cabinet', 'go', 2, 1, 900, 0),
  ('cabinet_hiendai', 'Tủ kính', 'cabinet', 'hien_dai', 2, 1, 1100, 0),
  ('cabinet_maytre', 'Tủ mây', 'cabinet', 'may_tre', 1, 1, 500, 0),
  ('painting_sen', 'Tranh hoa sen', 'painting', 'go', 2, 1, 600, 0),
  ('painting_pho', 'Tranh phố cổ', 'painting', 'hien_dai', 2, 1, 800, 0),
  ('painting_bien', 'Tranh biển', 'painting', 'may_tre', 1, 1, 400, 0),
  ('plant_lan', 'Chậu lan', 'plant', 'hien_dai', 1, 1, 450, 0),
  ('plant_xuongrong', 'Xương rồng', 'plant', 'may_tre', 1, 1, 150, 0),
  ('plant_cau', 'Cây cau cảnh', 'plant', 'go', 1, 1, 350, 0),
  ('lamp_ban', 'Đèn bàn', 'lamp', 'hien_dai', 1, 1, 200, 0),
  ('lamp_hoian', 'Đèn lồng Hội An', 'lamp', 'go', 1, 1, 300, 0),
  ('rug_tron', 'Thảm tròn', 'rug', 'hien_dai', 2, 2, 300, 0),
  ('rug_batu', 'Thảm Ba Tư', 'rug', 'go', 4, 3, 900, 0),
  ('aquarium', 'Bể cá nhỏ', 'aquarium', 'hien_dai', 2, 1, 3000, 4),
  ('aquarium_big', 'Bể cá lớn', 'aquarium', 'hien_dai', 3, 1, 7000, 8)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, style = excluded.style, w = excluded.w,
  h = excluded.h, price = excluded.price, cap = excluded.cap;

create table if not exists public.aquarium_fish (
  id uuid primary key,                                            -- the caught fish's id
  tank bigint not null references public.furniture_items(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  price integer not null check (price > 0),
  caught_at timestamptz not null,
  placed_at timestamptz not null default now()
);
create index if not exists aquarium_fish_tank on public.aquarium_fish (tank);
alter table public.aquarium_fish enable row level security;
revoke all on public.aquarium_fish from anon, authenticated;

create table if not exists public.aquarium_tanks (
  tank bigint primary key references public.furniture_items(id) on delete cascade,
  decor text[] not null default '{}'
);
alter table public.aquarium_tanks enable row level security;
revoke all on public.aquarium_tanks from anon, authenticated;

-- My tank (an aquarium I own, placed or stored), locked. The tank's owner owns its fish.
create or replace function public._aqua_mine(p_account uuid, p_tank bigint) returns public.furniture_items
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.furniture_items;
begin
  select fi.* into f from public.furniture_items fi join public.furniture_catalog c on c.id = fi.item_id
   where fi.id = p_tank and fi.account_id = p_account and c.kind = 'aquarium' for update of fi;
  if not found then raise exception 'not your tank' using errcode = '42501'; end if;
  return f;
end $$;
revoke all on function public._aqua_mine(uuid, bigint) from public, anon, authenticated;

create or replace function public._aqua_tank_json(p_tank bigint, p_owner boolean) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('tank', p_tank, 'item', fi.item_id, 'cap', c.cap, 'placed', fi.apt_no is not null or fi.lot_no is not null,
    'decor', coalesce(to_jsonb((select t.decor from public.aquarium_tanks t where t.tank = p_tank)), '[]'::jsonb),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', case when p_owner then a.id end, 'species_id', a.species_id,
                                                          'weight_g', a.weight_g, 'rarity', s.rarity) order by a.placed_at, a.id)
                        from public.aquarium_fish a join public.fish_species s on s.id = a.species_id where a.tank = p_tank), '[]'::jsonb))
  from public.furniture_items fi join public.furniture_catalog c on c.id = fi.item_id where fi.id = p_tank
$$;
revoke all on function public._aqua_tank_json(bigint, boolean) from public, anon, authenticated;

create or replace function public._aqua_mine_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('tanks', coalesce((select jsonb_agg(public._aqua_tank_json(fi.id, true) order by fi.id)
                                               from public.furniture_items fi join public.furniture_catalog c on c.id = fi.item_id
                                              where fi.account_id = p_account and c.kind = 'aquarium'), '[]'::jsonb))
$$;
revoke all on function public._aqua_mine_json(uuid) from public, anon, authenticated;

create or replace function public.aquarium_mine(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._aqua_mine_json(public._ac_account(p_session_token));
end $$;

-- Bag → tank: the tank must be placed in a home and have a free slot. The fish keeps its id, weight and price.
create or replace function public.aquarium_put(p_session_token text, p_tank bigint, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); f public.furniture_items; r public.fish; v_cap int;
begin
  perform public._wallet_lock(v_account);                          -- the account's lock for bag moves
  f := public._aqua_mine(v_account, p_tank);
  if f.apt_no is null and f.lot_no is null then raise exception 'not placed' using errcode = '53400'; end if;
  select cap into v_cap from public.furniture_catalog where id = f.item_id;
  if (select count(*) from public.aquarium_fish where tank = f.id) >= v_cap then raise exception 'tank full' using errcode = '53400'; end if;
  delete from public.fish where id = p_fish_id and account_id = v_account returning * into r;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  insert into public.aquarium_fish (id, tank, species_id, weight_g, price, caught_at)
  values (r.id, f.id, r.species_id, r.weight_g, r.price, r.caught_at);
  perform public._game_event(v_account, 'aquarium_add', 1, jsonb_build_object('species', r.species_id));
  return public._aqua_mine_json(v_account);
end $$;

-- Tank → bag: a free place in the bag (1 + the bucket, as when catching).
create or replace function public.aquarium_take(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); a public.aquarium_fish;
begin
  perform public._wallet_lock(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    raise exception 'bag full' using errcode = '53400';
  end if;
  delete from public.aquarium_fish af using public.furniture_items fi
   where af.id = p_fish_id and fi.id = af.tank and fi.account_id = v_account
  returning af.* into a;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  insert into public.fish (id, account_id, species_id, weight_g, price, caught_at)
  values (a.id, v_account, a.species_id, a.weight_g, a.price, a.caught_at);
  return public._aqua_mine_json(v_account);
end $$;

-- Buy a decoration into a tank (at most 4, each once), or remove one (no refund).
create or replace function public.aquarium_decor(p_session_token text, p_tank bigint, p_decor text, p_add boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); f public.furniture_items; v_price int; v_has text[]; v_coins int; v_bal int;
begin
  v_price := public._aqua_decor_price(p_decor);
  if v_price is null then raise exception 'unknown decor' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  f := public._aqua_mine(v_account, p_tank);
  insert into public.aquarium_tanks (tank) values (f.id) on conflict (tank) do nothing;
  select decor into v_has from public.aquarium_tanks where tank = f.id for update;
  if coalesce(p_add, true) then
    if p_decor = any(v_has) then raise exception 'already owned' using errcode = '22023'; end if;
    if coalesce(array_length(v_has, 1), 0) >= public._pv2('max_decor') then raise exception 'too many' using errcode = '53400'; end if;
    select coins into v_coins from public.wallets where account_id = v_account;
    if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
    v_bal := public._pay(v_account, -v_price, 'aquarium', 'decor ' || p_decor);
    update public.aquarium_tanks set decor = decor || p_decor where tank = f.id;
  else
    update public.aquarium_tanks set decor = array_remove(decor, p_decor) where tank = f.id;
  end if;
  return public._aqua_mine_json(v_account) || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end;
end $$;

-- A home's tanks as seen by anyone who may enter it (the rare fish showcase): 'apt' + unit, or 'house' + lot.
create or replace function public.aquarium_view(p_session_token text, p_room_id uuid, p_kind text, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if p_kind = 'apt' then
    if not public._apt_can_enter(v_account, p_room_id, p_no::smallint) then raise exception 'no access' using errcode = '42501'; end if;
  elsif p_kind = 'house' then
    if not public._house_can_enter(v_account, p_room_id, p_no::smallint) then raise exception 'no access' using errcode = '42501'; end if;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'tanks', coalesce((select jsonb_agg(public._aqua_tank_json(fi.id, fi.account_id = v_account) order by fi.id)
                         from public.furniture_items fi join public.furniture_catalog c on c.id = fi.item_id
                        where c.kind = 'aquarium'
                          and ((p_kind = 'apt' and fi.apt_no = p_no) or (p_kind = 'house' and fi.lot_no = p_no))), '[]'::jsonb),
    'showcase', coalesce((select jsonb_agg(x.j order by x.r desc, x.w desc) from (
                  select jsonb_build_object('species_id', a.species_id, 'weight_g', a.weight_g, 'rarity', s.rarity) j, s.rarity r, a.weight_g w
                    from public.aquarium_fish a join public.furniture_items fi on fi.id = a.tank
                    join public.fish_species s on s.id = a.species_id
                   where s.rarity >= 3 and ((p_kind = 'apt' and fi.apt_no = p_no) or (p_kind = 'house' and fi.lot_no = p_no))
                   order by s.rarity desc, a.weight_g desc limit 5) x), '[]'::jsonb));
end $$;

-- ---------- K. Houses: knock → admit (as the apartments) ----------
create table if not exists public.house_knocks (
  lot_no smallint not null references public.house_lots(no),
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (lot_no, account_id)
);
alter table public.house_knocks enable row level security;
revoke all on public.house_knocks from anon, authenticated;
create table if not exists public.house_guests (
  lot_no smallint not null references public.house_lots(no),
  account_id uuid not null references public.accounts(id) on delete cascade,
  until timestamptz not null,
  primary key (lot_no, account_id)
);
alter table public.house_guests enable row level security;
revoke all on public.house_guests from anon, authenticated;

-- 0042's _house_can_enter, verbatim but for the line marked 0074 (a guest let in after a knock).
create or replace function public._house_can_enter(p_account uuid, p_room uuid, p_lot smallint) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.house_lots l
     where l.no = p_lot and l.owner_id is not null and l.grid is not null
       and (l.owner_id = p_account or l.visibility = 'open'
            or exists (select 1 from public.house_tenancies t where t.lot_no = l.no and t.tenant_id = p_account and t.paid_until > now())
            or exists (select 1 from public.house_guests g where g.lot_no = l.no and g.account_id = p_account and g.until > now())   -- 0074
            or (l.visibility = 'room'
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = l.owner_id)
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = p_account))))
$$;
revoke all on function public._house_can_enter(uuid, uuid, smallint) from public, anon, authenticated;

create or replace function public._house_knocks_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('knocks', coalesce((select jsonb_agg(jsonb_build_object('account_id', k.account_id, 'name', a.username,
                                                  'at_ms', public._apt_ms(k.at)) order by k.at)
                                                from public.house_knocks k join public.house_lots l on l.no = k.lot_no
                                                join public.accounts a on a.id = k.account_id
                                               where l.owner_id = p_account and k.at > now() - interval '10 minutes'), '[]'::jsonb),
    'guests', coalesce((select jsonb_agg(jsonb_build_object('account_id', g.account_id, 'name', a.username,
                          'until_ms', public._apt_ms(g.until)) order by g.until)
                        from public.house_guests g join public.house_lots l on l.no = g.lot_no
                        join public.accounts a on a.id = g.account_id
                       where l.owner_id = p_account and g.until > now()), '[]'::jsonb))
$$;
revoke all on function public._house_knocks_json(uuid) from public, anon, authenticated;

-- Knock on lot p_lot's door: the owner sees it for 10 minutes. True (I may already enter, or the knock is in).
create or replace function public.house_knock(p_session_token text, p_room_id uuid, p_lot integer) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if not exists (select 1 from public.house_lots where no = p_lot and owner_id is not null and grid is not null) then
    raise exception 'vacant' using errcode = '53400';
  end if;
  if public._house_can_enter(v_account, p_room_id, p_lot::smallint) then return true; end if;
  insert into public.house_knocks (lot_no, account_id, at) values (p_lot, v_account, now())
  on conflict (lot_no, account_id) do update set at = now();
  return true;
end $$;

create or replace function public.house_knocks(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._house_knocks_json(public._ac_account(p_session_token));
end $$;

-- The owner answers a knock (or revokes a pass): yes lets them in for 3 h, no clears the knock and any pass.
create or replace function public.house_admit(p_session_token text, p_account uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_lot smallint;
begin
  select no into v_lot from public.house_lots where owner_id = v_account;
  if v_lot is null then raise exception 'no home' using errcode = '53400'; end if;
  delete from public.house_knocks where lot_no = v_lot and account_id = p_account;
  if coalesce(p_accept, false) and p_account <> v_account then
    insert into public.house_guests (lot_no, account_id, until) values (v_lot, p_account, now() + interval '3 hours')
    on conflict (lot_no, account_id) do update set until = excluded.until;
  else
    delete from public.house_guests where lot_no = v_lot and account_id = p_account;
  end if;
  return public._house_knocks_json(v_account);
end $$;

-- ---------- L. A wipe ----------
create or replace function public._pets_v2_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.pet_battles where p1 = new.account_id or p2 = new.account_id;
  delete from public.fish_fighters where account_id = new.account_id;
  return null;
end $$;
revoke all on function public._pets_v2_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_pets_v2 on public.anticheat_wipes;
create trigger anticheat_wipes_pets_v2 after insert on public.anticheat_wipes for each row execute function public._pets_v2_wipe();

-- ---------- Grants ----------
revoke all on function public.pet_gacha_roll(text) from public;
revoke all on function public.pet_release(text, bigint) from public;
revoke all on function public.pet_pat(text, bigint) from public;
revoke all on function public.pet_feed(text, bigint) from public;
revoke all on function public.pet_play(text, bigint) from public;
revoke all on function public.pet_evolve(text, bigint) from public;
revoke all on function public.fish_to_fighter(text, uuid) from public;
revoke all on function public.fish_fighter_release(text, bigint) from public;
revoke all on function public.fighter_train(text, text, bigint, text) from public;
revoke all on function public.fighter_learn(text, text, bigint, text) from public;
revoke all on function public.battle_state(text, uuid) from public;
revoke all on function public.battle_start_pve(text, text, bigint, text) from public;
revoke all on function public.battle_challenge(text, uuid, uuid, text, bigint, integer) from public;
revoke all on function public.battle_accept(text, bigint, text, bigint) from public;
revoke all on function public.battle_decline(text, bigint) from public;
revoke all on function public.battle_act(text, bigint, text) from public;
revoke all on function public.battle_forfeit(text, bigint) from public;
revoke all on function public.aquarium_mine(text) from public;
revoke all on function public.aquarium_put(text, bigint, uuid) from public;
revoke all on function public.aquarium_take(text, uuid) from public;
revoke all on function public.aquarium_decor(text, bigint, text, boolean) from public;
revoke all on function public.aquarium_view(text, uuid, text, integer) from public;
revoke all on function public.house_knock(text, uuid, integer) from public;
revoke all on function public.house_knocks(text) from public;
revoke all on function public.house_admit(text, uuid, boolean) from public;
grant execute on function public.pet_gacha_roll(text) to anon, authenticated;
grant execute on function public.pet_release(text, bigint) to anon, authenticated;
grant execute on function public.pet_pat(text, bigint) to anon, authenticated;
grant execute on function public.pet_feed(text, bigint) to anon, authenticated;
grant execute on function public.pet_play(text, bigint) to anon, authenticated;
grant execute on function public.pet_evolve(text, bigint) to anon, authenticated;
grant execute on function public.fish_to_fighter(text, uuid) to anon, authenticated;
grant execute on function public.fish_fighter_release(text, bigint) to anon, authenticated;
grant execute on function public.fighter_train(text, text, bigint, text) to anon, authenticated;
grant execute on function public.fighter_learn(text, text, bigint, text) to anon, authenticated;
grant execute on function public.battle_state(text, uuid) to anon, authenticated;
grant execute on function public.battle_start_pve(text, text, bigint, text) to anon, authenticated;
grant execute on function public.battle_challenge(text, uuid, uuid, text, bigint, integer) to anon, authenticated;
grant execute on function public.battle_accept(text, bigint, text, bigint) to anon, authenticated;
grant execute on function public.battle_decline(text, bigint) to anon, authenticated;
grant execute on function public.battle_act(text, bigint, text) to anon, authenticated;
grant execute on function public.battle_forfeit(text, bigint) to anon, authenticated;
grant execute on function public.aquarium_mine(text) to anon, authenticated;
grant execute on function public.aquarium_put(text, bigint, uuid) to anon, authenticated;
grant execute on function public.aquarium_take(text, uuid) to anon, authenticated;
grant execute on function public.aquarium_decor(text, bigint, text, boolean) to anon, authenticated;
grant execute on function public.aquarium_view(text, uuid, text, integer) to anon, authenticated;
grant execute on function public.house_knock(text, uuid, integer) to anon, authenticated;
grant execute on function public.house_knocks(text) to anon, authenticated;
grant execute on function public.house_admit(text, uuid, boolean) to anon, authenticated;
