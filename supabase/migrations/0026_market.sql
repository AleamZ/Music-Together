-- v18.4: Chợ Lớn's restaurant (spec §18.4). Mirrors lib/game/market/menu.ts.

create table if not exists public.meal_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('food', 'drink')),
  price int not null check (price > 0),
  hunger int not null default 0,
  thirst int not null default 0,
  fish_dish boolean not null default false,
  sort_order int not null
);
alter table public.meal_catalog enable row level security;

insert into public.meal_catalog (id, name, kind, price, hunger, thirst, fish_dish, sort_order) values
  ('com_tam', 'Cơm tấm sườn', 'food', 300, 45, 0, false, 1),
  ('pho_bo', 'Phở bò', 'food', 400, 55, 10, false, 2),
  ('banh_mi', 'Bánh mì thịt', 'food', 150, 25, 0, false, 3),
  ('bun_bo', 'Bún bò Huế', 'food', 450, 60, 10, false, 4),
  ('ca_kho_to', 'Cá kho tộ', 'food', 600, 70, 0, true, 5),
  ('canh_chua', 'Canh chua cá', 'food', 500, 40, 25, true, 6),
  ('ca_chien', 'Cá chiên giòn', 'food', 550, 65, 0, true, 7),
  ('tra_da', 'Trà đá', 'drink', 50, 0, 25, false, 8),
  ('nuoc_mia', 'Nước mía', 'drink', 120, 0, 40, false, 9),
  ('cafe_sua', 'Cà phê sữa đá', 'drink', 150, 5, 35, false, 10),
  ('nuoc_dua', 'Nước dừa', 'drink', 180, 0, 55, false, 11),
  ('sinh_to', 'Sinh tố bơ', 'drink', 200, 10, 50, false, 12)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, price = excluded.price,
  hunger = excluded.hunger, thirst = excluded.thirst, fish_dish = excluded.fish_dish, sort_order = excluded.sort_order;

-- The 23 reasons in force after 0019 plus the restaurant's 'meal': 24.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal'));

create or replace function public._fish_discount_pct(p_rarity int, p_weight_g int) returns int
language sql immutable set search_path = public, extensions
as $$
  select greatest(20, least(80,
    20 + (greatest(1, least(5, coalesce(p_rarity, 1))) - 1) * 12
       + least(20, greatest(0, coalesce(p_weight_g, 0)) / 250)));
$$;

create or replace function public.eat_meal(p_session_token text, p_item text, p_fish_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid; m public.meal_catalog; v_rarity int; v_weight int; v_pct int := 0; v_price int; v_coins int; v_bal int; v_vitals jsonb;
begin
  v_account := public._auth_account(p_session_token);
  select * into m from public.meal_catalog where id = p_item;
  if not found then raise exception 'unknown meal' using errcode = '22023'; end if;
  if p_fish_id is not null then
    if not m.fish_dish then raise exception 'not a fish dish' using errcode = '22023'; end if;
    select s.rarity, f.weight_g into v_rarity, v_weight
      from public.fish f join public.fish_species s on s.id = f.species_id
      where f.id = p_fish_id and f.account_id = v_account for update of f;
    if not found then raise exception 'fish not found' using errcode = '22023'; end if;
    v_pct := public._fish_discount_pct(v_rarity, v_weight);
  end if;
  v_price := m.price - (m.price * v_pct) / 100;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'meal', 'meal: ' || p_item);
  if p_fish_id is not null then delete from public.fish where id = p_fish_id and account_id = v_account; end if;
  v_vitals := public._vitals_restore(v_account, m.hunger, m.thirst);
  return jsonb_build_object('paid', v_price, 'discount_pct', v_pct, 'coins', v_bal, 'vitals', v_vitals);
end; $$;

revoke all on function public._fish_discount_pct(int, int) from public, anon, authenticated;
revoke all on function public.eat_meal(text, text, uuid) from public;
grant execute on function public.eat_meal(text, text, uuid) to anon, authenticated;
