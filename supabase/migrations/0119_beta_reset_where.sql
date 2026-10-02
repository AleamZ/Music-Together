-- 0119_beta_reset_where.sql — Reset Beta failed on hosted Supabase with "DELETE requires a WHERE clause": the API roles
-- run with pg-safeupdate, which refuses a DELETE/UPDATE with no WHERE even inside a SECURITY DEFINER function.
-- admin_beta_snapshot and admin_beta_reset are re-created from 0118 verbatim but for the lines marked 0119
-- (each whole-table delete/update gets an explicit `where true`). Re-runnable.

create or replace function public.admin_beta_snapshot(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); st public.beta_state; v_n integer;
begin
  select * into st from public.beta_state where id = 1 for update;
  if st.applied_at is not null then raise exception 'already applied' using errcode = '53400'; end if;
  delete from public.beta_snapshot where true;                                          -- 0119
  insert into public.beta_snapshot (account_id, username, is_root, is_banned, eligible, net_worth, breakdown, tier, computed_at)
  select a.id, a.username, a.is_root, public._beta_banned(a.id),
         not a.is_root and not public._beta_banned(a.id),
         (nw->>'total')::bigint, nw, public._beta_tier((nw->>'total')::bigint), now()
    from public.accounts a cross join lateral (select public._beta_net_worth(a.id) nw) x;
  get diagnostics v_n = row_count;
  update public.beta_state set snapshot_at = now(), snapshot_by = v_root, snapshot_runs = snapshot_runs + 1 where id = 1;
  return public.admin_beta_status(p_session_token) || jsonb_build_object('snapshot_rows', v_n);
end $$;
revoke all on function public.admin_beta_snapshot(text) from public;
grant execute on function public.admin_beta_snapshot(text) to anon, authenticated;

create or replace function public.admin_beta_reset(p_session_token text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); st public.beta_state; r record; v_n integer;
        v_wiped jsonb := '{}'::jsonb; v_unc text[]; v_mail bigint; v_rod bigint; v_furn bigint; v_items text[]; v_xu integer;
        v_until timestamptz := now() + interval '7 days'; v_granted integer := 0; v_ledger integer; v_supply bigint; it text;
begin
  if p_confirm is distinct from 'RESET BETA' then raise exception 'confirm phrase' using errcode = '22023'; end if;
  select * into st from public.beta_state where id = 1 for update;
  if st.applied_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'applied_at', st.applied_at, 'summary', st.summary);
  end if;
  if st.snapshot_at is null or not exists (select 1 from public.beta_snapshot) then
    raise exception 'no snapshot' using errcode = '53400';
  end if;
  v_unc := public._beta_unclassified();
  if cardinality(v_unc) > 0 then raise exception 'unclassified tables: %', array_to_string(v_unc, ', ') using errcode = '53400'; end if;
  perform set_config('mt.beta_grant', 'on', true);

  -- the ledger first: one 'wipe' row per non-zero wallet, so the supply series stays exact
  select coalesce(sum(coins), 0) into v_supply from public.wallets;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref)
  select account_id, -coins, 0, 'wipe', 'beta reset' from public.wallets where coins <> 0;
  get diagnostics v_ledger = row_count;

  -- release the world rows
  update public.apartments set owner_id = null, tenure = null, paid_until = null, visibility = 'private', wall = null,
         floor = null, since = null where owner_id is not null or tenure is not null;
  update public.house_lots set owner_id = null, bought_at = null, paid_until = null, grid = null, rooms = null, roof = 'ngoi',
         wall = null, floor = null, visibility = 'private', build_cost = 0 where owner_id is not null or build_cost <> 0 or grid is not null;
  update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
   where owner_id is not null or sale_price is not null or sublease_price is not null;
  update public.econ_stalls set renter = null, paid_until = null where renter is not null;

  -- wipe
  for r in select * from public.beta_reset_scope where action = 'wipe' order by ord, tbl loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('delete from public.%I where true', r.tbl);                         -- 0119
    get diagnostics v_n = row_count;
    v_wiped := v_wiped || jsonb_build_object(r.tbl, v_n);
  end loop;

  -- characters back to the default look (the body's gender kept)
  update public.characters
     set skin = 'warm', hair = case when gender = 'nu' then 'long' else 'short' end, hair_color = 'black',
         hat = 'hat_nonla', top = 'top_baba_yellow', bottom = 'bottom_shorts_red', shoes = 'shoes_dep_blue', neck = 'neck_khanran',
         hand = null, pet = null, outfit = null, wrist = null, hairpin = null, belt = null, ug_title = null, pg_level = null,
         pg_title = null, body = null, beta_tier = null, updated_at = now()
   where true;                                                                         -- 0119

  -- the rewards: every eligible account in the snapshot that still exists
  for r in select s.* from public.beta_snapshot s join public.accounts a on a.id = s.account_id
            where s.eligible order by s.net_worth desc, s.username loop
    v_items := public._beta_items(r.tier);
    v_xu := public._beta_starter_xu(r.tier);
    v_mail := public._mail_new(r.account_id, 'system', null, 'gift', 'Quà kỷ niệm Beta',
      'Cảm ơn bạn đã cùng Music Together đi qua thời Beta! Thế giới đã được làm mới, nhưng bạn vẫn được giữ tài khoản. '
      || 'Trong thư: ' || v_xu || ' xu khởi nghiệp, mồi câu và thính'
      || case when cardinality(v_items) > 0 then ', cùng bộ đồ "Kỷ niệm Beta" độc quyền (không bán, không tặng, không giao dịch)' else '' end
      || '. Đã gửi thẳng vào túi: cần tre lắp sẵn lưỡi và dây, linh vật Kỷ niệm Beta, danh hiệu "Người khai hoang Beta", '
      || 'khung tên β và 7 ngày tăng tốc (+50% kinh nghiệm, +25% hạn mức thương lái trả đủ giá). '
      || 'Giá trị tài sản lúc chốt: ' || r.net_worth || ' xu (bậc ' || r.tier || ').',
      'beta_reset', null);
    update public.mail set expires_at = now() + interval '90 days' where id = v_mail;
    perform public._mail_xu(v_mail, v_xu, 'admin_gift');
    insert into public.mail_items (mail_id, kind, ref, qty, name, value) values
      (v_mail, 'item', 'bait_shrimp', 20, (select name from public.shop_items where id = 'bait_shrimp'), 0),
      (v_mail, 'item', 'gb_cam', 5, (select name from public.shop_items where id = 'gb_cam'), 0);
    foreach it in array v_items loop
      insert into public.mail_items (mail_id, kind, ref, qty, name, value)
      values (v_mail, 'fashion', it, 1, (select name from public.item_catalog where id = it), 0);
    end loop;
    -- the rod, assembled: Cần tre + Lưỡi đơn nhỏ + Dây cước 0.2 (its snaps) + Phao lông gà
    insert into public.rods (account_id, item_id, durability, name)
    values (r.account_id, 'rod_bamboo', (select durability from public.shop_items where id = 'rod_bamboo'), 'Cần tre Beta')
    returning id into v_rod;
    insert into public.rod_parts (rod_id, slot, item_id, durability) values
      (v_rod, 'hook', 'hook_small', null),
      (v_rod, 'line', 'line_02', (select durability from public.shop_items where id = 'line_02')),
      (v_rod, 'bobber', 'bobber_feather', null);
    insert into public.furniture_items (account_id, item_id) values (r.account_id, 'beta_mascot') returning id into v_furn;
    -- the title (an achievement, worn) and the frame
    insert into public.player_achievements (account_id, achievement) values (r.account_id, 'beta_pioneer') on conflict do nothing;
    perform public._pg_row(r.account_id);
    update public.player_progress set title = 'beta_pioneer', updated_at = now() where account_id = r.account_id;
    insert into public.characters (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender)
    values (r.account_id, 'warm', 'short', 'black', 'hat_nonla', 'top_baba_yellow', 'bottom_shorts_red', 'shoes_dep_blue', 'neck_khanran', 'nam')
    on conflict (account_id) do nothing;
    update public.characters set pg_title = 'Người khai hoang Beta', pg_level = 1, beta_tier = r.tier where account_id = r.account_id;
    -- the boosts
    insert into public.account_boosts (account_id, kind, pct, starts_at, until, source) values
      (r.account_id, 'xp', 50, now(), v_until, 'beta_reset'), (r.account_id, 'npc_quota', 25, now(), v_until, 'beta_reset')
    on conflict (account_id, kind) do update set pct = excluded.pct, starts_at = excluded.starts_at, until = excluded.until, source = excluded.source;
    insert into public.beta_rewards (account_id, tier, net_worth, mail_id, xu, items, rod_id, furniture_id, title_granted, frame, boost_until)
    values (r.account_id, r.tier, r.net_worth, v_mail, v_xu, to_jsonb(v_items), v_rod, v_furn, true, true, v_until);
    v_granted := v_granted + 1;
  end loop;

  update public.beta_state
     set applied_at = now(), applied_by = v_root,
         summary = jsonb_build_object('wiped', v_wiped, 'ledger_rows', v_ledger, 'supply_burned', v_supply,
                                      'rewarded', v_granted, 'boost_until', v_until,
                                      'accounts', (select count(*) from public.accounts))
   where id = 1;
  perform set_config('mt.beta_grant', '', true);   -- the grant window closes with the reset, not with the transaction
  return jsonb_build_object('ok', true, 'already', false, 'applied_at', now(),
                            'summary', (select summary from public.beta_state where id = 1));
end $$;
revoke all on function public.admin_beta_reset(text, text) from public;
grant execute on function public.admin_beta_reset(text, text) to anon, authenticated;
