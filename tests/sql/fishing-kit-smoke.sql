-- tests/sql/fishing-kit-smoke.sql — 0098 (Bộ câu cá: Hộp mồi 100 + Thùng cá 100 for 50.000 xu). Run as the superuser on
-- the throwaway cluster after the full chain, from the repo root. It re-runs 0098 twice with \i. Every check is an ASSERT.
--   1. Stock: the kit sells for 50.000 xu; the box and crate are not sold alone; the kind is allowed.
--   2. buy_item: not enough coins refused; a buy pays 50.000 once, grants both, raises bait_cap / fish_cap to 100 / 101;
--      a second buy is 'already owned'; the box and crate alone are 'item not available'.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0098_fishing_kit.sql
\i supabase/migrations/0098_fishing_kit.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table kx (k text primary key, v text);
insert into kx select 't', token from public.register('kit_' || floor(random() * 1e9)::text, 'pw123456');
insert into kx select 'a', public._auth_account(v)::text from kx where k = 't';

-- ---------- 1. Stock ----------
do $$
begin
  assert (select price from public.shop_items where id = 'fishing_kit' and kind = 'fishing_kit' and capacity = 100) = 50000, 'kit price';
  assert (select count(*) from public.shop_items where id in ('bait_box_100', 'bucket_100') and price is null and capacity = 100) = 2, 'contents';
  assert (select name from public.shop_items where id = 'bait_box_100') = 'Hộp mồi 100'
     and (select name from public.shop_items where id = 'bucket_100') = 'Thùng cá 100'
     and (select name from public.shop_items where id = 'fishing_kit') = 'Bộ câu cá', 'names';
  raise notice 'stock ok';
end $$;

-- ---------- 2. buy_item ----------
do $$
declare v_t text := (select v from kx where k = 't'); v_a uuid := (select v from kx where k = 'a')::uuid; s jsonb; c0 integer;
begin
  perform public._wallet_lock(v_a);
  update public.wallets set coins = 49999 where account_id = v_a;
  begin
    perform public.buy_item(v_t, 'fishing_kit', 1);
    assert false, 'poor buy passed';
  exception when sqlstate '22023' then
    assert sqlerrm = 'not enough coins', sqlerrm;
  end;
  update public.wallets set coins = 52345 where account_id = v_a;
  s := public.buy_item(v_t, 'fishing_kit', 1) -> 'state';
  assert (s->>'coins')::integer = 2345, format('paid %s', s->>'coins');
  assert (s->>'bait_cap')::integer = 100 and (s->>'fish_cap')::integer = 101, format('caps %s %s', s->>'bait_cap', s->>'fish_cap');
  assert s->'owned' @> '["bait_box_100", "bucket_100"]'::jsonb, format('owned %s', s->'owned');
  assert not exists (select 1 from public.inventory where account_id = v_a and item_id = 'fishing_kit'), 'kit itself not stored';
  update public.wallets set coins = 50000 where account_id = v_a;
  begin
    perform public.buy_item(v_t, 'fishing_kit', 1);
    assert false, 'second buy passed';
  exception when sqlstate '22023' then
    assert sqlerrm = 'already owned', sqlerrm;
  end;
  foreach c0 in array array[1, 2] loop
    begin
      perform public.buy_item(v_t, case c0 when 1 then 'bait_box_100' else 'bucket_100' end, 1);
      assert false, 'content sold alone';
    exception when sqlstate '22023' then
      assert sqlerrm = 'item not available', sqlerrm;
    end;
  end loop;
  assert (select coins from public.wallets where account_id = v_a) = 50000, 'refusals cost nothing';
  raise notice 'buy ok';
end $$;
