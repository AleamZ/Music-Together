-- =========================================================
-- 0084_craft_minigames.sql — v22 crafting minigames (.superpowers/v22-common.md, group "crafting"). ADDITIVE and
-- re-runnable. Run after 0082. Three instant v21 actions become short server-replayed minigames (the 0072 dig pattern:
-- *_start rolls a secret seed and stores a pending round; *_finish takes only the inputs, replays them, flags bad input /
-- mismatch / too fast (hard) and machine-regular timing (soft, the 5th in 24 h hard), then does the old action). The
-- result only moves the outcome inside the old bounds:
--   A. bà Sáu's cauldron — brew_start / brew_finish (were brew_potion): keep the heat in the green band for 10 s
--      (_brew_replay ≡ lib/game/craftmg/games.ts replayBrew). Quality 1 Thường / 2 Tốt / 3 Hoàn hảo from the ticks in the
--      band (≥ 270 / ≥ 420 of 600); a Tốt / Hoàn hảo potion's hunger/thirst points or buff duration are +5 / +10 %
--      when drunk (potion_quality counts how many of the bag's potions have that tier; drink_potion takes the best).
--      Ingredients and the fee are taken at the finish (nothing is spent by a round given up). Stamina 2.
--   B. The anvil — upgrade_start / upgrade_finish (were upgrade_item): 5 hammer strikes timed to the glow's peak
--      (_anvil_replay); score 0–10 → the server-rolled success chance ± (score − 5) × 20 ‰ (−10 … +10 pp). Cost taken
--      at the finish, as before. Stamina 3.
--   C. Máy chế biến (0076) — process_sort_start / process_sort_finish (were process_collect): sort 12 grains into the
--      good / bad baskets (_sort_replay); ≥ 8 right → +2 %, ≥ 11 → +5 % of the batches' value paid at once (ledger
--      'produce_sell', ref 'sort bonus …'); the goods themselves are unchanged. Stamina 2.
--   The old RPCs brew_potion / upgrade_item / process_collect now refuse with 'outdated' (the client uses the new ones).
--   Cooking: restaurant meals are purchases (no crafted food exists), so no cooking minigame. Sprinkler: client-side
--   animation only.
-- Re-created (own group's v21 functions): _mine_state (0072's, verbatim + 'quality'), drink_potion (0072's, verbatim
-- but for the lines marked 0084). brew_potion / upgrade_item (0078's newest) and process_collect (0076's) are replaced by
-- 'outdated' stubs; their bodies live on in the *_finish RPCs.
-- Events emitted (same kinds as before): 'potion_brewed' (meta + quality), 'item_upgraded' (meta + score, nudge),
-- 'crop_processed' (meta + sort score), 'xp_grant'. ac_play_stats games 'brew', 'anvil', 'sort'.
-- Anti-cheat codes: brew_/anvil_/sort_ bad_input, mismatch, too_fast (hard); *_timing (soft), *_timing_repeat (hard).
-- =========================================================

-- ---------- Tables ----------
create table if not exists public.craft_rounds (
  account_id uuid not null references public.accounts(id) on delete cascade,
  game text not null check (game in ('brew', 'anvil', 'sort')),
  seed bigint not null,
  meta jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  primary key (account_id, game)
);
create table if not exists public.potion_quality (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.craft_items(id),
  tier smallint not null check (tier between 2 and 3),
  qty integer not null default 0 check (qty >= 0),
  primary key (account_id, item_id, tier)
);
alter table public.craft_rounds enable row level security;
alter table public.potion_quality enable row level security;
revoke all on public.craft_rounds, public.potion_quality from anon, authenticated;

-- ---------- The sims (lib/game/craftmg/games.ts, statement for statement) ----------
-- brew: [band centre 400 + u mod 201, drift of the 20 segments u mod 7 − 3]
create or replace function public._brew_round(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[];
begin
  r := public._reel_rand(st);
  st := r[2];
  o := array[(400 + r[1] % 201)::integer];
  for i in 1 .. 20 loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || ((r[1] % 7) - 3)::integer;
  end loop;
  return o;
end $$;

-- The ticks (of 600) the heat spends within 120 of the centre; it starts at 200, the fan +7 a tick, else −4, + drift.
create or replace function public._brew_replay(p_seed bigint, p_toggles integer[]) returns integer
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._brew_round(p_seed); h integer := 200; fan boolean := false; k integer := 1;
        n integer := coalesce(cardinality(p_toggles), 0); score integer := 0;
begin
  for t in 0 .. 599 loop
    if k <= n and p_toggles[k] = t then fan := not fan; k := k + 1; end if;
    h := least(1000, greatest(0, h + case when fan then 7 else -4 end + rd[2 + t / 30]));
    if abs(h - rd[1]) <= 120 then score := score + 1; end if;
  end loop;
  return score;
end $$;

create or replace function public._brew_quality(p_score integer) returns integer
language sql immutable parallel safe
as $$ select case when p_score >= 420 then 3 when p_score >= 270 then 2 else 1 end $$;
create or replace function public._brew_bonus(p_tier integer) returns integer
language sql immutable parallel safe
as $$ select case p_tier when 3 then 10 when 2 then 5 else 0 end $$;

-- anvil: [period 50 + u mod 31, phase u mod period]; the glow is _mine_pos(period, t + phase).
create or replace function public._anvil_round(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; p integer;
begin
  r := public._reel_rand(st);
  st := r[2];
  p := (50 + r[1] % 31)::integer;
  r := public._reel_rand(st);
  return array[p, (r[1] % p)::integer];
end $$;

-- {score (2 a strike with glow ≥ 880, 1 with ≥ 700), ticks (the 5th strike + 1, else 1800), exact (on the best tick)}
create or replace function public._anvil_replay(p_seed bigint, p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._anvil_round(p_seed); tol integer; g integer; s integer; score integer := 0; exact integer := 0;
        n integer := coalesce(cardinality(p_strikes), 0);
begin
  tol := 1000 - ceil(2000.0 / rd[1])::integer;
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    g := public._mine_pos(rd[1], s + rd[2]);
    score := score + case when g >= 880 then 2 when g >= 700 then 1 else 0 end;
    if g >= tol then exact := exact + 1; end if;
  end loop;
  return jsonb_build_object('score', score, 'ticks', case when n >= 5 then p_strikes[5] + 1 else 1800 end, 'exact', exact);
end $$;

create or replace function public._anvil_nudge(p_score integer) returns integer
language sql immutable parallel safe
as $$ select case when p_score > 10 then 100 when p_score < 0 then -100 else (p_score - 5) * 20 end $$;

-- sort: 12 grains, 1 (bad) when u mod 3 = 0; grain i (0-based) in reach for 40 ticks from 40 + 45 i.
create or replace function public._sort_round(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}';
begin
  for i in 1 .. 12 loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || case when r[1] % 3 = 0 then 1 else 0 end;
  end loop;
  return o;
end $$;

-- {score, rmin, rmax (the right sorts' reaction ticks)}: an input decides the grain in reach if it is undecided.
create or replace function public._sort_replay(p_seed bigint, p_ticks integer[], p_dirs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare kinds integer[] := public._sort_round(p_seed); done boolean[] := array_fill(false, array[12]); t integer; i integer;
        score integer := 0; rmin integer; rmax integer; re integer;
begin
  for k in 1 .. coalesce(cardinality(p_ticks), 0) loop
    t := p_ticks[k];
    continue when t < 40;
    i := (t - 40) / 45;
    continue when i >= 12 or t - (40 + 45 * i) >= 40 or done[i + 1];
    done[i + 1] := true;
    if p_dirs[k] = kinds[i + 1] then
      score := score + 1;
      re := t - (40 + 45 * i);
      rmin := least(coalesce(rmin, re), re);
      rmax := greatest(coalesce(rmax, re), re);
    end if;
  end loop;
  return jsonb_build_object('score', score, 'rmin', rmin, 'rmax', rmax);
end $$;

create or replace function public._sort_bonus(p_score integer) returns integer
language sql immutable parallel safe
as $$ select case when p_score >= 11 then 5 when p_score >= 8 then 2 else 0 end $$;

create or replace function public._sort_input_error(p_ticks integer[], p_dirs integer[]) returns text
language plpgsql immutable parallel safe
as $$
begin
  if coalesce(cardinality(p_dirs), 0) <> coalesce(cardinality(p_ticks), 0) then return 'shape'; end if;
  if exists (select 1 from unnest(p_dirs) d where d is null or d not in (0, 1)) then return 'dir'; end if;
  return public._toggles_error(p_ticks, 580, 580, 24, 4);
end $$;

-- A list whose gaps are all within 1 tick of each other over ≥ p_min entries (a metronome, not a hand).
create or replace function public._craft_regular(p_list integer[], p_min integer) returns boolean
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_list), 0); lo integer; hi integer; d integer;
begin
  if n < p_min then return false; end if;
  for i in 2 .. n loop
    d := p_list[i] - p_list[i - 1];
    lo := least(coalesce(lo, d), d);
    hi := greatest(coalesce(hi, d), d);
  end loop;
  return hi - lo <= 1;
end $$;

-- The soft timing flag, and the hard code when it is the 5th in 24 h.
create or replace function public._craft_timing(p_account uuid, p_code text, p_rpc text, p_ev jsonb) returns text
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_flag(p_account, p_code, p_rpc, p_ev, null, null, false);
  if (select count(*) from public.anticheat_events e
       where e.account_id = p_account and e.code = p_code and e.created_at > now() - interval '24 hours') >= 5 then
    return p_code || '_repeat';
  end if;
  return null;
end $$;

revoke all on function public._brew_round(bigint) from public, anon, authenticated;
revoke all on function public._brew_replay(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._brew_quality(integer) from public, anon, authenticated;
revoke all on function public._brew_bonus(integer) from public, anon, authenticated;
revoke all on function public._anvil_round(bigint) from public, anon, authenticated;
revoke all on function public._anvil_replay(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._anvil_nudge(integer) from public, anon, authenticated;
revoke all on function public._sort_round(bigint) from public, anon, authenticated;
revoke all on function public._sort_replay(bigint, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._sort_bonus(integer) from public, anon, authenticated;
revoke all on function public._sort_input_error(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._craft_regular(integer[], integer) from public, anon, authenticated;
revoke all on function public._craft_timing(uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------- The state ----------
-- _mine_state (0072_mining_crafting.sql's, verbatim but for the line marked 0084)
create or replace function public._mine_state(p_room uuid, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', now(),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'nodes', case when p_room is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('no', n.node_no, 'item', n.item_id, 'ready_at', n.ready_at) order by n.node_no)
        from public.mine_nodes n where n.room_id = p_room), '[]'::jsonb) end,
    'bag', coalesce((select jsonb_object_agg(b.item_id, b.qty) from public.craft_bag b
                      where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'fish', (select count(*) from public.fish f where f.account_id = p_account),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('id', t.tool_id, 'durability', t.durability,
                                                           'max', public._upgrade_max(k.durability, public._upgrade_level(p_account, t.tool_id)),
                                                           'level', public._upgrade_level(p_account, t.tool_id)) order by k.tier)
                         from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
                        where t.account_id = p_account), '[]'::jsonb),
    'gear', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'price', s.price,
                                                          'durability', i.durability,
                                                          'max', public._upgrade_max(s.durability, public._upgrade_level(p_account, s.id)),
                                                          'level', public._upgrade_level(p_account, s.id)) order by s.kind, s.sort_order)
                        from public.shop_items s
                        left join public.inventory i on i.item_id = s.id and i.account_id = p_account and i.qty >= 1
                       where s.kind in ('rod', 'net') and (i.account_id is not null or s.starter)), '[]'::jsonb),
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'power', b.power, 'until', b.until))
                         from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'dig', (select jsonb_build_object('node', d.node_no, 'item', d.item_id, 'tool', d.tool_id, 'seed', d.seed, 'need', d.need,
                                      'win', d.win, 'started_at', d.started_at)
              from public.mine_digs d where d.account_id = p_account and (p_room is null or d.room_id = p_room)),
    'quality', coalesce((select jsonb_agg(jsonb_build_object('item', q.item_id, 'tier', q.tier, 'qty', q.qty) order by q.item_id, q.tier)
                           from public.potion_quality q where q.account_id = p_account and q.qty > 0), '[]'::jsonb))   -- 0084
$$;
revoke all on function public._mine_state(uuid, uuid) from public, anon, authenticated;

-- The pending round of a game, taken (single use); null when there is none.
create or replace function public._craft_take(p_account uuid, p_game text) returns public.craft_rounds
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.craft_rounds;
begin
  delete from public.craft_rounds where account_id = p_account and game = p_game returning * into c;
  if not found then raise exception 'round not found' using errcode = '22023'; end if;
  return c;
end $$;
revoke all on function public._craft_take(uuid, text) from public, anon, authenticated;

-- ---------- A. bà Sáu's cauldron ----------
-- Start a brew: at the cauldron, the recipe's ingredients and fee there (checked, not taken), one start a second.
create or replace function public.brew_start(p_session_token text, p_recipe text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        r public.potion_recipes; w public.wallets; mp public.mining_profiles; e record; v_need integer;
        v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_start', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into r from public.potion_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 5 then
    return public._ac_flag(v_account, 'bad_qty', 'brew_start', jsonb_build_object('recipe', left(p_recipe, 32), 'qty', p_qty), null,
                           'invalid quantity', false);
  end if;
  w := public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  if w.coins < r.fee * p_qty then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  delete from public.craft_rounds where account_id = v_account and game = 'brew';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'brew', v_seed, jsonb_build_object('recipe', r.id, 'qty', p_qty));
  return jsonb_build_object('round', jsonb_build_object('game', 'brew', 'seed', v_seed, 'recipe', r.id, 'qty', p_qty, 'started_at', now()),
                            'state', public._mine_state(null, v_account));
end $$;

-- The brew's end: the fan's press/release ticks and the claimed score. Replayed; then 0078's brew_potion body (take,
-- pay, add) with the quality.
create or replace function public.brew_finish(p_session_token text, p_toggles integer[], p_score integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        c public.craft_rounds; r public.potion_recipes; it public.craft_items; w public.wallets; e record; v_need integer;
        v_fee integer; v_rows integer; v_qty integer; v_rep integer; v_code text; v_ev jsonb; v_bad text; v_q integer;
        v_regular boolean;
begin
  c := public._craft_take(v_account, 'brew');
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_finish', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'n', coalesce(cardinality(p_toggles), 0), 'toggles', to_jsonb(p_toggles[1:40]));
  v_bad := coalesce(public._toggles_error(p_toggles, 600, 600, 120, 10), case when p_score is null then 'score' end);
  if v_bad is not null then
    v_code := 'brew_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._brew_replay(c.seed, p_toggles);
    if v_rep <> p_score then
      v_code := 'brew_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', c.seed, 'replay', v_rep);
    elsif now() < c.started_at + interval '9 seconds' then
      v_code := 'brew_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    else
      v_regular := public._craft_regular(p_toggles, 10);
      perform public._ac_stat(v_account, 'brew', 1, case when public._brew_quality(v_rep) = 3 then 1 else 0 end,
                              case when v_regular then 1 else 0 end);
      if v_regular then v_code := public._craft_timing(v_account, 'brew_timing', 'brew_finish', v_ev); end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'brew_finish', v_ev, null, 'invalid brew');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's brew_potion from here (the recipe and quantity of the start)
  select * into r from public.potion_recipes where id = c.meta->>'recipe';
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = r.id;
  v_qty := (c.meta->>'qty')::int;
  w := public._wallet_lock(v_account);
  v_fee := r.fee * v_qty;
  if w.coins < v_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._stamina_spend(v_account, 2);
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      delete from public.fish where id in (select id from public.fish where account_id = v_account
                                            order by price, caught_at limit v_need);
      get diagnostics v_rows = row_count;
      if v_rows < v_need then raise exception 'not enough items' using errcode = '22023'; end if;
    else
      if not public._bag_take(v_account, e.key, v_need) then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_fee > 0 then perform public._pay(v_account, -v_fee, 'potion', r.id || ' x' || v_qty); end if;
  perform public._bag_add(v_account, r.id, v_qty);
  v_q := public._brew_quality(v_rep);
  if v_q >= 2 then
    insert into public.potion_quality (account_id, item_id, tier, qty) values (v_account, r.id, v_q, v_qty)
    on conflict (account_id, item_id, tier) do update set qty = public.potion_quality.qty + excluded.qty;
  end if;
  perform public._game_event(v_account, 'potion_brewed', v_qty,
                             jsonb_build_object('potion', r.id, 'rarity', it.rarity, 'quality', v_q, 'score', v_rep));
  perform public._game_event(v_account, 'xp_grant', 3 * it.rarity * v_qty, '{"source":"alchemy"}'::jsonb);
  return jsonb_build_object('result', 'brewed',
                            'brewed', jsonb_build_object('potion', r.id, 'qty', v_qty, 'quality', v_q, 'score', v_rep,
                                                         'bonus', public._brew_bonus(v_q)),
                            'state', public._mine_state(null, v_account));
end $$;

-- drink_potion (0072_mining_crafting.sql's, verbatim but for the lines marked 0084): the best tier first.
create or replace function public.drink_potion(p_session_token text, p_potion text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.potion_recipes; mp public.mining_profiles;
        v public.vitals; v_vit jsonb;
        v_q integer; v_pct integer := 0; v_amount integer; v_dur integer;                           -- 0084
begin
  select * into r from public.potion_recipes where id = p_potion;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  v := public._vitals_apply(v_account);
  if v.fainted_until is not null then raise exception 'fainted' using errcode = '53400'; end if;
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  if not public._bag_take(v_account, r.id, 1) then raise exception 'not enough items' using errcode = '22023'; end if;
  -- 0084 {
  select tier into v_q from public.potion_quality
   where account_id = v_account and item_id = r.id and qty > 0 order by tier desc limit 1 for update;
  if v_q is not null then
    update public.potion_quality set qty = qty - 1 where account_id = v_account and item_id = r.id and tier = v_q;
    v_pct := public._brew_bonus(v_q);
  end if;
  update public.potion_quality q
     set qty = least(q.qty, coalesce((select b.qty from public.craft_bag b where b.account_id = v_account and b.item_id = r.id), 0))
   where q.account_id = v_account and q.item_id = r.id;
  v_amount := (r.amount * (100 + v_pct)) / 100;
  v_dur := (r.duration_s * (100 + v_pct)) / 100;
  -- 0084 }
  if r.effect in ('hunger', 'thirst', 'vitals') then
    update public.vitals
       set hunger = case when r.effect in ('hunger', 'vitals') then least(100, hunger + v_amount) else hunger end,   -- 0084
           thirst = case when r.effect in ('thirst', 'vitals') then least(100, thirst + v_amount) else thirst end    -- 0084
     where account_id = v_account returning * into v;
  elsif r.effect = 'cure' then
    update public.rain_state set cold_until = null, cold_wet_s = 0 where account_id = v_account;
    update public.heat_state set shocked = false, outdoor_since = null where account_id = v_account;
  else
    insert into public.player_buffs (account_id, kind, power, until)
    values (v_account, r.effect, r.amount, now() + make_interval(secs => v_dur))                    -- 0084
    on conflict (account_id, kind) do update
      set power = case when public.player_buffs.until > now() then greatest(public.player_buffs.power, excluded.power)
                       else excluded.power end,
          until = greatest(public.player_buffs.until, excluded.until);
  end if;
  v_vit := public._vitals_json(v);
  perform public._game_event(v_account, 'potion_drunk', 1, jsonb_build_object('potion', r.id, 'effect', r.effect,
                                                                              'quality', coalesce(v_q, 1)));  -- 0084
  return jsonb_build_object('effect', r.effect, 'quality', coalesce(v_q, 1), 'vitals', v_vit,                  -- 0084
                            'state', public._mine_state(null, v_account));
end $$;

-- ---------- B. The anvil ----------
-- The item, its level, cost and base chance (0078's upgrade_item checks); raises as it did.
create or replace function public._upgrade_plan(p_account uuid, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; v_kind text; v_price integer; v_base integer; v_level integer; v_cost integer; v_mats jsonb; e record;
begin
  select * into w from public.wallets where account_id = p_account;
  if exists (select 1 from public.mine_tools where account_id = p_account and tool_id = p_item) then
    select 'pickaxe', price, durability into v_kind, v_price, v_base from public.pickaxe_kinds where id = p_item;
  elsif exists (select 1 from public.shop_items where id = p_item and kind in ('rod', 'net')) and public._owns(p_account, p_item) then
    select kind, price, durability into v_kind, v_price, v_base from public.shop_items where id = p_item;
  else
    raise exception 'item not available' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(p_account, p_item);
  if v_level >= 5 then raise exception 'max level' using errcode = '22023'; end if;
  v_cost := public._upgrade_coins(v_price, v_level);
  v_mats := public._upgrade_mats(v_level);
  if coalesce(w.coins, 0) < v_cost then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(v_mats) loop
    if coalesce((select qty from public.craft_bag where account_id = p_account and item_id = e.key), 0) < e.q then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('kind', v_kind, 'base', v_base, 'level', v_level, 'cost', v_cost, 'mats', v_mats,
                            'chance', public._upgrade_chance(v_level));
end $$;
revoke all on function public._upgrade_plan(uuid, text) from public, anon, authenticated;

create or replace function public.upgrade_start(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        mp public.mining_profiles; v_plan jsonb; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_start', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  v_plan := public._upgrade_plan(v_account, p_item);
  delete from public.craft_rounds where account_id = v_account and game = 'anvil';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'anvil', v_seed, jsonb_build_object('item', p_item, 'level', v_plan->'level'));
  return jsonb_build_object('round', jsonb_build_object('game', 'anvil', 'seed', v_seed, 'item', p_item, 'level', v_plan->'level',
                                                        'chance', v_plan->'chance', 'started_at', now()),
                            'state', public._mine_state(null, v_account));
end $$;

-- The hammering's end: the strike ticks, the end tick and the claimed score; then 0078's upgrade_item body with the
-- chance nudged by (score − 5) × 20 ‰.
create or replace function public.upgrade_finish(p_session_token text, p_strikes integer[], p_ticks integer, p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        c public.craft_rounds; v_plan jsonb; v_item text; v_kind text; v_base integer; v_level integer; v_cost integer;
        e record; v_ok boolean; v_rep jsonb; v_code text; v_ev jsonb; v_bad text; v_nudge integer; v_chance integer;
        v_n integer := coalesce(cardinality(p_strikes), 0);
begin
  c := public._craft_take(v_account, 'anvil');
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_finish', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'ticks', p_ticks, 'strikes', to_jsonb(p_strikes[1:5]));
  v_bad := coalesce(public._toggles_error(p_strikes, p_ticks, 1800, 5, 2), case when p_score is null then 'score' end);
  if v_bad is not null then
    v_code := 'anvil_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._anvil_replay(c.seed, p_strikes);
    if (v_rep->>'score')::int <> p_score or (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'anvil_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', c.seed, 'replay', v_rep);
    elsif now() < c.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'anvil_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    else
      perform public._ac_stat(v_account, 'anvil', 1, case when p_score = 10 then 1 else 0 end,
                              case when v_n = 5 and (v_rep->>'exact')::int = 5 then 1 else 0 end);
      if v_n = 5 and (v_rep->>'exact')::int = 5 then
        v_code := public._craft_timing(v_account, 'anvil_timing', 'upgrade_finish', v_ev || jsonb_build_object('replay', v_rep));
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'upgrade_finish', v_ev, null, 'invalid upgrade');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's upgrade_item from here
  v_item := c.meta->>'item';
  perform public._wallet_lock(v_account);
  v_plan := public._upgrade_plan(v_account, v_item);
  v_kind := v_plan->>'kind';
  v_base := (v_plan->>'base')::int;
  v_level := (v_plan->>'level')::int;
  v_cost := (v_plan->>'cost')::int;
  perform public._stamina_spend(v_account, 3);
  for e in select key, value::int as q from jsonb_each_text(v_plan->'mats') loop
    if not public._bag_take(v_account, e.key, e.q) then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._pay(v_account, -v_cost, 'upgrade', v_item || ' +' || (v_level + 1));
  v_nudge := public._anvil_nudge(p_score);
  v_chance := least(1000, greatest(0, public._upgrade_chance(v_level) + v_nudge));
  v_ok := floor(random() * 1000) < v_chance;
  if v_ok then
    insert into public.item_upgrades (account_id, item_id, level) values (v_account, v_item, v_level + 1)
    on conflict (account_id, item_id) do update set level = excluded.level;
    if v_kind = 'pickaxe' then
      update public.mine_tools set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and tool_id = v_item;
    elsif v_base is not null then
      update public.inventory set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and item_id = v_item and durability is not null;
    end if;
    perform public._game_event(v_account, 'xp_grant', 5 * (v_level + 1), '{"source":"upgrade"}'::jsonb);
  end if;
  perform public._game_event(v_account, 'item_upgraded', case when v_ok then v_level + 1 else v_level end,
                             jsonb_build_object('item', v_item, 'ok', v_ok, 'from', v_level, 'score', p_score, 'nudge', v_nudge));
  return jsonb_build_object('result', 'done',
                            'upgrade', jsonb_build_object('item', v_item, 'ok', v_ok,
                                                          'level', case when v_ok then v_level + 1 else v_level end,
                                                          'cost', v_cost, 'chance', public._upgrade_chance(v_level),
                                                          'nudge', v_nudge, 'final', v_chance, 'score', p_score),
                            'state', public._mine_state(null, v_account));
end $$;

-- ---------- C. Máy chế biến: collecting is sorting ----------
create or replace function public.process_sort_start(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); j public.processor_jobs;
        v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  perform public._owns_machine(v_account, 'processor');
  perform public._wallet_lock(v_account);
  select * into j from public.processor_jobs where account_id = v_account;
  if not found then raise exception 'no job' using errcode = '22023'; end if;
  if now() < j.ready_at then raise exception 'not ready' using errcode = '22023'; end if;
  if exists (select 1 from public.craft_rounds where account_id = v_account and game = 'sort' and started_at > now() - interval '1 second') then
    raise exception 'too fast' using errcode = '53400';
  end if;
  delete from public.craft_rounds where account_id = v_account and game = 'sort';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'sort', v_seed, jsonb_build_object('recipe', j.recipe, 'batches', j.batches, 'job', j.started_at));
  return jsonb_build_object('round', jsonb_build_object('game', 'sort', 'seed', v_seed, 'recipe', j.recipe, 'batches', j.batches,
                                                        'started_at', now()),
                            'extras', public._fx_extras_state(v_account));
end $$;

-- The sort's end: each input's tick and basket (0 good, 1 bad) and the claimed score; then 0076's process_collect body
-- and the bonus.
create or replace function public.process_sort_finish(p_session_token text, p_ticks integer[], p_dirs integer[], p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); c public.craft_rounds; j public.processor_jobs;
        r public.processor_recipes; v_ac jsonb; v_rep jsonb; v_code text; v_ev jsonb; v_bad text; v_pct integer;
        v_bonus integer := 0; v_regular boolean;
begin
  c := public._craft_take(v_account, 'sort');
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'extras', public._fx_extras_state(v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'n', coalesce(cardinality(p_ticks), 0), 'ticks', to_jsonb(p_ticks[1:24]),
                             'dirs', to_jsonb(p_dirs[1:24]));
  v_bad := coalesce(public._sort_input_error(p_ticks, p_dirs), case when p_score is null then 'score' end);
  if v_bad is not null then
    v_code := 'sort_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._sort_replay(c.seed, p_ticks, p_dirs);
    if (v_rep->>'score')::int <> p_score then
      v_code := 'sort_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', c.seed, 'replay', v_rep);
    elsif now() < c.started_at + interval '8.7 seconds' then
      v_code := 'sort_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    else
      v_regular := p_score = 12 and (v_rep->>'rmax')::int - (v_rep->>'rmin')::int <= 1;
      perform public._ac_stat(v_account, 'sort', 1, case when p_score >= 11 then 1 else 0 end, case when v_regular then 1 else 0 end);
      if v_regular then
        v_code := public._craft_timing(v_account, 'sort_timing', 'process_sort_finish', v_ev || jsonb_build_object('replay', v_rep));
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'process_sort_finish', v_ev, null, 'invalid sort');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'extras', public._fx_extras_state(v_account)) || v_ac;
  end if;
  -- 0076's process_collect from here (the job the round was started on)
  perform public._wallet_lock(v_account);
  select * into j from public.processor_jobs where account_id = v_account for update;
  if not found or j.started_at <> (c.meta->>'job')::timestamptz then raise exception 'no job' using errcode = '22023'; end if;
  if now() < j.ready_at then raise exception 'not ready' using errcode = '22023'; end if;
  perform public._stamina_spend(v_account, 2);
  delete from public.processor_jobs where account_id = v_account;
  insert into public.processed_goods (account_id, recipe, qty) values (v_account, j.recipe, j.batches)
  on conflict (account_id, recipe) do update set qty = public.processed_goods.qty + excluded.qty;
  select * into r from public.processor_recipes where id = j.recipe;
  v_pct := public._sort_bonus(p_score);
  v_bonus := (r.value * j.batches * v_pct) / 100;
  if v_bonus > 0 then perform public._pay(v_account, v_bonus, 'produce_sell', 'sort bonus ' || j.recipe || ' x' || j.batches); end if;
  perform public._game_event(v_account, 'crop_processed', j.batches, jsonb_build_object('recipe', j.recipe, 'sort', p_score));
  perform public._game_event(v_account, 'xp_grant', 10 * j.batches, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'collected', 'score', p_score, 'bonus_pct', v_pct, 'bonus', v_bonus,
                            'extras', public._fx_extras_state(v_account));
end $$;

-- ---------- The old instant RPCs ----------
create or replace function public.brew_potion(p_session_token text, p_recipe text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023', hint = 'brew_start / brew_finish (0084)';
end $$;
create or replace function public.upgrade_item(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023', hint = 'upgrade_start / upgrade_finish (0084)';
end $$;
create or replace function public.process_collect(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023', hint = 'process_sort_start / process_sort_finish (0084)';
end $$;

-- ---------- The wipe ----------
create or replace function public._craftmg_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.craft_rounds where account_id = new.account_id;
  delete from public.potion_quality where account_id = new.account_id;
  return new;
end $$;
revoke all on function public._craftmg_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_craftmg on public.anticheat_wipes;
create trigger anticheat_wipes_craftmg after insert on public.anticheat_wipes for each row execute function public._craftmg_on_wipe();

-- ---------- Grants ----------
revoke all on function public.brew_start(text, text, integer) from public;
revoke all on function public.brew_finish(text, integer[], integer) from public;
revoke all on function public.upgrade_start(text, text) from public;
revoke all on function public.upgrade_finish(text, integer[], integer, integer) from public;
revoke all on function public.process_sort_start(text) from public;
revoke all on function public.process_sort_finish(text, integer[], integer[], integer) from public;
grant execute on function public.brew_start(text, text, integer) to anon, authenticated;
grant execute on function public.brew_finish(text, integer[], integer) to anon, authenticated;
grant execute on function public.upgrade_start(text, text) to anon, authenticated;
grant execute on function public.upgrade_finish(text, integer[], integer, integer) to anon, authenticated;
grant execute on function public.process_sort_start(text) to anon, authenticated;
grant execute on function public.process_sort_finish(text, integer[], integer[], integer) to anon, authenticated;
