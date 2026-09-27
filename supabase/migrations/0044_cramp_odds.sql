-- 0044 — owner's tuning (2026-09-28): jumping in without warming up cramps 20% of the time (was 10%, and only when
-- heat-shocked). The odds no longer depend on the heat: warmed up 0.5%, else 20%. `p_shocked` stays in the signature so
-- jump_in (0033) keeps calling it unchanged. lib/game/heat/model.ts `crampChance` mirrors it.

create or replace function public._cramp_chance(p_shocked boolean, p_warmed boolean) returns numeric
language sql immutable set search_path = public, extensions
as $$ select case when coalesce(p_warmed, false) then 0.005 else 0.20 end::numeric $$;

revoke all on function public._cramp_chance(boolean, boolean) from public, anon, authenticated;
