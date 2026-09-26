# Music Together v16 — "Góc đánh bài": Tiến lên, Cào and Poker (Design)

**Date:** 2026-09-25
**Builds on:** `feat/v15-field` @ `5f72a56` plus the two migrations that land before v16: `0015_anticheat.sql` (anti-cheat spec) and `0016` (v15.2). The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom session auth and SECURITY DEFINER RPCs called with the anon key. There is no service-role key and no server secret.
**Roadmap:** … → v15.2 (tools and new crops, `0016`) → **v16 = card-games corner (this doc, `0017_v16_cards.sql`)** → v17 = the old v16 (harvest rats, the dog, the slingshot).
**How it was decided:** the owner asked to run autonomously and take the controller's ★ options. §2.1 lists them. §2.2 lists every ruling made while writing, each with a one-line reason. §19 lists the rule choices that are contentious.

## 1. Goal

The hall gets a **Góc đánh bài** with three tables, one per game:

1. **Tiến lên miền Nam**, 2–4 players.
2. **Cào (ba cây)** with a rotating dealer, 2–6 players.
3. **Poker**, Texas Hold'em no-limit, 2–6 players.

Players stake their own xu (`wallets.coins`). Money only moves between players: every hand is zero-sum and there is no house cut. The server shuffles with a cryptographic RNG, deals, keeps hands private, validates every move, runs the turn timers and settles. Other room members can watch; they see only public information. A rules book, **📜 Sổ luật**, teaches the three games in Vietnamese.

## 2. Decisions

### 2.1 Controller decisions (★, given)

| # | Decision |
|---|---|
| C1 | A "Góc đánh bài" area in the hall with 3 tables. Walking to a table and pressing E opens its panel. Original pixel art. |
| C2 | One table per game per room: Tiến lên ≤ 4, Cào ≤ 6, Poker ≤ 6 seats. Spectators see public info. The first player to sit picks the stake: 100 / 1 000 / 10 000 xu. |
| C3 | Personal xu, zero-sum, no house cut. Poker: buy-in 50–200 big blinds, returned on standing up. Tiến lên and Cào: each hand escrows each player's maximum loss, then settles. A plain "Legal & product" note (§16). |
| C4 | Server-authoritative engines in PL/pgSQL; `extensions.gen_random_bytes` shuffle; hands in private tables; own hand via one RPC, public state via another; every move validated. TS mirrors for UI hints only, pinned to SQL by a shared fixtures file. |
| C5 | A broadcast channel per table carrying hints only ("changed, version N"); clients then fetch the state (the field's `fp` pattern). |
| C6 | Lazy turn timers: Tiến lên 20 s, Cào 15 s, Poker 30 s. Any RPC after a deadline first applies the auto action; clients call a cheap tick RPC. Idle seats are removed. (The controller's later ruling R37 narrows "any RPC" to `card_tick` and the writes.) |
| C7 | Anti-cheat `0015`: envelope, `_ac_flag`, the game-action lock. Locked or banned players cannot sit or act. Impossible moves are refused and, when only a modified client could send them, flagged. |
| C8 | 📜 Sổ luật: a tab per game (goal, card order, combinations with card examples, turn flow, special rules, money with worked examples). Opens from each table panel and from a sign. |
| C9 | `supabase/migrations/0017_v16_cards.sql`, after `0016`, additive and re-runnable. |
| C10 | No tournaments, no in-table chat, no private tables, no bots. Exactly one rule variant per game, the most common one. |

### 2.2 Rulings made while writing

| # | Ruling | Why |
|---|---|---|
| R1 | The corner sits in the hall's south-west, between palm A and palm B (§5). | It is the quiet side, away from the stage view and the café seats. |
| R2 | One seat per account per room, across the three tables. A seat left mid-hand still counts until that hand ends: the unique index covers `leaving` rows, and sitting anywhere in the room before then is refused with `still leaving`. | One panel, one set of timers, clear idle rules; leaving a hand never frees the player to play elsewhere before it ends (controller). |
| R3 | The stake S is the unit everywhere: Tiến lên and Cào pay in multiples of S; poker blinds are S/2 and S. | One number per table, easy to read in the UI. |
| R4 | Tiến lên uses the "nhất nhì ba bét" style: play continues until one player still holds cards. | The owner's request names it; it is the common Southern style. |
| R5 | Tiến lên pays bét → nhất 1 S and ba → nhì ½ S (3 players: bét → nhất 1 S; 2 players: 1 S). | bigkool's 2 : 1 scheme (12 and 6 units); the other sources give no numbers. |
| R6 | Penalty values: heo đen ½ S, heo đỏ 1 S, 3 đôi thông 1½ S, tứ quý 2 S, 4 đôi thông 3 S, for both thối and chặt. | bigkool's scale (6/12/18/24/36 against a 12-unit bét); hocvienboardgames matches it except 2½ for 4 đôi thông; vi.wikipedia matches the two heo values. |
| R7 | Chặt chồng counts only the cards actually cut. The last player cut pays the chain to the last cutter when the round (vòng) ends. | The simplest reading that matches "người bị chặt sau cùng chịu toàn bộ". |
| R8 | A cut combination whose owner went out with it pays nothing. | vi.wikipedia's rule; it removes a "punish the winner" edge. |
| R9 | Only 4 đôi thông may cut out of turn or after passing ("không cần vòng"). | BGA, bigkool and hocvienboardgames; 3 đôi thông and tứ quý need the turn. |
| R10 | Tới trắng: sảnh rồng (3→A), 5 đôi thông, tứ quý heo, 6 đôi. Each other player pays 2 S; no thối. | The four patterns all the consulted sources list; gamevh pays tới trắng without thối. |
| R11 | Cóng: when the first player goes out, anyone who has played no card is out at once and pays nhất 2 S plus thối. Several cóng players take the bottom places in reverse turn order counted from the winner: the one farthest from the winner is bét. | vi.wikipedia ("2 lần tiền cược" + heo/hàng); the cóng players do not keep playing; the order is deterministic (controller). |
| R12 | Thối of the last player holding cards goes to the player ranked just above; a cóng player's thối goes to nhất; a forfeiter's goes to the next active player in turn order (R13). | vi.wikipedia gives bét's thối to the third place; cóng money goes to nhất; a forfeit is settled before nhất is known. |
| R13 | A forfeit (leaving mid-game, two missed turns in a row, a ban, a kick, a wipe or an account deletion) is settled at once, within the cap: (1) an open chain whose victim is the forfeiter closes and the forfeiter pays it; one whose cutter is the forfeiter is dropped; (2) the forfeiter pays 1 S to each other active player still in the game, whatever their card count, in turn order; (3) then the thối of their own hand to the next of them in turn order. A forfeit never makes anyone cóng: cóng is evaluated only when a player finishes. A line whose recipient is gone or leaving is not paid: it stays in the forfeiter's escrow and is refunded. Seats removed by the same sweep leave together, so they never pay each other. The forfeiter takes no place; the others finish as a smaller game. | Settling at once lets the seat and the account go without holding the game's money ("đền làng"); with anyone left to pay, leaving costs at least what finishing bét would; the recipients follow the controller's ruling. |
| R14 | Tiến lên escrow is 10 S, and nobody loses more than 10 S in one game. Lines are applied as they occur, and each is paid only up to what is left of the payer's escrow. | The escrow must be the maximum loss (C3); the cap rarely binds (a heavy cóng is ≤ 8½ S). |
| R15 | The first game at a table, the game after a tới trắng, and a game the previous nhất is not dealt into are led by the holder of the lowest dealt card, who must include it (`must`). So a tới trắng sets `first_game = true` and clears `lead_id`, as the empty-table reset does (R36). Later games are led by the previous nhất. | vi.wikipedia "ván khởi đầu"; with 2–3 players 3♠ may be undealt; the lead never goes to someone who is not playing (controller). |
| R16 | Card counts in each hand are public. | Every online version shows them; needed to follow the game. |
| R17 | Cào is "cào cái": the dealer rotates each hand; each player wins or loses 1 S against the dealer. | The iconic Tết form; everyone's expected result is 0 over a rotation. |
| R18 | Cào order: sáp > ba tây > nút 9 … 0. No liêng (straights). | Sáp and ba tây are the specials the sources share; liêng belongs to the game Liêng. |
| R19 | Cào ties: the higher top card wins, by rank K > Q > J > 10 > … > 2 > A, then suit ♦ > ♥ > ♣ > ♠. No pushes. | The common "so lá lớn nhất, rồi so chất (rô cao nhất)"; hands never share a card, so a winner always exists. |
| R20 | In Cào each non-dealer escrows S and the dealer (n − 1) S, 2 (n − 1) S in all. A player who cannot cover the dealer's escrow is skipped as dealer that hand. The players and the dealer are rebuilt under the wallet locks just before the holds. | Each side's maximum loss; the dealer role has zero expected value, so skipping hurts nobody. |
| R21 | Poker follows the TDA rules for min-raise, re-opening, heads-up blinds and odd chips. Every hand that reaches showdown is shown. | The standard; no mucking keeps the UI and the trust story simple. |
| R22 | Poker newcomers are dealt in at the next hand without posting; the button moves to the next seat with chips. | Cash-game posting rules are overkill for play money. |
| R23 | Poker top-up between hands up to 200 BB; no sit-out; a seat with 0 chips at the deal is stood up. | Keeps the seat list honest. |
| R24 | Every action carries the table's `seq`. A mismatch is refused as `stale` and never flagged. | Double clicks and delayed requests can never act on a newer state. |
| R25 | `card_state` is identical for every viewer. The caller's cards come only from `card_hand` and from their own action answers. | C4; the public state could later be broadcast whole. |
| R26 | Hint `cv {id, v}` on `cards:{roomId}:{game}`. Receivers gather 150 ms, keep refetches ≥ 500 ms apart, and poll every 15 s while nothing arrives. | Fast enough for card play and bounded against floods (anti-cheat R35's idea). |
| R27 | The hall's table labels come from `card_lobby`, polled every 20 s while on the hall. No realtime. | Seat changes are rare; hall players never pay for table traffic. |
| R28 | Idle: a seat with no card call for 60 s is not dealt in and is stood up at the next deal. Two consecutive timeouts remove a player exactly as `card_leave` would (§6.3). | C6; one rule for all three games. |
| R29 | A seated player may close the panel and walk around; a HUD chip shows the table and the turn. | Sitting should not freeze the character. |
| R30 | Hard anti-cheat signals only for malformed inputs. Illegal but well-formed moves are refused and logged as soft `bad_move`. | A mirror bug must never strike an honest player (anti-cheat §7.1). |
| R31 | `card_tick` and `card_leave` are on the guard allowlist with the reads. | A tick applies only what is due; leaving never helps a cheater. |
| R32 | Holdings are resolved before an account or a room goes away (§6.3). A wipe or an account deletion first calls `_card_forfeit_all` (for deletions, a BEFORE DELETE trigger on `accounts`). A room deletion lets banned players and non-members leave as a sweep would, then cancels every live hand and refunds (a BEFORE DELETE trigger on `rooms`). The sweep resolves banned and kicked players with the leave rules. | No xu vanishes: the only xu destroyed is a wiped cheater's own balance (or a deleted account's own wallet); nobody pays a banned account (anti-cheat R10). |
| R33 | Ledger reasons `card_hold`, `card_settle`, `card_buyin`, `card_cashout`, `card_refund`. | Every wallet move stays auditable. |
| R34 | `card_log` is private and kept 14 days. | Evidence for disputes and anti-cheat review, bounded storage. |
| R35 | A Cào dealer cannot `card_leave` during `peek` (`dealer busy`). A dealer removed by the sweep or `_card_forfeit_all` cancels the hand instead. | Cancelling on demand would let a dealer who sees a weak hand void it; the hand ends by itself within 15 s. |
| R36 | When the last seat leaves, the table resets in the same transaction: `first_game = true`; `lead_id`, `pos`, `turn`, `deadline`, `pub` and `last` cleared; stake unset; phase `idle`. | A new group never inherits a departed winner, dealer, button or stake (controller). |
| R37 | Reads (`card_lobby`, `card_state`, `card_hand`) are non-mutating snapshots; their only write to card rows is a separate `seen_at` touch. Only `card_tick` and the write RPCs sweep, under the table lock. | One place mutates state, always under the lock (controller). |
| R38 | Every card RPC starts with the room-membership check `_auth(p_room_id, p_session_token, 'any')` (0004), before any table or hand is read. | Hands, results and seats are room data (controller). |

## 3. Constraints

- Everything in the v13–v15 and anti-cheat constraints holds: free-plan Realtime limits, RPC-only writes, original art drawn in code, the `.game-ui` parchment look, Vietnamese UI with `vi-VN` numbers (`formatXu`).
- **Migration:** `0017_v16_cards.sql`, after `0016`, additive and re-runnable (`if not exists`, `create or replace`, `drop … if exists`). The owner runs it in the SQL editor before the v16 client goes live.
- **Time and randomness are injectable:** every engine function takes `p_now`; every deal takes `p_deck integer[] default null` (null = shuffle). Public RPCs pass `now()` and null. Tests replay fixed decks and times.
- **Anti-cheat rules for later migrations (anti-cheat §11.3)** apply: new game RPCs start guarded, the `coin_ledger` check keeps `'wipe'` and `0016`'s reasons, `anticheat-guards.sql` gains the new RPCs.
- **Test baseline:** the plan's first task records it (v15.2 changes it).
- **README:** a v16 section like v13–v15: the migration and deploy order, what's new, the trust model (§12) and the realtime budget (§12).

## 4. Architecture

```
components/game/GameShell.tsx        + useCardsController: lobby, open panel, seated table, HUD chip
 ├─ GameCanvas / engine              setCardTables(labels) draws the table labels in the hall
 ├─ hooks/useCardTable.ts            one table: channel, card_state, card_hand, actions, tick scheduling
 ├─ hooks/useCardLobby.ts            card_lobby every 20 s while on the hall
 └─ components/game/cards/*          CardTablePanel, TienLenBoard, CaoBoard, PokerBoard, CardHand,
                                     PlayingCard, SitDialog, RulesBook, CardSeatChip
lib/game/cards/                      pure: deck, tienlen, cao, poker (mirrors), state (parsers), rpc,
                                     messages (Vietnamese), rules (Sổ luật content)
lib/game/maps/hall.ts, hall-art.ts,  the corner: solids, interactables, props, floor, light string
  props.ts, types.ts
supabase/migrations/0017_v16_cards.sql
tests/fixtures/card-cases.json, tests/sql/v16-smoke.sql
```

**Data flow.** A player calls an action RPC. Postgres locks the table row, applies due timeouts, validates, applies, bumps `v` and answers `{changed, state, hand, coins}`. The caller applies it and broadcasts `cv`. Other subscribers fetch `card_state`, and `card_hand` only when `hand_no` changed and they hold a seat in the hand. When a deadline passes, seated clients call `card_tick`; the one that changed the table sends `cv`.

## 5. The corner (hall map)

The layout is approximate. The map tests pin the invariants and the plan fixes the pixels.

```
 x: 60        100        150        200       240
 y≈240  ┌──── sàn gỗ "Góc đánh bài" ─────────────┐ ◦ light pole (≈240, 250)
        │            [sign ♠♥] (≈156, 252)        │   light string → palm A's crown
 y≈282  │ [Tiến lên]                 [Poker]      │
        │  (≈98, 282)                (≈214, 282)  │
 y≈306  │            [Cào mat] (≈156, 306)        │
 y≈326  └──────────────────── river bank ─────────┘
```

- **Floor:** a plank deck with a rope edge, x ≈ 64–236, y ≈ 240–326, painted into the background by `paintCardCorner` in `hall-art.ts`.
- **Solids:** each table rect covers the table and its stools. Stools sit west, east and south; the north side stays open for the use spot.

| Id | Kind | Label | Prompt | Use spot |
|---|---|---|---|---|
| `cards_tienlen` | `card_table`, `game: "tienlen"` | Bàn Tiến lên | Vào bàn Tiến lên | ≈ (98, 266), facing down |
| `cards_cao` | `card_table`, `game: "cao"` | Chiếu Cào | Vào chiếu Cào | ≈ (156, 290), facing down |
| `cards_poker` | `card_table`, `game: "poker"` | Bàn Poker | Vào bàn Poker | ≈ (214, 266), facing down |
| `cards_sign` | `card_rules` | Góc đánh bài | Đọc Sổ luật | ≈ (156, 262), facing up |

- **Types (`lib/game/maps/types.ts`):** `InteractKind` gains `"card_table" | "card_rules"`; `Interactable` gains `game?: CardGame` (`"tienlen" | "cao" | "poker"`); `PropPlacement` gains `{ kind: "card_table"; x; y; game }`; the `sign` icon union gains `"cards"`.
- **Props:** three `card_table`, one `sign` with `icon: "cards"`, one new `lightpole`, and one `LIGHT_STRINGS` entry from palm A's crown (100, 128) to the new pole.
- **Classic seating:** the stand spot at (150, 280) moves into the yard (≈ (300, 300)).
- **Invariants (tests):** the tables do not overlap any solid or each other; every use spot is reachable from `HALL_SPAWN`, the dock arrival and the field arrival; the "Ra đồng" sign stays reachable; the moved stand spot is walkable.
- **Shell:** `onInteract` handles `card_table` (open that table's panel) and `card_rules` (open 📜 Sổ luật).
- **Labels:** `engine.setCardTables(labels)` draws one label above each table at device resolution, like name tags: `Tiến lên · 2/4 · 1.000`, `Poker · 5/6 · 500/1.000`, or `Trống`. The data comes from `card_lobby` (R27).

## 6. Tables, seats and money (all games)

### 6.1 Stakes and seats

- Each room has three `card_tables` rows, created lazily by the first `card_tick` or write (`_card_open`). A read before that shows an idle, empty table.
- **Stake S** ∈ {100, 1 000, 10 000}. The first player to sit at an empty table picks it; the empty-table reset unsets it (§6.3). Later players must send the current stake, otherwise `stake changed`.
- **Seats:** Tiến lên 1–4, Cào 1–6, Poker 1–6. One seat per account per room (R2).
- **Joining a hand:** a player who sits during a hand is dealt in at the next one.

| Game | To sit you need | Held per hand |
|---|---|---|
| Tiến lên | 10 S in the wallet | escrow 10 S |
| Cào | S in the wallet | a non-dealer escrows S; the dealer (n − 1) S; n = players in the hand, dealer included; 2 (n − 1) S in all |
| Poker | a buy-in of 50–200 BB (BB = S), moved to table chips | the chips on the table |

### 6.2 Money flows

- **Escrow (Tiến lên, Cào):**
  - At the deal, each dealt player's wallet pays its escrow E into `card_seats.escrow` (ledger `card_hold`, −E). Tiến lên: E = 10 S each. Cào: E = S for each non-dealer and (n − 1) S for the dealer, 2 (n − 1) S in all.
  - `card_seats.escrow` is the seat's live balance in the hand. Every line is applied when it becomes known: it moves `min(amount, E − paid)` from the payer's balance to the payee's, and `pub.players[seat].paid` tracks the payer's total against its cap (R14).
  - A seat is paid out once, with its balance (`card_settle`; no ledger row when it is 0), when its hand ends or when it leaves the hand. After that the seat is `settled`: lines to or from it are dropped.
  - Holding and payout each happen inside one transaction, under the wallet locks.
- **Buy-in and cash-out (Poker):** sitting moves the buy-in into `card_seats.chips` (`card_buyin`); standing up returns the chips (`card_cashout`); top-up (`pk_topup`) moves more, only between hands, up to 200 BB.
- **Zero-sum invariant:** for every table, Σ wallets + Σ escrow balances + Σ chips + Σ poker contributions in the live pot never changes during card calls. The smoke test asserts it after every step.
  - The only exceptions are outside card play: a wipe clears the cheater's own wallet, and an account deletion deletes that account's wallet. Both come after `_card_forfeit_all` has resolved its seats (§6.3).
- **Ledger `ref`:** `tl#<hand>`, `cao#<hand>`, `pk#<hand>`, short to keep rows small.

### 6.3 Leaving, idling, bans and deletions

**Leaving a live hand** (`_card_leave_seat`) is one operation, used by `card_leave`, by the timeout removal, by the sweep and by `_card_forfeit_all`. A player who is not in the live hand is paid out (Poker: the stack is cashed out; Tiến lên and Cào hold nothing between hands) and the seat is deleted at once. Otherwise:

| Case | At once | Until the hand ends |
|---|---|---|
| Tiến lên, still holding cards | the forfeit is settled (§7.4, R13) and the balance paid out | the seat stays `leaving` with `escrow = 0`; `pub.players[seat].out = "forfeit"` |
| Tiến lên, already out or cóng | the balance is paid out; later lines to the seat are dropped | `leaving`, `escrow = 0` |
| Cào, a player | they lose S to the dealer and are paid out (0) | `leaving`; their hand is left out of the showdown |
| Cào, the dealer | `card_leave` is refused during `peek` (`dealer busy`, R35). The sweep and `_card_forfeit_all` cancel the hand instead: every seat is paid its balance, and `last` says "Ván huỷ". | — (the hand is over) |
| Poker | they fold; the uncommitted stack returns to the wallet (`card_cashout`); committed chips stay in the pot as dead money (§9.2) | `leaving`, `chips = 0`, `missed` unchanged (2 after timeouts); `pub.players[seat]` has `fold: true` and `last: "left"` or `"timeout"` |

- **The leaving row:** it is deleted when the hand ends. Until then it keeps the seat taken and still counts as its account's one seat in the room (R2). The unique index covers `leaving` rows, so `card_sit` at any table of the room, this one included, is refused with `still leaving` until the hand ends. `_card_forfeit_all` deletes the row at once instead.
- **Timeouts:** two consecutive timeouts in Tiến lên or Poker remove the player exactly as `card_leave` would. A real action resets `missed`. The Cào dealer's two consecutive missed deals remove the dealer once that hand has settled.
- **Idle (R28):** a seat whose owner made no card call for 60 s is not dealt in and is stood up at the next deal. Every card RPC by the owner refreshes `seen_at` (reads with a separate cheap update, at most every 10 s). An open client polls at least every 15 s, so only a closed or crashed client goes stale.
- **The sweep** (`card_tick` and every write, under the table lock) applies the leave operation to accounts that are no longer members of the room and to banned accounts. They all leave together, so none of them pays another (R13). A banned player receives nothing more from the hand (anti-cheat R10).
- **`_card_forfeit_all(p_account)`** runs before a wipe and before an account deletion:
  1. with the account's wallet already locked (the wallet comes first, as anti-cheat R16 orders), it locks every table where the account holds a seat, in table-id order (`room_id`, `game`);
  2. it applies the leave operation to each of those seats;
  3. it deletes those seat rows at once, and resets any table left empty.
  - **Wipes:** the re-created `_ac_wipe` calls it first; the wallet is then cleared as the anti-cheat spec says. The only xu destroyed is the cheater's own balance, never a pot share or another player's escrow.
  - **Account deletion:** a BEFORE DELETE trigger on `accounts` (`_card_accounts_bd`) takes `_wallet_lock(old.id)` and calls it, for every deletion path (`admin_delete_account`, the SQL editor). The account's own wallet is then deleted with it.
- **Room deletion:** a BEFORE DELETE trigger on `rooms` (`_card_rooms_bd`) calls `_card_room_gone`. It locks the room's three tables in table-id order and runs the sweep's first step, so banned accounts and non-members leave as at any sweep. Then it cancels every live hand. Nobody else forfeits, because nobody chose to leave, and forfeiting everyone at once would move xu by deletion order.
  - Tiến lên and Cào: every seat is paid its balance; lines already applied stand.
  - Poker: every live-pot contribution returns to its contributor (`card_refund`), then every stack. The contributions of banned or deleted accounts are dead money: they are split equally among the seats still live, with the odd xu from the button (§9.1).
  - Then the seats go.
- **A poker hand that one sweep empties:** the sweep can take out every live player at once. The hand then ends without a winner, and `_pk_refund` applies the room-deletion rule:
  - Each contribution goes back to its contributor: to the stack while the seat is still theirs, else to the wallet (`card_refund`).
  - Banned and deleted accounts get nothing back, and their wallets are never touched, so a wipe's deleted wallet is never re-created.
  - Their dead money is split equally among the seats that sweep took out while still in the hand and in good standing, with the odd xu from the button.
  - A seat that folded earlier gets only its own chips back, having given up its claim to the pot.
  - With no such seat, the dead money is lost with the banned or deleted accounts' other xu. No player in good standing loses xu either way.
  - Known edge case: an account wiped and then pardoned within the same hand, before it ends this way, gets its own contribution back.
- **Empty-table reset (R36):** when the last seat row of a table is deleted, the same transaction resets the table:
  - `first_game = true`;
  - `lead_id`, `pos`, `turn`, `deadline`, `pub` and `last` are cleared, and the stake is unset;
  - `v` and `seq` are bumped, and `phase = 'idle'`.

  `hand_no` keeps counting, so hand numbers stay unique.

### 6.4 Cards, shuffle and privacy

- **Encoding:** a card is an integer `c` in 0–51; `r = c / 4` (0–12 = 3 4 5 6 7 8 9 10 J Q K A 2) and `s = c % 4` (0 ♠, 1 ♣, 2 ♦, 3 ♥). In Tiến lên a higher `c` is a stronger card. Poker and Cào map `r` to their own orders (§8, §9).
- **Shuffle:** Fisher–Yates over 0–51. `_card_rand(n)` draws 4 bytes from `extensions.gen_random_bytes` and rejects values ≥ 2³² − (2³² mod n), so there is no modulo bias. No seed is stored.
- **Private:** `card_hands` (every hand), `card_secrets` (the poker board), `card_log`. `card_hand` returns only the caller's own row. Hidden cards never appear in `card_state`:
  - poker hole cards are shown only at showdown;
  - Cào hands are shown at the showdown;
  - Tiến lên hands show their counts; at the end the cards still held are shown (they decide thối).

## 7. Tiến lên miền Nam

### 7.1 Cards and combinations

- **Order:** 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 (heo). Within a rank: ♠ bích < ♣ chuồn < ♦ rô < ♥ cơ. 3♠ is the lowest card, 2♥ the highest.
- **Deal:** 13 cards each. With 2–3 players the rest stays undealt.
- **Combinations** (`key` = the highest card; `len` = cards for sảnh, pairs for đôi thông):

| Type | Vietnamese | Rule |
|---|---|---|
| `single` | Rác | 1 card |
| `pair` | Đôi | 2 cards of one rank |
| `triple` | Sám cô | 3 cards of one rank |
| `quad` | Tứ quý | 4 cards of one rank |
| `straight` | Sảnh | ≥ 3 cards of consecutive ranks, no 2, suits mixed |
| `pairs` | Đôi thông | ≥ 3 pairs of consecutive ranks (exactly 2 cards per rank), no 2 |

- A **bomb** (hàng) is a `quad` or a `pairs`. A **heo combination** is a single 2 or a pair of 2s.

### 7.2 Beating and cutting (chặt)

`beats(top, x)` holds when:
1. **Same type:** `x.type = top.type`, the same `len` for `straight` and `pairs`, and `x.key > top.key`; or
2. **Bomb rules:**

| x | beats |
|---|---|
| 3 đôi thông | a single 2 |
| Tứ quý | a single 2, a pair of 2s, any 3 đôi thông |
| 4 đôi thông | a single 2, a pair of 2s, any 3 đôi thông, any tứ quý |

- A triple of 2s cannot be beaten (only 5 đôi thông could, and it never reaches play: it is tới trắng).
- **Cutting (chặt):** a bomb beating a heo combination or another bomb. A 2 over a lower 2 is not a cut.
- **Values** (units of S): 2♠ or 2♣ ½; 2♦ or 2♥ 1; a pair of 2s the sum of both; 3 đôi thông 1½; tứ quý 2; 4 đôi thông 3.
- **The chain:** each cut adds the value of the combination just cut: `chain = {h, victim, cutter, void}`. The first cut starts it with the value of the cut 2s. When the round closes, `victim` pays `cutter` the whole chain (R7), unless `void` (the victim went out with the cut combination, R8).
- **Out of turn (R9):** any player with cards except the top's owner may play a 4 đôi thông at any moment, even after passing, if it beats the top. Nothing else may be played out of turn.

### 7.3 Flow of a game

Seats play in ascending seat order; the panel draws them counter-clockwise. The public state is in §11.4. The engine:

```
deal(deck):                                     (§7.6: at the countdown or result deadline)
  lock the candidates' wallets in account-id order, then decide with the locked balances:
  eligible := seats not leaving, seen ≤ 60 s, wallet ≥ 10 S; stand up the others; if < 2 → idle
  hold 10 S each; hand_no += 1; deal 13 each in seat order
  first := first_game or lead_id is not dealt in             (pub.first; R15)
  leader := first ? holder of the lowest dealt card : seat of lead_id
  if some hands are tới trắng → trang(); else turn := leader; must := first ? that lowest card : null

trang():   w := the winning hand (§7.4); each other player pays w 2 S; every seat is paid out
  first_game := true; lead_id := null          -- the next deal is a first game: lowest card, must
  phase := result; deadline := now + 8 s       (no places; end_game() is not called)

play(s, cards):         cards ⊂ hand(s); x := combo(cards) ≠ null
  if s = turn:  top = null ? (must = null or must ∈ cards) : beats(top, x)
  else:         x is 4 đôi thông, top ≠ null, top.seat ≠ s, beats(top, x)
  if top ≠ null and top is heo or bomb and x is bomb:
      chain := {h: (chain.h or 0) + value(top), victim: top.seat, cutter: s, void: top.done}
  remove cards; played(s) := true; passed −= {s}; must := null
  top := {seat: s, …x, done: count(s) = 0}
  if count(s) = 0 → go_out(s);   if active ≤ 1 → end_game(); else advance(s)

pass(s):   s = turn and top ≠ null (the leader cannot pass);  passed += {s};  advance(s)

advance(from):   cand := active ∖ {top.seat} ∖ passed
  cand = ∅ → close_round();  else turn := first of cand after `from`; deadline := now + 20 s

close_round():   if chain and not chain.void → line(victim → cutter, chain.h, 'chat')
  chain := null; passed := ∅; pile := []
  turn := top.seat if active, else the first active seat after it ("hưởng sái"); top := null

timeout():       s := turn; missed(s) += 1
  if missed(s) ≥ 2: forfeit({s}); return      -- terminal: s never plays or passes after this
  if top = null: play(s, [lowest card of s]) else pass(s)

forfeit(F):      -- the leave operation for the seats F still holding cards (§6.3); one sweep = one F
  out(s) := forfeit for every s in F          -- F leave together, so they never pay each other
  for each s in F: settle its forfeit (§7.4; nobody becomes cóng), pay out s, mark the seat leaving
  if active ≤ 1 → end_game()
  elif turn ∈ F → advance(turn)               -- re-evaluates from there; F is no longer active
```

- **Active** = dealt, still holding cards, neither cóng nor forfeited.
- **`go_out(s)`:** s takes the next place from the top (1, 2, …). At the first go-out, every active player who has played nothing becomes **cóng**: each pays nhất 2 S + thối at once and stops playing (R11). This is the only place cóng is evaluated; a forfeit never triggers it.
- **`end_game()`:**
  - **Places:** the finishers in order, then the one active player left (if any), then the cóng players. Several cóng players take the bottom places in reverse turn order counted from nhất: the cóng player farthest from nhất in turn order is bét (R11). Forfeiters have no place.
  - A pending chain closes as in `close_round`, and the end lines follow (§7.5).
  - Then `phase = result`, `lead_id` = nhất, `first_game = false`, and the deadline is now + 8 s. The `leaving` rows are deleted, and a table left empty resets (§6.3).

### 7.4 Tới trắng, cóng, thối, forfeits

- **Tới trắng** is checked on every hand at the deal, in this order (R10):
  1. **Sảnh rồng:** one card of every rank 3 → A.
  2. **5 đôi thông:** 5 consecutive ranks (no 2) with ≥ 2 cards each.
  3. **Tứ quý heo:** all four 2s.
  4. **6 đôi:** Σ over ranks of ⌊count / 2⌋ ≥ 6 (a tứ quý counts as 2 pairs).

  The highest pattern wins; the same pattern goes to the first in turn order from the leader. Each other player pays the winner 2 S with no thối. The winner's cards are shown. `trang()` (§7.3) sets `first_game = true` and clears `lead_id`, so the next deal picks the leader and `must` from the lowest dealt card, as in a first game (R15).
- **Cóng** (R11): pays nhất 2 S plus the thối of the whole hand, at the first go-out. It is evaluated only when a player finishes, never at a forfeit. The bottom places follow reverse turn order from nhất (§7.3 `end_game`).
- **Thối** (R12) is the value of the cards still held:
  - each 2 (½ S black, 1 S red);
  - each tứ quý of a non-2 rank (2 S);
  - then, over the remaining ranks below 2, each maximal run of ≥ 3 consecutive ranks holding ≥ 2 cards: 3 ranks 1½ S, 4 or more ranks 3 S (a run of 5 would have been tới trắng at the deal, so it cannot occur).
- **Forfeit** (R13, the same rule word for word): a forfeit is settled at once, within the cap:
  1. an open chain whose victim is the forfeiter closes and the forfeiter pays it; one whose cutter is the forfeiter is dropped;
  2. the forfeiter pays 1 S to each other active player still in the game, whatever their card count, in turn order;
  3. then the thối of their own hand to the next of them in turn order.

  A forfeit never makes anyone cóng: cóng is evaluated only when a player finishes. A line whose recipient is gone or leaving is not paid: it stays in the forfeiter's escrow and is refunded. Seats removed by the same sweep leave together, so they never pay each other. The forfeiter takes no place; the others finish as a smaller game.

  The forfeiter's cards are shown in `last.hands`. The smaller game settles as in §7.5.

### 7.5 Settlement

**Lines are applied as they occur** (§6.2), in the order of these events:
1. a cut chain, when its round closes (§7.2);
2. the cóng lines, at the first go-out: each cóng player → nhất, 2 S + thối;
3. a forfeit's lines, at the forfeit (§7.4);
4. at the end:
   1. a pending chain;
   2. place payments among the m placed players (those dealt, minus the forfeiters), skipped for a cóng payer, whose 2 S replaces them:
      - m = 4: 4th → 1st 1 S, 3rd → 2nd ½ S;
      - m = 3: 3rd → 1st 1 S;
      - m = 2: 2nd → 1st 1 S;
      - m = 1: nothing;
   3. the thối of the player still holding cards → the player placed just above. If nobody went out because everyone else forfeited, the survivor is 1st and pays nothing.

**The cap (R14):** a line moves at most what is left of the payer's 10 S. The line that crosses the cap is paid in part, and later ones not at all. Lines to or from a settled seat are dropped. Every seat still at the table is paid its balance at the end.

**Example 1** (stake 1 000; A, B, C, D):
- **The cuts:** in one round D plays 2♥. B cuts it with 3 đôi thông (chain 1 000). C cuts B with tứ quý (chain 1 000 + 1 500 = 2 500). Everyone passes, so B pays C 2 500.
- **The end:** A 1st, B 2nd, C 3rd, D 4th. D still holds 2♠, so D pays thối 500 to C.
- **Place payments:** D → A 1 000; C → B 500.

| Player | A | B | C | D |
|---|---|---|---|---|
| Net | +1 000 | −2 500 + 500 = −2 000 | +2 500 − 500 + 500 = +2 500 | −1 000 − 500 = −1 500 |

The sum is 0.

**Example 2 (cóng)** (stake 1 000):
- A goes out first; D has played nothing, so D is cóng.
- D holds 2♦ and four 9s, so its thối is 1 000 + 2 000. D pays A 2 000 + 3 000 = 5 000.
- B and C play on: B goes out, and C (3rd) pays B 500.
- **Net:** A +5 000, B +500, C −500, D −5 000.

**Example 3 (tới trắng)** (stake 1 000): C is dealt 6 pairs. A, B and D each pay 2 000, so C gets +6 000.

**Example 4 (forfeit)** (stake 1 000; turn order A, B, C, D):
- A has gone out. D leaves while holding 2♥, with B and C still holding cards.
- D pays B and C 1 000 each, and the thối of 2♥ (1 000) to B, the next of them after D. D is paid out 10 000 − 3 000.
- B and C finish as a 3-player game (A, B, C): B goes out, and C (3rd) pays A 1 000.
- **Net:** A +1 000, B +2 000, C 0, D −3 000.

### 7.6 State machine

```
idle ──2nd eligible seat──▶ countdown (8 s) ──deadline──▶ deal ──tới trắng──▶ result (8 s)
  ▲                                                         │ no
  │                                                         ▼
  └──< 2 eligible── result (8 s) ◀──active ≤ 1── playing (turn 20 s: play | pass | 💣 | timeout)
                        └──deadline, ≥ 2 eligible──▶ deal
```

## 8. Cào (ba cây, "cào cái")

### 8.1 Rules

- **Deck and deal:** 52 cards, 3 cards each.
- **Points:** A = 1, 2–9 their number, 10/J/Q/K = 10. **Nút** = the total mod 10: 9 is the best and 0 is "bù".
- **Classes, high to low (R18):**
  1. **Sáp:** three cards of one rank. The higher rank wins: K > Q > J > 10 > … > 2 > A.
  2. **Ba tây:** three face cards (J/Q/K in any mix) that are not a sáp.
  3. **Nút:** 9 down to 0.
- **Comparing two hands:**
  - the class decides first;
  - two sáp compare their ranks;
  - within ba tây, or within equal nút, the top card of each hand decides (R19): its rank in the order K > Q > J > 10 > … > 2 > A, then its suit in the order ♦ > ♥ > ♣ > ♠.

  Two hands never share a card, so a winner always exists.
- **Card key for comparisons:** `cao_rank × 4 + cao_suit`, where `cao_rank` is A = 1, 2–10 = the number, J = 11, Q = 12, K = 13, and `cao_suit` is ♠ 0, ♣ 1, ♥ 2, ♦ 3.

### 8.2 Flow

```
idle ─2 seats─▶ deal_wait (dealer; 15 s) ─"Chia bài" or timeout─▶ peek (15 s) ─deadline─▶ result (6 s) ─▶ deal_wait (next dealer)
```

- **The dealer (cái) shown during `deal_wait`** is a preview: the next seat after the previous dealer that looks able to cover (n − 1) S. The first dealer of a table is the first seat to sit. Only the previewed dealer may press "Chia bài".
- **`cao_deal`** (the previewed dealer) or the timeout:
  1. locks the seated players' wallets in account-id order;
  2. with the locked balances, rebuilds the players: seats seen, not leaving, with a wallet ≥ S; the others are stood up;
  3. rebuilds the dealer: the first player from the previewed dealer on whose wallet covers (n − 1) S, with n = the players including the dealer; the others are skipped as dealer (R20);
  4. goes to `idle` if fewer than 2 players remain, or if nobody can deal (noting "Chưa ai đủ xu làm cái");
  5. holds S from each non-dealer and (n − 1) S from the dealer, 2 (n − 1) S in all, and deals 3 cards each.

  A timeout adds a miss to the previewed dealer; a dealer with 2 consecutive misses is stood up once that hand settles.
- **Peek:** every player sees only their own cards. "Nặn bài" flips them one by one on the player's own screen; it needs no RPC.
- **Leaving during `peek`** (§6.3): a non-dealer loses S to the dealer at once. The dealer cannot leave (`dealer busy`), but a dealer removed by the sweep or `_card_forfeit_all` cancels the hand.
- **Showdown** (the peek deadline, applied by a tick): every hand still in play is compared with the dealer's. All hands become public in `last`.

### 8.3 Settlement

- Each non-dealer p against the dealer: the loser pays the winner S. The dealer's net is the sum. With n players, the escrows are S per non-dealer and (n − 1) S for the dealer, 2 (n − 1) S in all, which covers every outcome.
- **Example** (stake 1 000; n = 5; dealer B escrows 4 000, and A, C, D and E 1 000 each, 8 000 in all):

| Seat | Cards | Hand | Against B (K♦ 5♠ 3♣ = 8 nút, top K♦) |
|---|---|---|---|
| A | 9♠ 8♣ 2♥ | 9 nút | wins +1 000 |
| C | J♠ Q♥ K♣ | ba tây | wins +1 000 |
| D | 4♦ 4♣ 4♠ | sáp 4 | wins +1 000 |
| E | 7♥ 10♣ A♦ | 8 nút, top 10♣ | K♦ is higher: loses −1 000 |

B's net is −3 000 + 1 000 = −2 000, and B gets 2 000 of its 4 000 back.

## 9. Poker (Texas Hold'em, no-limit)

### 9.1 Rules

- **Hand ranking** (the best 5 of 7 cards; suits never break ties):
  1. Thùng phá sảnh (straight flush; the ace-high one is the royal flush);
  2. Tứ quý;
  3. Cù lũ;
  4. Thùng;
  5. Sảnh (the ace plays high, or low in A-2-3-4-5);
  6. Sám;
  7. Thú (two pair);
  8. Đôi;
  9. Mậu thầu (high card).
- **Evaluator key** (compared lexicographically; ranks 2 … 14 with A = 14, 5 for the wheel's top):

| Hand | Key |
|---|---|
| Straight flush | `[8, top]` |
| Quads | `[7, quad, kicker]` |
| Full house | `[6, trips, pair]`; with two trips, the higher is the trips |
| Flush | `[5, the flush suit's top 5 ranks]` |
| Straight | `[4, top]` |
| Trips | `[3, trips, k1, k2]` |
| Two pair | `[2, high, low, kicker]`; with three pairs, the best other card is the kicker |
| Pair | `[1, pair, k1, k2, k3]` |
| High card | `[0, r1…r5]` |

- **Blinds:** SB = S/2 and BB = S. With 3+ players the SB is the seat after the button and the BB the next. **Heads-up:** the button posts the SB, acts first preflop and last after (TDA). A short stack posts all it has; the amount to call stays the full BB.
- **Streets:** preflop, then the flop (3 cards), the turn (1) and the river (1). Preflop starts left of the BB (heads-up: the button); later streets start with the first live seat left of the button.
- **Actions** (`raise` = the size of the last full bet or raise this street, starting at BB):

| Action | Allowed when | Amount |
|---|---|---|
| `fold` | always on your turn | — |
| `check` | nothing to call | — |
| `call` | something to call | min(to call, stack); all-in if short |
| `bet` | nothing bet this street | to X, BB ≤ X ≤ stack (less than BB only all-in) |
| `raise` | a bet exists and you may raise | to X, cur + raise ≤ X ≤ bet + stack (less only all-in) |
| `allin` | always; above the call only if you may raise | to bet + stack |

- **Re-opening (TDA 47):** a player may raise if they have not acted this street, or if `cur − acted_level ≥ raise`, where `acted_level` is the bet level they last acted at. A short all-in raises `cur` without changing `raise`, so it does not re-open raising for players who already acted.
- **Showdown:** every live hand is shown (R21). Pots are split among the best hands. The odd xu goes one at a time to the winners in seat order, starting left of the button (TDA 20).

### 9.2 Engine

```
deal:  players := seats with chips > 0, seen, not leaving (≥ 2 else idle)
  button := the next player after pos (first hand: a random player); pos := button
  post blinds; cur := BB; raise := BB; deal 2 each; board := the next 5 cards → card_secrets
  every non-all-in player pending; acted := null; turn per §9.1; deadline := now + 30 s
act(p, a, X):  validate §9.1; apply; pending(p) := false; acted(p) := cur after the action
  full bet/raise (increment ≥ raise, or a bet ≥ BB): raise := increment; every other live non-all-in → pending
  short all-in above cur: every other live non-all-in whose bet < X → pending
  one player not folded → award all pots (uncontested, no cards shown); result (3 s)
  no one pending → street_end();  else turn := the next pending seat after p
street_end:  uncalled := top bet − the second-highest bet this street (folded bets count)
  return it to its owner if still live; a folded owner's (one who left) stays in as dead money
  live non-all-in ≤ 1 → reveal the rest of the board, showdown
  else next street: bets := 0; cur := 0; raise := BB; pending := live non-all-in; acted := null
timeout:  missed += 1
  missed ≥ 2 → leave(turn), exactly as card_leave in a live hand (§6.3); stop
  else check if nothing to call, else fold
leave(p):  fold p, even out of turn; the stack → wallet; `put` stays (§6.3)
  then the checks after an act; the turn moves on only if it was p's
```

- **Pots** are built from `put`, each seat's total in the hand, folded seats included.
  - The levels are each live all-in total, plus the highest live total.
  - For each level L: `pot = Σ (min(put, L) − min(put, previous level))`, and it is eligible to the live seats with `put ≥ L`.
  - Pots with the same eligible seats merge.
  - The top pot also takes every folded chip above the highest live total (a player who left while holding the top bet), so every committed chip lands in a pot.
  - When no live seat has put anything (both blinds stood up before the button acted), there is no level: every chip put in forms one pot, eligible to the live seats. So while a seat is live, the pots always hold every chip put in.
- **After the hand:** `result` lasts 6 s (3 s when uncontested), then the next deal. A seat with 0 chips may top up during `result`; if it has still 0 at the deal, it is stood up.

### 9.3 Examples

**Side pot** (blinds 500/1 000):
- **Stacks:** A (button) 60 000, B (SB) 8 000, C (BB) 40 000.
- **Preflop:** A raises to 3 000; B moves all-in for 8 000 (a full raise, +5 000); C calls 8 000; A calls.
- **Flop:** C bets 10 000; A calls. **Turn and river:** both check.
- **Pots:** the main pot is 24 000 (A, B, C); the side pot is 20 000 (A, C).
- **Showdown:** B wins the main pot, A beats C for the side pot.
- **Net:** B +16 000, A +2 000, C −18 000.

**Short all-in:** on the flop A bets 4 000, B moves all-in for 5 000, and C calls 5 000. A faces only 1 000 more, less than a full raise of 4 000, so A may call or fold but not raise.

**Odd chip:** a 3 001 pot split two ways pays 1 500 each, plus 1 to the winner first left of the button.

### 9.4 State machine

```
idle ─2 seats with chips─▶ countdown (5 s) ─▶ preflop ─▶ flop ─▶ turn ─▶ river ─▶ result (6 s | 3 s) ─▶ deal
                                        one player left or all-in run-out: straight to result
```

## 10. Timers

| Game | Timer | Length | When it expires |
|---|---|---|---|
| Tiến lên | countdown (the 2nd seat sat) | 8 s | deal |
| Tiến lên | turn | 20 s | leading: play the lowest single card; else pass; a 2nd miss in a row forfeits |
| Tiến lên | result | 8 s | next deal |
| Cào | deal_wait (dealer) | 15 s | auto-deal; the dealer's miss counts |
| Cào | peek | 15 s | showdown |
| Cào | result | 6 s | the next dealer's deal_wait |
| Poker | countdown | 5 s | deal |
| Poker | action | 30 s | check if nothing to call, else fold; a 2nd miss in a row removes the player exactly as `card_leave` does (§6.3) |
| Poker | result | 6 s (3 s uncontested) | next deal |
| all | unseen | 60 s without a card call | not dealt in; stood up at the next deal |

- **One deadline field:** the table stores a single `deadline`, used for the turn or the phase.
- **Lazy application:** `card_tick` and every write RPC take the table lock and run `_card_sweep` first, which applies every due step. Each applied step sets its next deadline from `p_now`, so a long silence costs at most one step per call.
- **Reads never sweep (R37):** `card_lobby`, `card_state` and `card_hand` return the stored state, even past its deadline. The client sees `deadline < serverNow()` and calls `card_tick`.
- **Client ticks:** a seated client calls `card_tick` at `deadline + 300 ms + 200 ms × its index among the seated players`; spectators add 3 s. A new state cancels the pending tick.

## 11. Server — `0017_v16_cards.sql`

### 11.1 Tables

All five tables: RLS on, no policies, `revoke all … from anon, authenticated`. The public/private split is enforced by the RPCs.

| Table | Columns | Exposed |
|---|---|---|
| `card_tables` (PK `room_id, game`) | `stake` (null / 100 / 1000 / 10000), `v` bigint (every visible change), `seq` int (every game action), `hand_no`, `phase`, `turn`, `deadline`, `pos` (button or dealer), `lead_id` (Tiến lên's last nhất), `first_game`, `pub` jsonb, `last` jsonb | all of it, through `card_state` |
| `card_seats` (PK `room_id, game, seat`; unique `room_id, account_id`, `leaving` rows included, R2) | `account_id`, `chips`, `escrow` (≥ 0), `leaving`, `missed`, `seen_at`, `sat_at` | seat, id, name, chips, escrow, leaving |
| `card_hands` (PK `room_id, game, hand_no, seat`) | `account_id`, `dealt int[]`, `cards int[]` (cards still held) | only to the owner, through `card_hand` |
| `card_secrets` (PK `room_id, game, hand_no`) | `board int[]` (poker's 5 cards, dealt at the start) | never; revealed street by street into `pub.board` |
| `card_log` | `id`, `room_id`, `game`, `hand_no`, `account_id`, `seat`, `action`, `detail jsonb`, `at` | never; purged after 14 days (up to 500 rows per deal) |

- **Foreign keys:** `card_seats`, `card_hands` and `card_secrets` reference `card_tables` with `on delete cascade`, and `card_tables` references `rooms` with `on delete cascade`. `card_seats.account_id` references `accounts` with `on delete cascade`.
- **No foreign key** on `card_hands.account_id` or `card_log.account_id`: a hand row goes at the table's next deal, and the log keeps the id as evidence until its 14-day purge.
- **The cascades are only a backstop.** The BEFORE DELETE triggers resolve and remove the card rows first (§6.3): `_card_rooms_bd` on `rooms` and `_card_accounts_bd` on `accounts`.
- **Missing rows:** the three `card_tables` rows of a room are created by `_card_open` (tick and writes). A read of a table with no row yet returns an idle, empty table.
- **Old hands:** each deal deletes the table's older `card_hands` and `card_secrets` rows. The log keeps the deal.
- **`coin_ledger`:** the reason check is re-created with the list in force after `0016` (which already includes `'wipe'`), plus `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`. The plan copies `0016`'s list verbatim.

### 11.2 Private helpers (revoked from `public`, `anon`, `authenticated`)

| Helper | Purpose |
|---|---|
| `_card_max(game)` | 4 / 6 / 6 |
| `_card_init(room)`, `_card_open(room, game)` | create the 3 rows; lock one `for update` (tick and writes only) |
| `_card_rand(n)`, `_card_shuffle()` | the unbiased crypto shuffle (§6.4) |
| `_card_sweep(room, game, p_now, p_deck default null)` → bool | under the table lock: non-members and banned accounts (the leave operation), due timeouts, deals (§6.3, §10); true if it changed anything |
| `_card_view(room, game, p_now)` | the `card_state` JSON, built in one statement (one snapshot, no writes) |
| `_card_hand(room, game, account)`, `_card_touch(…)` | the caller's cards; the separate `seen_at` update |
| `_card_bump(room, game, p_action)` | `v += 1`, and `seq += 1` for game actions |
| `_card_line(room, game, from, to, amount, why)` | apply one line within the payer's cap; dropped if either seat is settled (§6.2) |
| `_card_payout(room, game, seat, p_reason)`, `_card_settle(room, game)` | pay one seat its balance or stack and mark it settled; pay every unsettled seat at the hand's end (wallets locked in account-id order) |
| `_card_leave_seat(room, game, seat, p_how, p_now)` | the leave operation (§6.3); `p_how` is `leave`, `timeout`, `sweep` or `forfeit_all` |
| `_card_reset_if_empty(room, game)` | the empty-table reset (R36) |
| `_card_forfeit_all(p_account)` | lock the account's tables in table-id order and leave every seat (§6.3) |
| `_card_room_gone(p_room)` | lock the room's tables in order, run the sweep's first step, cancel every live hand, refund, delete the seats (§6.3) |
| `_tl_combo(int[])`, `_tl_beats(jsonb, jsonb)`, `_tl_value(jsonb)`, `_tl_thoi(int[])`, `_tl_trang(int[])` | pure, `immutable`, mirrored in TS |
| `_tl_deal`, `_tl_do_play`, `_tl_do_pass`, `_tl_timeout`, `_tl_end` | the §7.3 engine |
| `_cao_eval(int[])`, `_cao_cmp(jsonb, jsonb)` | pure, mirrored |
| `_cao_start`, `_cao_do_deal`, `_cao_showdown` | the §8.2 engine |
| `_pk_eval(int[])` → `int[]`, `_pk_pots(jsonb)` | pure, mirrored |
| `_pk_deal`, `_pk_do_act`, `_pk_street_end`, `_pk_showdown` | the §9.2 engine |
| `_card_rooms_bd()`, `_card_accounts_bd()` | the BEFORE DELETE trigger functions on `rooms` and `accounts`; they call `_card_room_gone(old.id)` and `_card_forfeit_all(old.id)` (after `_wallet_lock(old.id)`) |

### 11.3 Public RPCs

All are SECURITY DEFINER with `set search_path = public, extensions` and an explicit `grant execute … to anon, authenticated`.

- **Membership first (R38):** every card RPC starts with the room-membership check `_auth(p_room_id, p_session_token, 'any')` from 0004, before any table, seat or hand is read.
  - The reads call it directly.
  - `card_tick` and `card_leave` call it through `_farm_auth`.
  - The six guarded RPCs call it through `_ac_play` → `_farm_auth`.

  A non-member gets `account is not a member of this room` (42501), and a bad token `invalid session`.
- **Reads** are non-mutating snapshots, apart from the separate `seen_at` touch (R37).
- **`card_tick` and every write** lock the table row (`_card_open`), run `_card_sweep`, then act.

| RPC | Auth, locking | Returns |
|---|---|---|
| `card_lobby(p_room_id uuid, p_session_token text)` | `_auth(…, 'any')`; snapshot | `{server_now, tables: [{game, stake, phase, max, seats: [{seat, id, name}]}]}` |
| `card_state(p_room_id uuid, p_session_token text, p_game text)` | `_auth(…, 'any')`; snapshot + `seen_at` touch | the state (§11.4) |
| `card_hand(p_room_id uuid, p_session_token text, p_game text)` | `_auth(…, 'any')`; snapshot + `seen_at` touch | `{server_now, game, hand_no, seat, cards}` (`cards: []` when not in the hand) |
| `card_tick(p_room_id uuid, p_session_token text, p_game text)` | `_farm_auth`, allowlisted (R31); lock + sweep | `{changed, state}` |
| `card_leave(p_room_id uuid, p_session_token text, p_game text)` | `_farm_auth`, allowlisted (R31); lock + sweep | the action answer; `not seated`, or `dealer busy` for the Cào dealer during `peek` |
| `card_sit(p_room_id uuid, p_session_token text, p_game text, p_seat integer, p_stake integer, p_buyin integer)` | `_ac_play`; lock + sweep | the action answer |
| `pk_topup(p_room_id uuid, p_session_token text, p_amount integer)` | `_ac_play`; lock + sweep | the action answer |
| `tl_play(p_room_id uuid, p_session_token text, p_seq integer, p_cards integer[])` | `_ac_play`; lock + sweep | the action answer |
| `tl_pass(p_room_id uuid, p_session_token text, p_seq integer)` | `_ac_play`; lock + sweep | the action answer |
| `cao_deal(p_room_id uuid, p_session_token text, p_seq integer)` | `_ac_play`; lock + sweep | the action answer |
| `pk_act(p_room_id uuid, p_session_token text, p_seq integer, p_action text, p_amount integer)` | `_ac_play`; lock + sweep | the action answer |

- **The action answer:** `{changed: true, state, hand, coins}`, where `coins` is the caller's wallet after the action. The HUD also reloads the fishing state, as the farm does.
- **Guarded RPCs** (the six `_ac_play` ones) join the anti-cheat D2 lock list, so a locked account gets `account locked` from them. WARN_LOCK gains "đánh bài".
- **The guard allowlist** gains `card_lobby`, `card_state`, `card_hand`, `card_tick` and `card_leave`. The dynamic loop in `anticheat-guards.sql` gains the six guarded RPCs.
- **`card_sit`** checks, in order:
  1. the hard checks (§11.5);
  2. `still leaving` (a `leaving` row of this account anywhere in the room), then `already seated` (this room), then `table full`, then `seat taken`;
  3. `stake changed` (a non-empty table whose stake differs), otherwise the stake is set;
  4. `not enough coins` (§6.1);
  5. the buy-in moves (poker).

  With a new second eligible seat, it starts the countdown (Tiến lên, Poker) or `deal_wait` (Cào).

### 11.4 The state (`card_state`)

```jsonc
{
  "server_now": "…", "game": "tienlen", "stake": 1000, "max": 4,
  "v": 812, "seq": 377, "hand_no": 41, "phase": "playing", "turn": 3, "deadline": "…",
  "seats": [{ "seat": 1, "id": "…", "name": "Dat", "chips": 0, "escrow": 10000, "leaving": false }],
  "pub": { /* per game, below */ },
  "last": { /* the last hand's result, below */ } | null
}
```

| Game | `pub` | `last` |
|---|---|---|
| Tiến lên | `first`, `must` (card or null), `order`, `players: {seat: {id, n, played, out: null\|"done"\|"cong"\|"forfeit", place, paid, settled}}`, `top: {seat, type, len, key, cards, done}`, `passed`, `pile` (this round's plays, ≤ 8), `chain: {h, victim, cutter, void}`, `lines` (the lines applied so far) | `hand_no`, `trang: {seat, pattern, cards}\|null`, `places`, `out`, `hands` (cards still held, forfeiters' included), `lines: [{from, to, xu, paid, why: "bet"\|"ba"\|"chat"\|"thoi"\|"cong"\|"trang"\|"forfeit"}]`, `net` |
| Cào | `dealer`, `order`, `left` (players who left and lost S) | `hand_no`, `dealer`, `cancelled` (the dealer was removed), `hands: {seat: {cards, kind: "sap"\|"ba_tay"\|"nut", points}}`, `lines`, `net` |
| Poker | `button`, `sb`, `bb`, `street`, `board`, `cur`, `raise`, `pot`, `players: {seat: {id, bet, put, fold, allin, acted, pending, last}}` | `hand_no`, `board`, `shown: {seat: [c, c]}`, `pots: [{xu, seats, winners, hand}]`, `net`, `uncontested` |

- Every `players` entry carries the account id, so a newcomer sitting in the same seat mid-hand is never mistaken for the player who left.
- Amounts in `pub.chain`/`pub.lines` are in half-stakes (`h`); `last.lines` are in xu.

### 11.5 Errors and the anti-cheat

**Hard signals** (strike-eligible; each returns the envelope with its `error`; checked right after `_ac_play`, before any lock):

| Code | RPCs | When | Error | Why an honest client never sends it |
|---|---|---|---|---|
| `bad_game` | `card_sit` | `p_game` not one of the three | `invalid game` | The game comes from the interactable (`CardGame`). |
| `bad_seat` | `card_sit` | `p_seat` null or outside 1–`_card_max` | `invalid seat` | The panel sits only on seats it draws from `max`. |
| `bad_stake` | `card_sit` | `p_stake` not 100/1000/10000 | `invalid stake` | `SitDialog` offers the three values or the table's stake. |
| `bad_qty` | `card_sit`, `pk_topup` | poker buy-in null or outside 50–200 BB; non-poker buy-in not null; top-up null, < 1 or > 200 BB | `invalid quantity` | The slider is bounded by `pkBuyInRange`. |
| `bad_cards` | `tl_play` | null, empty, > 13 items, an item outside 0–51, or duplicates | `invalid cards` | `CardHand` sends a set of the cards it shows. |
| `bad_bet` | `pk_act` | `p_action` not in the six; `p_amount` null, < 0 or > 2·10⁹ for `bet`/`raise` | `invalid bet` | `PokerActions` sends its enum and a slider value. |

The reads, `card_tick` and `card_leave` are not flagged: a bad `p_game` there raises `invalid game`.

**Soft signal `bad_move`:** a well-formed move refused by the state while `p_seq` matched. It is logged and returns the envelope with `strike: 0` and the refusal as `error` (R30). The refusals it covers:
- cards not in hand, or no combination → `invalid play`;
- a play that cannot beat the top → `cannot beat`;
- out of turn → `not your turn`;
- the first lead without `must` → `must include`;
- a pass while leading → `must play`;
- a bet out of range → `invalid bet`;
- a raise that is not allowed → `cannot raise`;
- a deal by a non-dealer → `not dealer`;
- the wrong phase → `wrong phase`.

Every other refusal is raised and never logged: `stale`, `not seated`, `already seated`, `still leaving`, `table full`, `seat taken`, `stake changed`, `not enough coins`, `hand running`, `too many chips` and `dealer busy`.

**Every error string** a card RPC can raise, or carry as an envelope's `error`, maps to Vietnamese in `cardErrorMessage` (`lib/game/cards/messages.ts`). All are 22023 unless noted, and the raised ones are never logged.

| Error | Vietnamese |
|---|---|
| `invalid session` (42501) | Phiên đăng nhập đã hết hạn — hãy đăng nhập lại. |
| `account banned` (42501) | Tài khoản đã bị khoá. |
| `account is not a member of this room` (42501) | Bạn không còn ở trong phòng này. |
| `account locked` (42501) | the anti-cheat `lockText(seconds)` |
| `invalid game` | Bàn bài không hợp lệ. |
| `invalid seat` | Ghế không hợp lệ. |
| `invalid stake` | Mức cược của bàn không hợp lệ. |
| `invalid quantity` | Số xu không hợp lệ. |
| `invalid cards` | Lá bài không hợp lệ. |
| `invalid bet` | Số tiền cược không hợp lệ. |
| `stale` | Bàn vừa thay đổi — xem lại nhé. |
| `not seated` | Bạn chưa ngồi bàn này. |
| `already seated` | Bạn đang ngồi một bàn khác trong phòng. |
| `still leaving` | Ván bạn vừa rời chưa xong — hết ván đó bạn mới ngồi lại được. |
| `table full` | Bàn đã đủ người. |
| `seat taken` | Ghế này có người rồi. |
| `stake changed` | Mức cược vừa đổi — xem lại nhé. |
| `not enough coins` | Không đủ xu. |
| `not your turn` | Chưa tới lượt bạn. |
| `invalid play` | Bộ bài không hợp lệ. |
| `cannot beat` | Bài này không chặn được. |
| `must include` | Ván đầu phải đánh kèm lá {x}. |
| `must play` | Bạn đang mở vòng — phải đánh. |
| `cannot raise` | Chưa được tố thêm — chỉ theo hoặc úp. |
| `hand running` | Đang có ván — chờ hết ván nhé. |
| `too many chips` | Trên bàn tối đa 200 lần mù lớn. |
| `not dealer` | Chỉ nhà cái được chia bài. |
| `dealer busy` | Nhà cái chờ lật bài xong rồi hãy rời bàn. |
| `wrong phase` | Chưa tới lúc làm việc này. |
| a missing RPC | Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017. |
| anything else | Có lỗi, thử lại nhé. |

- The first three texts are the fishing ones (`lib/game/fishing/messages.ts`). A unit test feeds every code in this table through `cardErrorMessage`.
- After any error the client refetches the state.
- **Anti-cheat texts:** `reasonText` falls back to the generic text for the new codes. The admin tab's labels gain:

| Code | Label |
|---|---|
| `bad_game` | Sai bàn bài |
| `bad_seat` | Số ghế sai |
| `bad_stake` | Mức cược sai |
| `bad_cards` | Lá bài sai |
| `bad_bet` | Tiền cược sai |
| `bad_move` | Nước đi sai |

- **`_ac_holdings`** gains `"cards": [{room_id, game, seat, chips, escrow}]` for the admin's preview.
- **`_ac_wipe`** is re-created to call `_card_forfeit_all(p_account)` first, while the wallet row is already locked (§6.3). The snapshot and the deletes follow unchanged, so the returned xu are part of the wiped balance.

### 11.6 Concurrency

- **Lock order in card calls:** `card_tick` and every write take the table row `for update` first, then wallets in account-id order. A hard signal's `_ac_flag` runs before the table lock, as in the farm wrappers. The soft `bad_move` log takes the caller's status row last, and the call then only returns, so the wallet still comes before the status row (anti-cheat R16).
- **Lock order when an account goes away:** `_card_forfeit_all` runs with the account's wallet already locked (the wipe after `_wallet_lock`; the `accounts` trigger calls `_wallet_lock(old.id)` first). It then takes the account's tables in table-id order, then the other wallets in account-id order. The wallet stays first, as anti-cheat R16 orders; the wipe also holds the status row, which no card path waits for, because a banned account has no session.
- **Room deletion:** `_card_room_gone` takes the room's tables in table-id order, then the wallets of every seated account in account-id order, before it moves anything.
- **One table at a time:** calls on one table serialize. Calls on different tables or rooms never block each other except on a shared wallet.
- **Deadlocks:** three rare cases end in a Postgres deadlock abort of one side:
  - a card settlement meeting a concurrent `_land_sale`, which locks buyer then seller;
  - a card call that holds a table and waits for a wallet held by `_card_forfeit_all`;
  - an account deletion meeting an in-flight call of that account: the call aborts; nothing moves. The BEFORE DELETE trigger on `accounts` holds the account row and waits for its wallet, while the call (any economy RPC of that account) holds the wallet and waits for the account row through its ledger or fish insert's foreign key.

  Ticks are retried by design; the land RPC and the admin action show their usual errors and can be repeated. No case moves xu before it aborts.
- **`card_sit`'s wallets:** the caller has no seat at the table, so its wallet is locked in the same account-id pass as the table's seat wallets, right after the table and before the sweep. The caller's `seen_at` touch comes after that pass. A caller seated at another table of the room would otherwise hold that seat's row while waiting for its own wallet, which that table's deal holds before it updates the row.
- **Reads:** `card_lobby`, `card_state` and `card_hand` build their answer in one `select` (one snapshot) and take no table lock; their only write to card rows is the caller's `seen_at` touch.

### 11.7 Sections and re-runs

| Section | Contents |
|---|---|
| A | the five tables, indexes, RLS, revokes; the `coin_ledger` check |
| B | the pure helpers (cards, Tiến lên, Cào, poker) |
| C | table machinery: init, open, sweep, view, bump, lines, payouts, the leave operation, the empty-table reset, `_card_forfeit_all`, `_card_room_gone` |
| D | the three engines |
| E | the public RPCs, with grants |
| F | the BEFORE DELETE triggers on `rooms` and `accounts`; `_ac_holdings` (with `cards`) and `_ac_wipe` (calling `_card_forfeit_all`) re-created, keeping everything the anti-cheat spec put in them |

Re-runs are safe: `create table if not exists`, `create or replace function`, `drop trigger if exists` + `create trigger`, `drop constraint if exists` + `add constraint`, idempotent grants.

## 12. Realtime and budget

- **Channel:** `cards:{roomId}:{game}` with `broadcast: { self: false }`.
  - Seated players stay subscribed while seated, even with the panel closed.
  - Spectators subscribe while the panel is open.
- **Message:** `cv {id, v}` (≈ 40 bytes), sent once by the client whose RPC answered `changed: true`.
- **Receivers:**
  - drop a `cv` from non-members, or with `v ≤` the applied version;
  - gather for 150 ms, then call `card_state`, starting refetches at least 500 ms apart with one trailing refetch;
  - call `card_hand` only when `hand_no` changed and they hold a seat in it;
  - poll every 15 s while nothing arrived (a lost hint costs at most 15 s).
  - The anti-cheat receive budgets gain `cv`: 5 per s, burst 5, per sender.
- **Hall labels:** `card_lobby` every 20 s while on the hall, with no realtime cost.
- **Cost:** Supabase counts one broadcast as 1 sent + 1 per receiver, so a hint costs N messages for N subscribers.

| Table (subscribers N) | Hints | Messages per busy hour |
|---|---|---|
| Tiến lên (4 players + 1 watcher) | ≈ 62 per 4-minute game | ≈ 5 000 |
| Cào (6 + 1) | 3 per 36 s hand | ≈ 2 100 |
| Poker (6 + 1) | ≈ 14 per hand, ≈ 45 hands | ≈ 4 500 |
| All three full | — | ≈ 11 600 (≈ 3 per s, peaks ≈ 10 per s) |

- **Against the free plan:**
  - The peaks stay far below the shared 100 per s.
  - 2 M messages a month cover ≈ 170 hours of all three tables full. For comparison, 10 walking players cost ≈ 110 k an hour (README v13).
  - Channel joins (≤ 16 per room) and connections (the same socket) are negligible.
- **Postgres:** ≈ N `card_state` reads per hint, about 5 RPC/s per busy table. Each is one indexed statement.
- **Trust model (for the README):** the server decides the shuffle, the deal, every legal move, the timers and every xu that moves. A client only chooses its own moves, and sees its own cards only. A spoofed `cv` can at most make clients refetch at the capped rate: it carries no state, and every displayed state comes from `card_state`.

## 13. Client

### 13.1 Code

- **`lib/game/cards/deck.ts`:** card ↔ label ("10♥", aria "10 cơ"), the suit names bích/chuồn/rô/cơ, sorting.
- **The mirrors, pinned by `tests/fixtures/card-cases.json`:**
  - `tienlen.ts`: `tlCombo`, `tlBeats`, `tlLegalPlays(hand, top, must)`, `tlSlams`, `tlTrang`, `tlThoi`, `tlSettle`;
  - `cao.ts`: `caoEval`, `caoCompare`, `caoSettle`;
  - `poker.ts`: `pkEval`, `pkCompare`, `pkHandName`, `pkPots`, `pkLegal(state, seat)`, `pkBuyInRange`.
- **`state.ts`:** defensive parsers for the lobby, the state and the hand; `null` on malformed input.
- **`rpc.ts`:** `call()` handles the envelope and the lock exactly as the farm and fishing wrappers do (anti-cheat §12.1).
- **`useCardTable(roomId, token, game, active)`:** `{state, hand, act, sit, leave, topup, tick}`; the channel, the gather/gap, the 15 s poll and the tick scheduling (§10). It syncs the shared clock (`lib/game/farm/clock.ts`) from `server_now`.
- **`useCardsController`** (in `GameShell`):
  - it owns the lobby and the open panel (`blocking` adds `cards.panel !== null`);
  - while seated it keeps a `useCardTable` for that table and shows `CardSeatChip` under the player card: "🃏 Tiến lên · Đến lượt bạn! 14s" (pulsing), "· Đang chơi" or "· Chờ ván mới";
  - it shows a toast once per turn while the panel is closed: "🃏 Đến lượt bạn ở bàn {game}!".

### 13.2 The table panel (`CardTablePanel`)

A `ParchmentModal` (`max-w-3xl`); Esc closes it without standing up.

- **Header:**
  - the title: `🃏 Bàn Tiến lên`, `🃏 Chiếu Cào` or `🃏 Bàn Poker`;
  - the stake line: `Mức cược 1.000 xu`, or for poker `Mù 500/1.000`;
  - `🪙 {coins}` and `📜 Sổ luật`.
- **Seats** around an oval felt, rotated so my seat sits at the bottom. Each seat shows:
  - the name, and chips (poker) or escrow (`giữ 10.000`);
  - the card count or card backs;
  - a status badge: Bỏ lượt, Về nhất/nhì/ba/bét, Cóng, Xử thua, Úp bài, Tất tay, Cái, D;
  - the turn's timer bar;
  - `Ngồi đây` on an empty seat, and `Đứng dậy` on mine. In a live hand `Đứng dậy` first confirms the cost ("Rời bàn giữa ván sẽ bị xử thua… Hết ván này bạn mới ngồi lại được."), and for the Cào dealer during `peek` it is disabled ("Chờ lật bài xong").
- **Centre:**
  - Tiến lên: this round's pile, the top combination's name and a cut banner ("💣 {C} chặt {B}!");
  - Cào: the dealer badge, "Lật bài sau {n} giây", then every hand with its nút;
  - Poker: the board, `Pot {xu}` and the side pots.
- **Status line:** `Chờ người chơi (cần ít nhất 2)`, `Ván mới sau {n} giây`, `Lượt {name} · {n}s` or `Đến lượt bạn! {n}s`.
- **My hand:** `PlayingCard` DOM cards (40 × 56, 32 × 46 on phones) in the pixel font, red for ♥♦; selected cards lift 8 px; aria `"{rank} {suit}"` with `aria-pressed`.
  - Tiến lên: `Xếp bài` switches between sort by rank and group by combination.
  - Poker: "Bạn đang có: Đôi K".
  - Cào: three backs, `Nặn bài`, then "7 nút".
- **Actions:**

| Game | Buttons (disabled with a reason when illegal) |
|---|---|
| Tiến lên | `Đánh` (the selection is a legal play) · `Bỏ lượt` (not when leading) · `Bỏ chọn` · `💡 Gợi ý` (cycles `tlLegalPlays`, smallest first) · `💣 Chặt!` (shown out of turn when `tlSlams` finds a 4 đôi thông that beats the top) |
| Cào | `🃏 Chia bài` (dealer, `deal_wait`) · `Nặn bài` (local) |
| Poker | `Úp bài` · `Xem bài` or `Theo {xu}` · `Cược {xu}` / `Tố lên {xu}` with a slider and `Tối thiểu`, `½ pot`, `Pot` · `Tất tay` |

- **`SitDialog`:**
  - the stake picker (`100 xu`, `1.000 xu`, `10.000 xu`), only when the table is empty;
  - the requirement line:
    - Tiến lên: `Mỗi ván giữ tạm {10 S} để trả thua — hết ván trả lại phần dư.`
    - Cào: `Mỗi ván giữ tạm {S}; khi làm cái giữ {S} × số nhà con.`
    - Poker: `Mang vào bàn: {slider 50–200 lần mù lớn}`.
  - the footer: `🪙 Xu chỉ là điểm trong trò chơi — không mua bằng tiền thật, không đổi ra tiền thật.`
- **Result overlay** (the `result` phase): each seat's `+{xu}`/`−{xu}` and its lines ("Thối heo: D trả C 500", "Cóng: D trả A 5.000", "Tới trắng: 6 đôi", "Xử thua: D trả mỗi người 1.000"), plus the revealed hands. A cancelled Cào hand shows "Ván huỷ — đã trả lại tiền giữ".
- **Spectators:** `👀 Đang xem`; no hand and no actions; cards face down until revealed.
- **Phones:** the seats collapse into a scrollable top row; the hand scrolls horizontally; the actions stay pinned.

## 14. 📜 Sổ luật

- **The component:** `RulesBook`, a parchment modal with tabs `Tiến lên`, `Cào` and `Poker`, opened on the current table's tab.
- **The content:** static data in `lib/game/cards/rules.ts`: `rulesPage(game, stake)` returns sections of lines, and a line may carry `cards` shown as mini cards.
- **The money examples** are computed with `tlSettle` / `caoSettle` / `pkPots` at the viewer's table stake (1 000 by default), so the book always matches the engine.
- **The header on every tab:**
  - `🪙 Xu là điểm chơi trong Music Together — kiếm được khi câu cá, làm ruộng, điểm danh và nghe nhạc.`
  - `Xu không mua được bằng tiền thật và không đổi ra tiền thật. Mua bán xu hay tài khoản bằng tiền thật bị cấm.`
  - `Bàn bài chỉ để giải trí: người thắng nhận đúng phần người thua trả, không ai thu phí.`

**Tiến lên**

| Section | Key text |
|---|---|
| Mục tiêu | Mỗi người 13 lá. Ai đánh hết bài trước về nhất; những người còn lại đánh tiếp để phân nhì, ba, bét. Bàn 2–4 người. |
| Thứ tự bài | 3 < 4 < … < K < A < 2 (heo). Cùng số thì so chất: ♠ bích < ♣ chuồn < ♦ rô < ♥ cơ. Nhỏ nhất 3♠, lớn nhất 2♥. |
| Các bộ | Rác [7♦] · Đôi [9♠ 9♥] · Sám cô [Q♣ Q♦ Q♥] · Sảnh ≥ 3 lá liên tiếp, không có heo [5♠ 6♦ 7♣] · Tứ quý [8♠ 8♣ 8♦ 8♥] · Đôi thông ≥ 3 đôi liên tiếp, không có heo [4♠ 4♦ 5♣ 5♥ 6♠ 6♦]. Chặn bằng bộ cùng loại, cùng số lá, lá lớn nhất lớn hơn: [6♠ 7♦ 8♥] chặn [6♦ 7♥ 8♣] vì 8♥ > 8♣. |
| Lượt chơi | Ván đầu (bàn mới, sau tới trắng, hoặc khi người về nhất ván trước không còn chơi): ai có lá nhỏ nhất được chia (thường 3♠) đánh trước, phải đánh kèm lá đó. Ván sau: người về nhất đánh trước. Lần lượt chặn hoặc Bỏ lượt; đã bỏ lượt thì chờ vòng sau. Mọi người khác bỏ lượt thì người đánh sau cùng mở vòng mới; người đó đã hết bài thì người kế tiếp mở. Mỗi lượt 20 giây; hết giờ tự bỏ lượt (đang mở vòng thì tự đánh lá nhỏ nhất); lỡ 2 lượt liên tiếp bị xử thua. |
| Luật đặc biệt | Chặt heo: 3 đôi thông chặt 1 heo; tứ quý chặt 1 heo, đôi heo, 3 đôi thông; 4 đôi thông chặt 1 heo, đôi heo, 3 đôi thông, tứ quý — và chặt được cả khi đã bỏ lượt (nút 💣 Chặt!). Hàng lớn chặt hàng nhỏ cùng loại. Chặt chồng: người bị chặt sau cùng trả cả chuỗi cho người chặt sau cùng khi hết vòng. Tới trắng: vừa chia có sảnh rồng (3 → A), 5 đôi thông, tứ quý heo hoặc 6 đôi là thắng ngay. Cóng: có người về nhất mà bạn chưa đánh lá nào; nhiều người cùng cóng thì ai cách người về nhất xa nhất theo lượt đánh thì về bét. Thối: hết ván còn heo hoặc hàng trên tay. Xử thua (rời bàn giữa ván hoặc lỡ 2 lượt liên tiếp): trả ngay 1 mức cho mỗi người còn đang chơi, dù họ còn bao nhiêu lá, rồi tiền thối bài mình cho người kế tiếp trong số đó. Xử thua không làm ai bị cóng; không còn ai để nhận thì khoản đó không phải trả. Những người còn lại chơi tiếp như một bàn ít người hơn. |
| Tính tiền | Bét trả nhất 1 mức, ba trả nhì ½ mức (3 người: bét trả nhất 1 mức; 2 người: thua trả thắng 1 mức). Heo đen ½ · heo đỏ 1 · 3 đôi thông 1½ · tứ quý 2 · 4 đôi thông 3 mức, cho cả thối và chặt. Cóng: trả nhất 2 mức + thối. Tới trắng: mỗi người trả 2 mức. Thối của người về bét trả người về ngay trên; của người cóng trả người về nhất; của người bị xử thua trả người kế tiếp còn đang chơi. Xử thua: trả mỗi người còn đang chơi 1 mức. Mỗi ván giữ tạm 10 mức; không ai thua quá 10 mức một ván. Examples 1–4 of §7.5. |

**Cào**

| Section | Key text |
|---|---|
| Mục tiêu | Mỗi người 3 lá, so với nhà cái: cao hơn cái thì ăn 1 mức, thấp hơn thì chung 1 mức. Bàn 2–6 người; cái xoay vòng mỗi ván. |
| Tính điểm | A = 1, 2–9 theo số, 10 · J · Q · K = 10. Nút là hàng đơn vị của tổng: [7♠ 8♦ 9♣] = 24 → 4 nút. 9 nút cao nhất; tròn chục là bù (0 nút). |
| Bài đặc biệt | Sáp: 3 lá cùng số [5♠ 5♦ 5♥] thắng mọi bài khác; sáp lớn thắng sáp nhỏ (K cao nhất, A thấp nhất). Ba tây: 3 lá hình J/Q/K bất kỳ [J♣ Q♦ Q♠], thắng mọi bài tính nút. |
| So bằng | Cùng nút hoặc cùng ba tây: so lá lớn nhất mỗi bên, K > Q > J > 10 > … > 2 > A; cùng số thì so chất ♦ rô > ♥ cơ > ♣ chuồn > ♠ bích. Không có hai lá giống nhau nên luôn có thắng thua. |
| Lượt chơi | Cái bấm 🃏 Chia bài trong 15 giây (quá giờ tự chia). Mọi người có 15 giây nặn bài, rồi cả bàn lật bài. Nhà con rời bàn giữa ván thì mất 1 mức cho cái; nhà cái chờ lật bài xong mới rời được. |
| Tính tiền | Mỗi nhà con thắng hoặc thua cái đúng 1 mức. Mỗi nhà con giữ tạm 1 mức; nhà cái giữ tạm (số nhà con × mức cược); không đủ thì bỏ qua lượt cái. The §8.3 example. |

**Poker**

| Section | Key text |
|---|---|
| Mục tiêu | Mỗi người 2 lá tẩy, bàn có 5 lá chung. Ghép 5 lá tốt nhất từ 7 lá; tay mạnh nhất khi lật bài, hoặc người cuối cùng chưa úp bài, ăn pot. |
| Thứ tự tay bài | Thùng phá sảnh [9♥ 10♥ J♥ Q♥ K♥] > Tứ quý > Cù lũ > Thùng > Sảnh (A đứng đầu hoặc cuối: A-2-3-4-5) > Sám > Thú > Đôi > Mậu thầu, each with a card example. Cùng hạng thì so lá cao và lá phụ (kicker); chất không phân hơn thua. |
| Lượt chơi | Nút D xoay vòng. Hai người bên trái nút đặt mù nhỏ (½ mức) và mù lớn (1 mức); bàn 2 người thì người giữ nút đặt mù nhỏ và nói trước ở vòng đầu. Bốn vòng cược: trước flop, flop (3 lá), turn (1 lá), river (1 lá). Mỗi lượt 30 giây; hết giờ tự Xem bài nếu được, không thì Úp bài; lỡ 2 lượt liên tiếp thì bị úp bài và rời bàn, chip chưa cược về ví. |
| Luật cược | Cược ít nhất 1 mù lớn. Tố phải tăng ít nhất bằng lần cược hoặc tố lớn nhất trước đó trong vòng. Tất tay lúc nào cũng được; tất tay chưa đủ một lần tố thì người đã nói không được tố lại. Người tất tay chỉ ăn phần pot mình theo được (pot phụ). Hoà thì chia đều; 1 xu lẻ cho người thắng ngồi gần bên trái nút nhất. |
| Tiền | Mang vào bàn 50–200 lần mù lớn; đứng dậy thì chip về ví. Nạp thêm giữa các ván, tối đa 200 lần mù lớn. Không phí bàn. The §9.3 example. |

## 15. Art

Everything is original and drawn in code.

- **`paintCardCorner`** (`hall-art.ts`, seeded): the plank deck with a rope edge, a few floor lanterns, and grass tufts at the edge.
- **`card_table` props** (`props.ts`, one painter per game):

| Game | Drawing |
|---|---|
| Tiến lên | a low square wooden table with a red-checked cloth, a card fan, 4 blue plastic stools |
| Cào | a round straw mat (chiếu cói) with a red envelope, a card stack and 6 cushions |
| Poker | an oval table, green felt, a wood rim, a chip stack, 6 stools |

- **Other props:** the sign board with ♠♥ (`icon: "cards"`); a light pole with the existing bulb string.
- **Cards in the panel:** DOM and CSS. Faces are parchment with the rank in the pixel font and a suit glyph. The back is burgundy with a gold lattice (CSS gradients). Chips are CSS coin stacks.
- **Motion:** the dealt and flipped cards animate briefly; reduced motion turns every animation off.

## 16. Legal & product

- **Xu is play money.** It is earned only in the game (fishing, farming, check-in, songs).
  - It is never sold: there is no purchase, top-up or paid item that yields xu.
  - It is never cashed out: there is no conversion to money, vouchers or goods.
  - It is never transferable outside play.
- **The card tables are social games with play money.** The house takes nothing, and no prize has real-world value.
- **The context:** Vietnam fines gambling for money or property, and its list names "tiến lên 13 lá" and "3 cây" (Decree 144/2021/NĐ-CP, art. 28). The product must stay on the play-money side of that line.
- **The product rules:**
  - While the card corner exists, no feature may sell xu or let xu buy anything of monetary value.
  - Trading xu or accounts for money is forbidden, and the owner may ban for it.
  - The UI says so in 📜 Sổ luật and in the sit dialog (§13.2, §14).
- **A known risk (§18):** colluding players can move xu between accounts (chip dumping), as land sales already allow. There is no enforcement beyond the ban.
- This note is not legal advice. The owner should confirm with counsel before any monetisation.

## 17. Testing

- **Shared fixtures** (`tests/fixtures/card-cases.json`):

| Section | Cases |
|---|---|
| `tienlen.combo` | ≈ 40: every type, near misses (a 2 in a straight, a 2 in đôi thông, a triple inside "đôi thông", gaps) |
| `tienlen.beats` | ≈ 40: every row of §7.2, same type different length, 2 over 2 |
| `tienlen.trang` | each pattern, the precedence, near misses |
| `tienlen.thoi` | heo colours, tứ quý first, 3 and 4 runs |
| `tienlen.settle` | ≈ 15: plain, chain, void chain, cóng 1/2/3 with the reverse-turn-order placement, forfeit (open chain as victim and as cutter; a recipient who has played nothing is paid 1 S and is not made cóng; the cap binding part-way through the 1 S lines, in turn order; two seats swept together as the last active players: no line paid, both escrows refunded), survivor, the cap, tới trắng |
| `cao.eval`, `cao.cmp`, `cao.settle` | classes, sáp order, top-card and suit tie-breaks |
| `poker.eval`, `poker.cmp`, `poker.pots` | every category, the wheel, the board playing, kickers, three pairs, multi-way side pots, odd chips |

  The TS tests assert them, and the SQL smoke replays the same cases through the private functions.
- **SQL smoke** (`tests/sql/v16-smoke.sql`, on the throwaway PostgreSQL 18 cluster; house style `ON_ERROR_STOP`, `pg_temp.err`, `assert`):
  - **Tiến lên** (4 accounts, fixed decks, simulated times):
    - the first-game `must`;
    - a full game to the settlement;
    - a cut chain across three players;
    - an out-of-turn 4 đôi thông after passing;
    - cóng;
    - tới trắng, after which the next deal is a first game (the lowest dealt card leads, with `must`) although an earlier nhất exists; the same when the previous nhất has left;
    - two and three cóng players, placed from the bottom in reverse turn order from nhất (the farthest is bét);
    - two timeouts forfeiting: the forfeited seat never plays or passes afterwards, and the turn moves on or the game ends;
    - leaving mid-game: the forfeit settled at once (1 S to each other active player, thối to the next of them), the rest finishing as a smaller game (Example 4);
    - a forfeit before anyone has gone out: a player who has played nothing is paid 1 S and is not made cóng;
    - two banned players swept together: they pay each other nothing;
    - a 2-player table;
    - the escrow cap.
  - **Cào** (4 accounts):
    - the rotation, a dealer who cannot afford it skipped;
    - a wallet drained between `deal_wait` and the deal: the players and the dealer are rebuilt under the locks, and fewer than 2 goes to `idle`;
    - the escrows total 2 (n − 1) S;
    - the auto-deal on timeout with the dealer's misses, the showdown lines;
    - a non-dealer leaving during `peek` loses S; the dealer's `card_leave` during `peek` is refused (`dealer busy`); a banned dealer cancels the hand.
  - **Poker** (3 accounts):
    - heads-up blinds and order;
    - a 3-way all-in with side pots;
    - the short all-in that does not re-open raising (TDA example);
    - the uncalled bet;
    - an uncontested win, the odd chip;
    - check and fold timeouts;
    - the second timeout: fold, the stack returned at once, committed chips left in the pot; the row stays `leaving` with `chips = 0` and `missed = 2` until the hand ends, then is deleted;
    - standing up mid-hand (the same state);
    - leaving while holding the top bet: the uncalled part stays as dead money and lands in the top pot;
    - top-up bounds, the 0-chip seat.
  - **Common:**
    - the zero-sum invariant after every step;
    - reads never mutate: `card_state` past a deadline returns the old phase and `v`, and only `card_tick` advances it;
    - membership: a non-member gets `account is not a member of this room` from all 11 RPCs;
    - `stale` on an old `seq`;
    - `already seated`, `table full`, `stake changed`, the idle rule (`seen_at` moved back);
    - `still leaving`: after leaving a live hand, `card_sit` fails at every table of the room until that hand ends, then succeeds;
    - a kicked member and a banned account resolved by the sweep;
    - `_card_forfeit_all` through the wipe, with live Tiến lên, Cào-player, Cào-dealer and Poker seats: the other players' escrows and the pots are intact, and only the cheater's own balance is wiped;
    - `admin_delete_account` during live hands: the `accounts` trigger resolves the seats first, and the invariant holds for everyone else;
    - `admin_delete_room` during live hands: a banned seat leaves first; every hand is cancelled and every balance, contribution and stack refunded; a deleted account's poker contribution is split among the live seats;
    - the empty-table reset after the last seat leaves;
    - hands never in `card_state`, and `card_hand` only for its owner;
    - anon cannot select the five tables;
    - every hard signal returns its envelope in log mode, `bad_move` returns `strike: 0`;
    - a locked account cannot sit or act but can `card_leave`, `card_tick` and read;
    - re-running `0017` twice.
  - It ends with `\i tests/sql/anticheat-guards.sql` (allowlist and loop updated).
- **Unit (Vitest):**
  - `deck`, `state` parsers;
  - `rpc` (envelope, lock, error mapping), `messages` (`cardErrorMessage` for every code in §11.5);
  - `rules` (every tab has its sections; the examples' nets sum to 0);
  - `pkLegal` and slider bounds, `tlLegalPlays` and `tlSlams`;
  - the hall map invariants (§5).
- **Hooks and components (RTL, `afterEach(cleanup)`):**
  - `useCardTable`: a hint then a refetch after 150 ms; the 500 ms gap; `card_hand` only on a new `hand_no`; a tick at the deadline with jitter; the 15 s poll; `stale` → refetch.
  - `CardTablePanel`:
    - a spectator sees no hand and no actions;
    - `Đánh` is disabled for an illegal selection;
    - `💣 Chặt!` appears only when eligible;
    - the poker slider is bounded;
    - `🃏 Chia bài` only for the dealer.
  - `SitDialog`: the stake picker only on an empty table; the buy-in bounds; the escrow and xu lines.
  - `RulesBook` tabs; `CardSeatChip`.
- **Integration** (skipped without `SUPABASE_TEST_URL`): sit, leave, a lobby read, a 2-player Tiến lên game driven by the public RPCs until the settlement, and the zero-sum check on the ledger.
- **Manual pass** (the owner, after `0017`, three accounts):
  - each game end to end;
  - the rules book;
  - closing the panel while seated;
  - a phone layout;
  - the Realtime messages graph on the Supabase dashboard during an hour of play.

## 18. Out of scope

- Tournaments, in-table chat, private tables, bots (C10).
- **Rule variants:**
  - Tiến lên: đếm lá scoring; extra tới trắng (đồng màu, first-game hands); counting un-cut 2s in chặt chồng; đền bài; 3♠ endings; the Northern and Huế rules.
  - Cào: cào rùa, liêng, bets other than 1 S, a dealer who keeps the bank.
  - Poker: antes, straddles, sit-out, time banks, run-it-twice, rabbit hunting, choosing to muck.
- A hand-history UI (the log stays server-side), card leaderboards, room chat announcements of big hands.
- Card play in the classic view; more than one table per game per room; sitting at two tables in one room.
- **Collusion and chip dumping** between accounts. Like land sales it can move xu at will; there is no detection beyond the owner's review of `card_log`.
- Server-originated broadcast (Supabase "Broadcast from Database"); a server-signed public state.
- **v17:** harvest rats, the dog, the slingshot.

## 19. Contentious rule choices

1. **The Tiến lên escrow cap (R14):** a loss above 10 S per game is forgiven. Real tables have no cap; the cap exists so the escrow is the true maximum.
2. **Chặt chồng counts only cut cards (R7):** some tables also charge the un-cut 2s played earlier in the round (bigkool's example).
3. **Only 4 đôi thông cuts after passing (R9):** vi.wikipedia marks 3 đôi thông and tứ quý "không bắt buộc phải có vòng" too.
4. **Tứ quý cuts a pair of 2s:** some regions (Đà Nẵng) allow only a single 2.
5. **Thối beneficiary (R12):** the player just above the last one, per vi.wikipedia; some tables pay nhất.
6. **Tới trắng pays 2 S flat with no thối (R10):** apps vary from 2× to 9× by pattern, and some count thối for 5 đôi thông.
7. **Cào:**
   - the suit order is ♦ > ♥ > ♣ > ♠ (rô highest, the opposite of Tiến lên's cơ);
   - the ace counts low in ties and sáp (some sources make sáp A the best);
   - no pushes, where plain bài cào calls equal nút a draw.
8. **Cào cái rather than a shared pot (R17):** "cào rùa" is equally common in some circles.
9. **The Tiến lên forfeit (R13):** 1 S to each other active player, whatever their card count, plus the forfeiter's thối to the next of them. Nobody becomes cóng at a forfeit, and a line with no recipient is not paid. This is my own "đền làng" rule, chosen so a forfeit settles at once; real tables vary, and some simply rank the leaver bét.
10. **Room deletion cancels live hands (§6.3)** instead of forfeiting every seat; only banned players and non-members leave first, as at any sweep. This reads the controller's "resolves every table the same way, then refunds" as "same locks and resolution path, no forfeits", because forfeiting everyone at once would move xu by deletion order.

## Appendix A. Sources

Every entry was consulted on 2026-09-25. The summaries are in my own words.

- https://www.pagat.com/climbing/thirteen.html: the Tiến lên card and suit order, the combinations, the two-bombs, and passing locking a player out of the round.
- https://en.wikipedia.org/wiki/Ti%E1%BA%BFn_l%C3%AAn: the suit order ♠ < ♣ < ♦ < ♥, 3♠ opening the first game, the bomb list, four 2s winning at once.
- https://vi.wikipedia.org/wiki/Ti%E1%BA%BFn_l%C3%AAn: the Southern rules. It covers the first game, hưởng sái, the tới trắng lists, cóng at 2× the stake plus hàng, the chặt hierarchy, the last player cut paying the chain, the thối beneficiary and "no penalty when the cut player went out".
- https://bigkoolweb.wordpress.com/2016/07/07/tong-hop-huong-dan-choi-tien-len-mien-nam-tu-a-z/: the nhất/nhì/ba/bét payments (12 and 6), the thối scale (6/12/18/24/36), a worked chặt chồng example, cóng at twice bét, 4 đôi thông cutting without the round.
- https://hocvienboardgames.com/tien-len-mien-nam/: the penalty scale in units of one bét; 3 đôi thông only in turn and 4 đôi thông at any time; a common tới trắng list.
- https://en.boardgamearena.com/gamepanel?game=tienlen: the bomb powers (4-pair sequences beating pairs of 2s and quads), and a player who passed may still play a 4-pair sequence.
- https://gamevh.net/cms/static/guide_1.jsp: tới trắng paid per opponent without thối, the tới trắng strength order, the chặt table.
- https://danhbai.asia/blog/tien-len-mien-nam/: 2s never in straights, the bomb hierarchy, and the note that house rules differ.
- https://vi.wikipedia.org/wiki/B%C3%A0i_c%C3%A0o: bài cào points (face cards 10, the unit digit), ba cào, the tie order rô > cơ > chuồn > bích.
- https://conversestore.vn/cach-tinh-diem-bai-cao/: the special hands (sáp, liêng, ba tây) with their order, the top-card-then-suit tie-break, cào rùa against cào cái.
- https://danhbai66.com/bai-cao/: ba tây beating 9 nút, sáp as a house special, the dealer rotation varying by house.
- https://www.pokertda.com/view-poker-tda-rules/: the minimum raise, short all-ins not re-opening betting (rule 47), heads-up blinds, odd chips left of the button, the showdown order.
- https://en.wikipedia.org/wiki/Texas_hold_%27em: the hold'em structure, the blinds, the no-limit minimum raise, kickers and split pots.
- https://www.pagat.com/poker/variants/texasholdem.html: heads-up blinds, playing the board, "cards speak" at showdown.
- https://pokervietnam.net/luat-poker/thu-tu-bai-poker/: the Vietnamese names of the hand ranks (Thùng phá sảnh … Mậu thầu), and suits never breaking ties.
- https://supabase.com/docs/guides/realtime/limits: the free-plan Realtime limits (200 connections, 100 messages/s, 100 joins/s, 256 KB payloads).
- https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages: a broadcast counts as 1 sent + 1 per receiving client; 2 M messages a month on the free plan.
- https://www.postgresql.org/docs/current/pgcrypto.html: `gen_random_bytes` returns cryptographically strong random bytes.
- https://thuvienphapluat.vn/phap-luat/danh-bai-tien-len-la-gi-tu-quy-la-gi-ba-doi-thong-la-gi-cach-danh-bai-tien-len-danh-bai-tien-len-te-476653-199388.html: Tiến lên basics, and Decree 144/2021/NĐ-CP art. 28 fining gambling for money or property (naming tiến lên and 3 cây).
