# Kết thúc Beta — the two-phase production reset and the "Kỷ niệm Beta" rewards (0118)

Owner decision (2026-10-01): a full end-of-beta reset of production. Keep only the account; wipe everything else; soften it
with exclusive, non-tradeable commemorative rewards by tier of total net worth at snapshot time, plus perks for every
pre-reset account (root and banned accounts excluded).

Files: `supabase/migrations/0118_beta_reset.sql` (definitions only — it changes no player data),
`scripts/db/beta-reset-news.sql` (the Bản tin post, run by hand after the reset), `components/admin/BetaResetTab.tsx`
(admin "Reset Beta"), `lib/game/beta/*` (frame, boost countdown, RPCs), `tests/sql/beta-reset-smoke.sql`,
`tests/unit/beta-reset.test.ts`. Renders: `docs/superpowers/specs/beta-reset/`.

## How to run it on production (after 0099–0117 and 0118 are applied)

1. **Phase 1 — snapshot** (admin → Reset Beta → "Chốt sổ", or `select admin_beta_snapshot('<root token>')`). Values
   every account and stores `beta_snapshot` (net worth, breakdown, tier, eligible). Read-only on player data;
   re-runnable (each run replaces the snapshot) until phase 2. Review the tier counts, the top 20 and each player's
   breakdown in the panel. Re-run it right before phase 2 so accounts made since are included (`new_since_snapshot`).
2. **Phase 2 — reset** (type `RESET BETA`, press "Reset Beta", or `select admin_beta_reset('<root token>', 'RESET BETA')`).
   One transaction: on any error nothing changes. Requires the phrase, a snapshot, and that every account table is
   classified (`_beta_unclassified()` empty — a table added by a later migration blocks the reset until it is put in
   `beta_reset_scope`). A second call returns `{already: true}` and does nothing. After it, `admin_beta_snapshot` is
   refused (`already applied`).
3. `admin_beta_status(token)`: state, tier counts, top, per-player preview (≤ 2000), and after the reset the summary
   (rows deleted per table, ledger rows, xu burned, rewarded count, boost end).
4. Then run `scripts/db/beta-reset-news.sql` once (it inserts the unpinned post only after the reset, only once).

Root only (`_auth_root`) for the three admin RPCs; `beta_me(token)` is the player's read (tier, title, live boosts).

## Net worth (`_beta_net_worth`, xu)

| part | value |
|---|---|
| xu | wallet coins |
| items | inventory qty × `shop_items.price` (bait, parts, seeds, …; null price = 0) |
| rods | each rod instance at its shop price + each mounted part (hook/line/reel/bobber) at its shop price |
| fish | bucket fish + fridge fish + aquarium fish in the account's tanks, at their price |
| fashion | owned `item_catalog` items at price (starters, uniforms, exclusives are 0) |
| furniture | owned furniture at catalogue price (exclusive excluded) |
| vehicles | `vehicle_catalog.price` |
| pets | `_pet_species_price(species)` |
| land | each owned field plot 800 000 (the village price, inside the 400 000–2 400 000 band) |
| houses | each owned lot `_house_price('land')` + build_cost × `_estate_rule('build')` / 100 (the appraisal); an owned flat `_apt_price('buy')`, a rented one 0 |
| produce | `produce_stock.kg × upland_crops.price_per_kg` |

Rice, ores, wood, dishes and other crafted goods are not counted (no stable price). Tier: ≥ 500 000 → 5, ≥ 200 000 → 4,
≥ 100 000 → 3, ≥ 50 000 → 2, ≥ 10 000 → 1, else 0.

## Rewards

Eligible = in the snapshot and still existing, not root, not banned. Banned = `accounts.is_banned`, or an anti-cheat ban
state (`pending_wipe` / `wiped`), or on the blacklist. Accounts created after the snapshot are wiped but get nothing.

| tier | net worth | starter xu | Kỷ niệm Beta fashion (cumulative) |
|---|---|---|---|
| 0 | < 10 000 | 2 000 | — |
| 1 | ≥ 10 000 | 5 000 | Dép (`beta_dep`) |
| 2 | ≥ 50 000 | 8 000 | + Nón (`beta_non`) |
| 3 | ≥ 100 000 | 12 000 | + Quần (`beta_quan`) |
| 4 | ≥ 200 000 | 16 000 | + Áo (`beta_ao`) |
| 5 | ≥ 500 000 | 20 000 | + Set đồ (`beta_set`) |

The starter xu stay on the econ v2 scale (a fresh player earns ≈ 1–3 k xu in the first days; 20 k is ~ one plot's
sublease cap, far below a plot). Delivered through the mailbox (0111) as one system mail "Quà kỷ niệm Beta" (kind
`gift`, ref `beta_reset`, 90 days): the xu (ledger `admin_gift` at the claim), 20 Mồi tép, 5 Thính cám gạo and the
fashion items. Set directly: a Cần tre instance (`rods`) with Lưỡi đơn nhỏ + Dây cước 0.2 + Phao lông gà mounted, the
mascot furniture `beta_mascot` (in storage), the title achievement `beta_pioneer` ("Người khai hoang Beta", worn), the
β name frame (`characters.beta_tier`), and two 7-day boosts in `account_boosts`: `xp` +50 % (the XP and the day caps in
`_pg_add_xp`) and `npc_quota` +25 % (the thương lái full-price band in `_npc_sale` / `_npc_quota`). Each grant is
recorded in `beta_rewards`.

## Exclusivity (server-side)

`item_catalog.exclusive` / `furniture_catalog.exclusive`. Triggers: an exclusive item enters `account_items` only during
the reset (`mt.beta_grant`, closed again at the end of `admin_beta_reset`) or by claiming the account's own Beta mail;
it never changes owner (`account_items`, `furniture_items` updates refused); it can never be put in another mail
(`mail_items`: admin gifts, codes, trades, market deliveries), a listing or auction (`econ_listings`, `econ_auctions`), a
trade offer (`econ_trades`) or a fashion gift (`fashion_gifts`); `sell_fashion_item` refuses it (`exclusive item`);
`buy_fashion_item` / `furniture_buy` are refused by the insert guard. The client hides them from the shops.

## The reset itself (one transaction)

1. a `coin_ledger` row `wipe` / `beta reset` per non-zero wallet (the supply series stays exact);
2. release the world rows (`apartments`, `house_lots`, `field_plots`, `econ_stalls`);
3. delete every row of every `wipe` table (in `ord` order);
4. reset `characters` to the default look (gender kept; titles, level, belt, body, frame cleared);
5. the rewards for every eligible account; 6. `beta_state.applied_at` + summary.

## Classification of every table that references an account (`beta_reset_scope`)

A test (`tests/unit/beta-reset.test.ts`, from the migration files) and the SQL smoke (from the live catalogue:
`_beta_unclassified()`) assert that every public table with an `account_id` column or a foreign key to `accounts` is
listed here; the reset refuses to run otherwise. `accounts` itself is kept (id, username, created_at, is_root, is_banned).

**keep** — identity, login, moderation evidence, chat, music, admin records, history, world state:
`account_auth`, `account_secrets`, `sessions`, `members`, `rooms`, `queue_items`, `video_durations`, `chat_messages`,
`party_chat`, `feedback`, `news_posts`, `news_post_reads`, `news_event_reads`, `anticheat_status`, `anticheat_events`,
`anticheat_wipes`, `anticheat_config`, `blacklisted_accounts`, `ac_bot`, `fight_conflicts`, `gift_codes`,
`gift_code_redemptions` (so an old code cannot be redeemed twice), `gift_code_attempts`, `mail_batches`, `econ_params`,
`coin_ledger` (never pruned; the reset adds the wipe rows), `boss_fights`, `field_rats`, `wild_spawns`, `world_snow`,
`forest_felled`, `account_boosts`, `beta_snapshot`, `beta_rewards`, `beta_state`.

**release** (owner columns cleared): `apartments`, `house_lots`, `field_plots`, `econ_stalls`.

**reset**: `characters` (default look; Beta title and frame for the eligible).

**wipe** (every row): `ac_hours`, `ac_play_stats`, `ac_rate`, `ac_stat_flags`, `account_items`, `apt_guests`,
`apt_knocks`, `apt_tv`, `aquarium_fish`, `aquarium_tanks`, `arena_series`, `arena_teams`, `boat_trips`, `boats`,
`boss_hits`, `card_hands`, `card_log`, `card_seats`, `card_tables`, `casts`, `chop_profile`, `chop_progress`,
`company_contrib`, `cook_profile`, `cooked_dishes`, `craft_bag`, `craft_rounds`, `critters`, `crops`, `dogs`,
`drying_slots`, `dungeon_members`, `dungeon_runs`, `econ_auctions`, `econ_bids`, `econ_deals`, `econ_listings`,
`econ_npc_days`, `econ_trades`, `estate_cooldowns`, `estate_listings`, `estate_sales`, `farm_machines`, `farm_profiles`,
`fashion_gifts`, `fight_logs`, `fight_matches`, `fight_profiles`, `fight_rings`, `fight_stamina_short`, `fish`,
`fish_fighters`, `fishing_battle_players`, `fishing_battles`, `fishing_groundbait`, `fishing_profiles`, `fridge_fish`,
`furniture_items`, `game_events`, `gather_cooldowns`, `groundbait_spots`, `heat_state`, `house_guests`, `house_knocks`,
`house_room_rents`, `house_tenancies`, `inventory`, `item_upgrades`, `land_offers`, `leaderboard_cache`,
`login_streaks`, `mail` (with `mail_items`, `mail_fish`), `martial_enrollments`, `martial_exams`, `mg_live`, `mine_digs`,
`mine_tools`, `mining_profiles`, `motel_stays`, `net_throws`, `owned_vehicles`, `parties`, `party_invites`,
`party_members`, `perk_payouts`, `personal_bests`, `pet_battles`, `pet_care_rounds`, `pet_items`, `pet_owner`, `pets`,
`photo_album`, `photo_save_log`, `player_achievements`, `player_buffs`, `player_collections`, `player_fishdex`,
`player_pos`, `player_profession_main`, `player_professions`, `player_progress`, `player_skills`, `player_stamina`,
`player_stats`, `player_waypoints`, `plot_leases`, `potion_quality`, `processed_goods`, `processor_jobs`,
`produce_stock`, `prof_starter_grants`, `prof_tools`, `quest_progress`, `quest_visits`, `rain_state`, `rat_bag`,
`rest_state`, `rice_stock`, `river_rows`, `rods` (with `rod_parts`), `sling_aims`, `story_progress`, `treasure_digs`,
`treasure_maps`, `ug_cup_entries`, `ug_ladder`, `ug_profiles`, `ug_queue`, `umbrellas`, `vitals`, `wallets`,
`wild_album`, `wild_bag`, `wild_photos`, `wild_profile`, `wood_bag`, `world_mg`.

Not wiped (global, no player): catalogues, `company_quests` (the community quest pool), `fish_price_index`,
`world_forest`, `mine_nodes`, `rat_clocks`, `room_weather`, `play_history`.

## Client

The β frame is text (`β〔Lan〕`, `lib/game/beta/frame.ts`) carried by `nameTag`, so the 2D and 3D nameplates show it;
both also draw a gold border round a framed tag. The HUD shows the framed name and a boost chip with the countdown
(`BetaBoostChip`, `beta_me`). Chat shows the frame from `characters.beta_tier`. The keepsakes are cream + gold with a
gold β emblem (2D garments `beta_ao` / `beta_set`, items `beta_non` / `beta_quan` / `beta_dep`; 3D top kind `beta`).
