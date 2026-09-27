-- =========================================================
-- 0037_net_arrows.sql — v18.2 the net's pull becomes an arrow-sequence minigame (owner's change, 2026-09-27;
-- docs/superpowers/plans/2026-09-27-v18-2-rods.md). ADDITIVE and re-runnable. Run after 0034 (independent of
-- 0035/0036). finish_net is copied from 0034 with only the lines marked "v18.2b" changed: it takes the mistake count
-- instead of the tug's outcome.
--   A. _net_rounds(haul): how many arrow rounds a haul asks for (lib/game/fishing/net.ts arrowPlan mirrors it).
--   B. finish_net(token, throw, mistakes): 0 = all the fish; 1–3 = one random fish dropped per mistake; 4 = kéo hụt,
--      pulled into the pond (hunger −10 + the v18.10 swim immunity), no fish.
-- Client trust (as in 0034): the mistake count is the client's claim; the server checks 0 … 4 and that the rounds took
-- at least 0.8 s each after the haul.
-- =========================================================

-- ---------- A. Rounds ----------
-- The haul's weight d = Σ(rarity + kg); rounds = round-half-up(d / 2) + 1, between 2 and 5.
create or replace function public._net_rounds(p_haul jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$
  select least(5, greatest(2, floor(coalesce(sum((f->>'rarity')::numeric + (f->>'weight_g')::numeric / 1000), 0) / 2 + 0.5)::int + 1))
    from jsonb_array_elements(coalesce(p_haul, '[]'::jsonb)) f
$$;
revoke all on function public._net_rounds(jsonb) from public, anon, authenticated;

-- ---------- B. finish_net ----------
drop function if exists public.finish_net(text, uuid, boolean);                           -- v18.2b: was p_won
create or replace function public.finish_net(p_session_token text, p_throw_id uuid, p_mistakes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_free integer; f jsonb; v_id uuid; v_fish jsonb := '[]'::jsonb;
        v_vit public.vitals; v_n integer := 0;
        v_keep jsonb;                                                                     -- v18.2b
begin
  v_account := public._ac_account(p_session_token);
  if p_mistakes is null or p_mistakes < 0 or p_mistakes > 4 then                          -- v18.2b
    raise exception 'invalid mistakes' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);
  delete from public.net_throws where account_id = v_account and id = p_throw_id returning * into t;
  if not found or t.haul is null then raise exception 'throw not found' using errcode = '22023'; end if;
  if now() > t.hauled_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._fishing_state(v_account));
  end if;
  if p_mistakes >= 4 then                                                                 -- v18.2b: kéo hụt
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - 10) where account_id = v_account returning * into v_vit;
    perform public._heat_row(v_account);
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', null, 'rod_lost', false, 'hunger', 10),
      'vitals', public._vitals_json(v_vit), 'state', public._fishing_state(v_account));
  end if;
  if now() < t.hauled_at + make_interval(secs => 0.8 * public._net_rounds(t.haul)) then  -- v18.2b: the rounds' time
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account));
  end if;
  -- v18.2b: one random fish escapes per mistake
  select coalesce(jsonb_agg(x.v), '[]'::jsonb) into v_keep
    from (select value v from jsonb_array_elements(t.haul) order by random()
          offset least(p_mistakes, jsonb_array_length(t.haul))) x;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  for f in select value from jsonb_array_elements(v_keep) loop                            -- v18.2b: v_keep
    exit when v_n >= v_free;
    insert into public.fish (account_id, species_id, weight_g, price)
    values (v_account, f->>'species_id', (f->>'weight_g')::int, (f->>'price')::int) returning id into v_id;
    v_fish := v_fish || jsonb_build_array(f || jsonb_build_object('id', v_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('result', 'caught', 'count', v_n, 'fish', v_fish,
    'escaped', jsonb_array_length(t.haul) - jsonb_array_length(v_keep),                   -- v18.2b
    'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.finish_net(text, uuid, integer) from public;
grant execute on function public.finish_net(text, uuid, integer) to anon, authenticated;
