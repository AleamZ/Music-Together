# v21 economy — report

Migration `supabase/migrations/0073_player_economy.sql` (additive, re-runnable; verified twice on a throwaway PG18 on
port 54373 after 0004…0069). Every RPC calls `_ac_account` (or `_ac_play` for `trade_open`), so the reads are
guarded as well (a locked account cannot browse). The client only sends intents; prices are checked against
server-derived NPC values, every move of an asset is re-verified under its row lock.

## Tradeable assets
`fish` (a `public.fish` row; value = its price), `fashion` (non-starter `account_items` with a catalogue price; value
= catalogue price; worn items fall back to starters), `produce` (kg of `produce_stock`; value = kg × price_per_kg).
Pets, gear, vehicles and homes are **not** tradeable (pets are owner-bound; homes have the estate office).
A listing / auction / stall item is a **reservation**: the asset stays with its owner (so fish don't need a delete +
re-insert, which would fire 0069's `fish_catch` event); `_econ_move` moves it with a single owner-checked
UPDATE/DELETE, so a dupe is impossible. If the owner sells/eats it elsewhere, the sweep voids the listing. Moving a
fish is an UPDATE of `account_id` (no fake catch events) and respects the receiver's bucket cap.

## Features
- **#40 Trading** — `trade_open(room, token, partner)` (partner a member of the room; both `player_pos` on the same map
  within 320 px, positions ≤ 15 min old; one open trade per account, advisory-locked), `trade_offer` (coins + ≤ 8
  assets, validated, resets both OKs, bumps `rev`), `trade_confirm(rev)` (second confirm re-checks nearness, locks both
  wallets, re-validates both offers, moves everything, nets coins with reason `trade`), `trade_cancel`, `trade_state`.
  Idle 10 min → cancelled. UI: "🤝 Giao dịch" on another player's card; `TradeWindow` (polled by `useTrade`, 5 s idle /
  2 s open; toast when finished).
- **#41 Market (Chợ người chơi)** — `market_list` (band 50–300 % of value, fee 2 % ≥ 5 xu `market_list`, 3 days, ≤ 20
  open, ≤ 30 new per hour), `market_buy(id, price seen)` (95 % `market_sell`, 5 % burned, `market_buy`),
  `market_cancel` (no refund), expiry refunds half the fee (`market_refund`). UI: 🏪 HUD button → `PlayerMarketModal`
  (browse + search + kind filter, sell form, my listings, auction tab).
- **#42 Auction house** — `auction_create` (value ≥ 300, start within band, 1/6/12/24 h, no fee), `auction_bid`
  (min raise 5 % ≥ 10, cap 500 % of value, escrow `auction_bid`, outbid refund `auction_refund`, a bid in the last
  2 min extends to now + 2 min), `auction_cancel` (only without bids). Lazy settlement in `_econ_sweep` (every econ RPC):
  winner gets the asset, seller 95 % `auction_sell`; if the asset is gone/unreceivable the bid is refunded (`void`).
- **#45 Player stalls** — 6 stalls at chú Bảy's lantern stall on Chợ Lớn (new interactable `player_stalls`, desk use
  point (560, 360); `shop_rent/shop_stock/shop_buy` claim that point via `_pos_claim`, returning the anti-cheat
  envelope 'not at market' otherwise). Rent 200/day up to 7 days ahead (`shop_rent`), 8 items, price band, sale 95 %
  `shop_sell` / `shop_buy`, sells while the owner is offline; lapsed rent frees the stall and expires its stock.
  UI: `StallModal` with the stall-row pixel art (`lib/game/art/economy.ts`, also the market header).
- **Collusion guard** — every deal goes to `econ_deals`; skewed = price ≥ 200 % or ≤ 60 % of value (trades: one side
  gives ≥ 3× the other), ignoring deals < 200. The 3rd skewed deal of the same pair within 7 days → soft
  `_ac_flag(…, 'econ_collusion', …, p_hard => false)` on both (soft events don't count toward auto-blacklist).
- **Wipe** — `_ac_wipe` is NOT re-created; an `after update of ban_state` trigger on `anticheat_status` cancels the
  wiped account's listings/auctions (bidders refunded), forfeits its escrowed top bids, frees its stall, cancels trades.

## Events emitted
`trade_done` (both sides, qty 1, meta {trade, partner}), `market_sold` (seller, qty = price, meta {listing, kind, ref,
via 'market'|'shop'}), `auction_won` (winner, qty = price, meta {auction, kind, ref}). Consumes none.

## Shared files touched (surgical)
`components/game/GameShell.tsx` (imports, Panel union, `useTrade`, overlay lock, `player_stalls` case, 🏪 HUD button,
trade button on the player card, three modal renders), `lib/game/maps/types.ts` (+`player_stalls`),
`lib/game/shell-kinds.ts`, `lib/game/maps/market.ts` (desk rect + interactable), `tests/sql/README.md` (one line).

## Tests
- `tests/sql/v21-economy-smoke.sql` — rules/privileges, board list/band/fee/reservation/buy/burn/event/expiry
  refund/void, auctions (rare only, escrow, outbid refund, min raise, cap, anti-snipe, lazy settle, void refund), stalls
  (position envelope, rent, stock, offline sale, lapse), trades (nearness, busy, rev, atomic swap, net coins, events,
  reset on change, collusion flag after 3 gifts, swap refused when apart), wipe trigger. Passes twice;
  `anticheat-guards.sql` still passes.
- `tests/unit/economy-sql.test.ts` (TS constants pinned to the SQL, guards/grants, stall claim = map desk, model) and
  `tests/unit/economy-ui.test.tsx` (market buy/search/list, auction bid refusal, stall rent/buy, trade offer/confirm):
  12/12.
- eslint clean on touched files; `tsc` errors only in other agents' in-progress files (useFarmController
  'machine_shed', art/pets.ts, farm-overlays test).

## Known gaps
- Pets and gear/vehicles are not tradeable (by design for now).
- Reservations are not enforced by other features' RPCs (e.g. selling a listed fish to the NPC depot); the listing is
  then voided — no dupe, but the seller can "renege" (buyers lose nothing).
- Trade notification is polling (5 s), not realtime. Nearness uses `player_pos`, which updates on map arrival and the
  vitals heartbeat, so two players who just met may need a heartbeat before "too far" clears.
- No stall art on the map itself (the existing lantern stall is the desk); the stall row is drawn in the panels.
