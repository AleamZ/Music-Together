# Music Together — Anti-cheat layer (Design)

**Date:** 2026-09-25
**Builds on:** `feat/v15-field` once v15.1 is finished, including `0013_v15_field.sql` with decision D1 applied. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Source:** the tamper-surface audit of 2026-09-25. Its hole numbers H1–H5 are kept here. The owner's answers to its open questions are §2 (D1–D8).
**Order:** `0014_lyrics_lockdown.sql` (hotfix on `main`) and v15.1 (`0013`) → **anti-cheat (`0015_anticheat.sql`, this doc)** → v15.2 (`0016_v15_2_crops.sql`) → v16 (`0017_v16_cards.sql`) → v15.3 (`0018_v15_3_gather.sql`).

## 1. Goal and threat model

### 1.1 Goal

Make tampering with the game economy from DevTools pointless and punished, and never punish an honest player. The game economy is fishing, farming, land and the two shops.

1. **Close the holes at the source.** Five holes (H1–H5) let a user change persistent data today (§1.3, §6).
2. **Detect on the server** the inputs that no shipped client can produce, and punish them in two steps:
   - first a warning and a 5-minute lock of game actions;
   - then a ban. The data wipe waits for the owner.
3. **Give the owner a review tab in /admin:** evidence, pardon, wipe and the mode switch.
4. **Harden the Realtime receivers** against floods and ghost players, and say plainly what stays spoofable (§14).

### 1.2 What a DevTools user has and can do

They hold:
- their own session token, stored in `localStorage["music-together:auth"]` (`lib/session.ts`);
- the project URL and the publishable key (`lib/supabase.ts`).

With these they can:
1. call any granted RPC with any arguments, as themselves;
2. read every table that has an anon `select` policy;
3. join any Realtime topic and send anything, even logged out or banned;
4. change local JS state, which only changes their own screen.

Only (1) reaches Postgres in a form the server can judge. A call from the console looks the same as a call from the app, so the server can only judge **what** was sent and **when**.

### 1.3 The holes

| # | Hole | Closed by |
|---|---|---|
| **H1** | Anyone with the publishable key can write `video_lyrics`, and the lyrics RPCs check no session, role or size. | `0014_lyrics_lockdown.sql` and its client patch, not this spec (§6.5) |
| **H2** | `finish_cast` trusts `p_success`: a script can report a won reel for every cast. | Accepted. A daily cast cap and detection are added (§6.3). |
| **H3** | `transplant` and `harvest` trust `p_quality`, which is clamped to 0.9–1.1, so up to ×1.21 yield. | D1 in `0013`, plus the `quality_range` check (§6.4) |
| **H4** | Queue metadata is trusted: the video id, title, thumbnail URL and duration. | Format and length checks (§6.2) |
| **H5** | `register` accepts any name, including "Ao cá" and "Hợp tác xã". Once root deletes such an account, its `[catch:…]` lines render as real system lines. `login` gives a banned account a token. | Username rules, the `system` flag and the login ban check (§6.1) |

### 1.4 What the layer promises

- **Server only.** Every check runs inside a SECURITY DEFINER RPC. A check in the browser could be switched off.
- **A strike needs a hard signal:** an input that no shipped client can produce (§7.2). These never strike (§7.3): double clicks, two tabs, retries, slow networks, clock skew, reconnects and stale cached clients.
- **Every strike has evidence:** the inputs, the server's context, the client build and the browser. The session token is never stored.
- **Safeguards:**
  - log-only mode first (D5);
  - root is never locked or banned;
  - the owner confirms every wipe (D3).

### 1.5 What it does not promise

- **Scripts that stay inside the honest range go undetected.** Examples: a bot that reports a won reel exactly at the time gate, or casts 40 times an hour. Caps bound them (40 casts per hour, 300 per day, §6.3), and soft signals flag them for review (§7.4).
- **Realtime cannot be policed.**
  - Broadcast never reaches the server.
  - Sender ids and presence keys are chosen by the client.
  - Bans do not apply to Realtime.

  The client filters in §14 stop floods and ghosts, not a determined spoofer. Spoofing there only changes what others see, never persistent data.
- **A banned user can register again.** There is no device or IP binding, so the wipe is the real penalty.
- **Paid-out xu stays paid.** Xu a cheater already paid to other players (land sales, subleases) is not taken back.
- **Queue title and duration are still declared by the client** until server-signed metadata comes (D8, §16).
- **A rice part's success is declared by the client** (v15.2 `harvest_part`), like the reel. A script can cut one part per 8 s, a whole plot in 48 s against about 1–3 min by hand. It gains only time, never kg: there is no quality factor, and each part pays its share of the yield at the cut (v15.2 §11.5).

## 2. Decisions (owner, 2026-09-25)

| # | Question | Ruling |
|---|---|---|
| D1 | Farm quality in v15.1 | Ignored (always 1.0) until the v15.3 transplant minigame (v15.2's harvest minigame gates the rice parts and sets no quality). A separate v15.1 task does this inside `0013`; this spec relies on it (§6.4). |
| D2 | What the 5-minute lock blocks | Game actions only: fishing, farming, land, and the fishing and farm shops. The daily check-in and the farm gift count as fishing and farming. Chat, the music queue and all reads stay open (§9.3). |
| D3 | Strike 2 | Ban at once: sessions are deleted and login is refused. The data is wiped only after the owner confirms it in /admin, where the owner can also pardon. |
| D4 | Expiry of a first strike | 30 days. |
| D5 | Rollout | The first 7 days run in log-only mode: strikes are recorded, nothing is locked or banned. Then the owner switches to enforce. |
| D6 | Chat on a wipe | Chat messages are kept. Only that user's catch and land announcements are deleted. |
| D7 | Migration order | `0014_lyrics_lockdown.sql` is a separate hotfix on `main`. The anti-cheat is `0015_anticheat.sql`, which requires `0012` and `0013`. The gather migration, first planned as `0014`, is v15.3's `0018_v15_3_gather.sql`; v15.2 is `0016_v15_2_crops.sql` and v16 is `0017`. |
| D8 | Queue song metadata | Format and length checks now. Server-signed metadata comes later and is out of scope. |
| — | When | Implemented right after v15.1 is finished. Specified and planned now. |

## 3. Rulings made while writing this spec

The audit left these details open. Each one is decided here, and the owner confirms or changes it in the spec review.

**The flow**

| # | Ruling | Why |
|---|---|---|
| R1 | A flagged call never raises, in either mode. It returns the envelope (§9.1), with `strike: 0` when nothing escalates. | A `RAISE` would roll the evidence row back too. |
| R2 | The modes are `log` and `enforce` only; there is no `off`. | `log` already stops every penalty, and logging never hurts. |
| R3 | Only root is exempt. There is no per-account exempt flag. | A false positive is fixed in code and pardoned, not whitelisted. Test accounts must be able to strike for the manual pass. |
| R4 | There is no auto-wipe setting. | Under D3 the owner's confirmation is the only path. |
| R5 | The lock length (5 minutes) and the strike window (30 days) are SQL constants, not config. | The Vietnamese texts quote them. |
| R6 | Switching to `log` clears the locks that are running. Bans stay. | Log mode promises that nothing is locked; a ban is a decision per account. |
| R7 | Events recorded in log mode never count as strikes later. | Enforcing must not ban anyone for what they did while nothing was enforced. |
| R8 | Pardon works in every state, including after a wipe, and restores no data. | Unbanning is always safe. Restoring from the snapshot is a manual job (§16). |
| R9 | `admin_set_ban(…, false)` on an anti-cheat ban runs the pardon. | It keeps the Accounts tab and the new tab consistent. |
| R10 | A banned account leaves the land market at the next sweep of each room, whether its wipe is pending or done, and whether the anti-cheat or root banned it: its offers are deleted, and its sale listings and sublease prices are cleared. | Nobody pays a banned account, and xu cannot be moved out before the wipe. |
| R11 | The wipe releases land by time: the plots, leases, offers and drying batches the account got at or before `wiped_at`. | A pardon after the wipe then neither brings old land back in rooms not yet swept nor takes away land bought later. |
| R12 | `chat_messages` gains `about_account_id` next to `system`. A land line belongs to its buyer. | D6's delete must be exact, and a line where an innocent player bought from the cheater must stay. |
| R13 | Land lines posted before `0015` stay unattributed, so a wipe cannot find them. | Their buyer appears only in the text, and they roll off the 200-line cap. |
| R14 | The lock rides in `_fishing_state` only (key `lock`), not in `field_state`. After a reload during a lock, the chip and the warning show once more. | The fishing state loads on every game-mode entry. A refused field action carries the seconds anyway. |
| R15 | The ban modal logs out however it is closed. | The server has already deleted the sessions. |
| R16 | The lock order is the wallet row first, then the `anticheat_status` row, never the reverse. | The admin wipe and `finish_cast` can then never deadlock. |

**Detection**

| # | Ruling | Why |
|---|---|---|
| R17 | New hard signal `bad_slot`: a `dry_collect` slot outside 1–4. | Same basis as `bad_plot`: the drying panel only offers slots 1–4. |
| R18 | `foreign_offer` covers offers of the same room only. | An offer id from another room can come from a room switch that does not remount `useField`. |
| R19 | Kind mismatches are soft. Like hard signals, they return an envelope with `strike: 0`, so the row commits. | The old v14 client then shows "Có lỗi, thử lại nhé." instead of "Món này không mua được." for farm items. That is harmless, for a few days. |
| R20 | Gate hugs are counted per Vietnam day and logged once, at the 20th. | Logging every catch would be noise. |
| R21 | The daily cast cap is 300 per Vietnam day. `cast_daily_cap` is logged once, when it is reached. | 300 casts is 7.5 h at the hourly cap, so a bot running 24 h is cut to under a third (300 of 960 casts). |
| R22 | The queue and account checks refuse but never strike. | The layer guards the game economy, and D2's lock would not even block the queue. |
| R23 | The guard check is deny-by-default. Every SECURITY DEFINER function in `public` that anon may execute and that is not on the allowlist must call `_ac_account` or `_ac_play`. The allowlist holds signatures, so a new overload of an allowed name is judged on its own. | A new game RPC in a later migration fails the smoke test until it is guarded. |

**Queue, names and chat**

| # | Ruling | Why |
|---|---|---|
| R24 | Queue durations outside 1–86 400 s become `null` (unknown) instead of raising an error. | Honest clients already send `null` for live streams, and the room rules decide. |
| R25 | The thumbnail is `https://i.ytimg.com/vi/<id>/mqdefault.jpg`, and `0015` rewrites the existing queue and history rows. | It is 16:9 with no letterbox for the small `object-cover` boxes, exists for every video, and removes any planted URL. |
| R26 | Titles: control characters and odd spaces become spaces, runs of spaces collapse, and the title is cut to 200 characters. Bidi controls (U+061C, U+200E–200F, U+202A–202E, U+2066–2069) are removed; other invisible characters stay in the stored title, but the banned-keyword check compares the title without them. Usernames still refuse them (§6.1). | A zero-width character would otherwise split a banned keyword, and removing them from the stored title broke emoji (the U+FE0F of "❤️", the joiners of a family); bidi controls could reorder what a title shows. |
| R27 | Usernames are stored NFC-normalized with single spaces. Register (for uniqueness) and login compare the same normalized lower-case form, an exact match first. | Decomposed Vietnamese (Unikey "tổ hợp") can then neither create a look-alike twin nor fail to log in. |
| R28 | Reserved names are compared on a key with the accents and non-letters removed: `aoca`, `hoptacxa`, `hethong`, `quantri`, `quantrivien`, `admin`, `root`, `system`. | This catches "Ao cá", "AO-CA" and "Hợp  tác  xã". Homoglyphs from other scripts remain possible, but they can no longer post system lines. |
| R29 | The login text for a banned account is neutral ("đã bị khoá") and does not say "vĩnh viễn". | Manual bans from /admin get the same refusal. |
| R30 | `fishing_board` hides every banned account, `_song_bonus` never pays one, and `_room_wealth` leaves them out of the fish price index, manual bans included. | A banned account should neither rank nor earn, nor move the room's fish prices. |

**Storage, build and scope**

| # | Ruling | Why |
|---|---|---|
| R31 | Retention: strike rows and wipe snapshots are kept forever. Every other row is kept 90 days, purged by `_ac_flag` (at most 500 rows per call). An account gets at most 200 non-strike rows per Vietnam day. | Storage stays bounded even when a script floods in log mode. |
| R32 | No IP address is stored. The client build comes from `X-Client-Info` and the browser from `User-Agent`. | IPs are personal data, and bans are not IP-based. |
| R33 | The build id is `NEXT_PUBLIC_CLIENT_BUILD`, set in the `env` of `next.config.ts`: the host's commit SHA (Vercel or Cloudflare Pages), otherwise the build time. | It is automatic on every deploy, with no manual bump. |
| R34 | Realtime: `hello` and `fp` are taken from any member, before the sender's presence arrives, within their budgets (`hello` 1 per 10 s; `fp` through the refetch gap of R35). `bye`, `lk`, `fs` and `fa` need the sender in this map's presence. A member who newly appears in this map's presence also schedules the reply, in case the budget dropped their `hello`. | Presence arrives at least 1 s late, and up to about 30 s after four view changes in 30 s. Dropping `hello` and `fp` until then drew the others at the spawn for the newcomer and kept a stale field. An unannounced member id costs at most a reply and a refetch within those budgets. |
| R35 | `fp`: the 400 ms gather stays, and refetch starts are at least 2 s apart, with one trailing refetch. | This bounds the database load a flood can cause, and honest changes still show within 2 s. |
| R36 | Two items are out of this spec: the plot locks that `field_state` takes on every read (an audit side finding), and the budget for the lyrics broadcast. | The first is a separate performance fix; the second belongs to `0014`. |
| R37 | New Vietnamese strings spell "khoá"/"xoá" as the game's texts do. The admin page's existing "Khóa"/"Xóa" buttons are left alone. | The spelling item from v14 stays a separate polish task. |

## 4. Constraints

- **Everything in the v13–v15 constraints still holds:**
  - the free-plan Realtime limits;
  - RPC-only writes;
  - Vietnamese UI with `vi-VN` numbers;
  - "per day" rules on the `Asia/Ho_Chi_Minh` calendar (`_vn_today()`).
- **The migration is `0015_anticheat.sql`.**
  - It is additive and re-runnable, and requires `0012` and `0013`.
  - It does not depend on `0014`.
  - The owner runs it in the Supabase SQL editor.
- **No cron.** Every time rule is lazy: the sweep, the lock expiry, the strike window and the evidence purge.
- **Signatures stay the same.** Every re-created public RPC keeps its signature and gets an explicit `grant execute … to anon, authenticated`. `create or replace` may switch a wrapper from `language sql` to `plpgsql`.
- **The server goes first.** The migration ships before the client whenever the range of honest inputs changes: `0015` before the anti-cheat client, and the same later.
- **The test baseline** is recorded by the plan's first task, because v15.1 changes it.

## 5. Architecture

```
supabase/migrations/0015_anticheat.sql   A accounts + chat · B queue · C tables · D helpers · E guarded RPCs ·
                                         F shared functions · G admin RPCs
lib/anticheat.ts                         pure: envelope parser, AnticheatError, lock seconds, Vietnamese texts, event hub
hooks/useAnticheat.ts                    the modal and the lock countdown for the game shell
components/game/AnticheatModal.tsx       warning (strike 1) and ban (strike 2)
components/game/AnticheatChip.tsx        the 🔒 m:ss chip in the player card
components/admin/AnticheatTab.tsx        /admin "Chống gian lận"
lib/admin.ts                             + adminAnticheatList / Account / Resolve / SetMode
lib/game/fishing/rpc.ts, lib/game/farm/rpc.ts   call(): envelope → AnticheatError; "account locked" → lock
lib/game/fishing/state.ts, messages.ts   casts_today_left, day_resets_at, lock; the daily-limit blocker
lib/chat.ts, lib/game/fishing/announce.ts        the `system` flag
components/auth/AuthScreen.tsx           "invalid username" and "account banned" texts
lib/game/net/budget.ts                   pure per-sender receive budgets
components/game/GameCanvas.tsx, components/game/GameShell.tsx   presence filter, budgets, modal, chip
hooks/useField.ts, hooks/useLooks.ts, hooks/useReactions.ts     fp refetch cap, lk budget, reaction budget
lib/supabase.ts, next.config.ts          the X-Client-Info build header
tests/sql/anticheat-smoke.sql, tests/sql/anticheat-guards.sql
```

**The data flow:**
1. A game RPC runs `_ac_account` or `_ac_play`: authentication plus the lock guard.
2. Then come the hard checks, then the unchanged body.
3. On a flagged input, `_ac_flag` writes the evidence row (and the strike, if any), and the RPC **returns** the envelope.
4. The client's `call()` sees `anticheat` and shows the warning modal, the ban modal or the normal error.

## 6. Closing the holes at the source

### 6.1 H5 — usernames, login and system lines

**Character classes** (PostgreSQL ARE bracket expressions, used in §6.1 and §6.2):

| Class | Code points |
|---|---|
| **C** controls | `\u0001-\u001f\u007f-\u009f` |
| **S** odd spaces | `\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000` |
| **Z** invisible and format | `\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff` |
| **M** combining marks (names only) | `\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f` |

**Helpers** (private, revoked):
- `_name_norm(t text) returns text`, `immutable`:
  ```sql
  lower(regexp_replace(btrim(normalize(coalesce(t, ''), NFC)), ' {2,}', ' ', 'g'))
  ```
- `_name_key(t text) returns text`, `stable`:
  ```sql
  regexp_replace(lower(extensions.unaccent(normalize(coalesce(t, ''), NFC))), '[^a-z0-9]+', '', 'g')
  ```

**`register(p_username text, p_password text, out account_id uuid, out username text, out token text)`** keeps its signature. In order:
1. `v_name := regexp_replace(btrim(normalize(coalesce(p_username, ''), NFC)), ' {2,}', ' ', 'g')`.
2. Raise `invalid username` (22023) when any of these holds:
   - `char_length(v_name) not between 2 and 24`;
   - `v_name` contains a character of C, S, Z or M;
   - `_name_key(v_name) in ('aoca','hoptacxa','hethong','quantri','quantrivien','admin','root','system')`.
3. Raise `username already taken` (23505) when `exists (select 1 from accounts a where _name_norm(a.username) = _name_norm(v_name))`.
4. Store `v_name`. The `username` OUT parameter returns it, so the client shows the stored form.

**`login(p_username text, p_password text, …)`** keeps its signature:
1. It looks the account up with:
   ```sql
   where _name_norm(a.username) = _name_norm(p_username)
   order by (lower(a.username) = lower(btrim(p_username))) desc, a.created_at
   limit 1
   ```
2. On a wrong password it raises `invalid username or password` (28P01), as today.
3. **Then**, if `is_banned`, it raises `account banned` (42501). A ban is revealed only after the right password.

**`chat_messages`** (additive):
- `add column if not exists system boolean not null default false`
- `add column if not exists about_account_id uuid`. It has no foreign key. It holds the catcher for a catch line and the buyer for a land line (R12).
- `create index if not exists idx_chat_about on public.chat_messages (about_account_id) where system`

**Who writes system lines:**
- `finish_cast` inserts with `system = true, about_account_id = <catcher>`.
- `_land_sale` inserts with `system = true, about_account_id = <buyer>`.
- `send_chat_message` is unchanged: the default is `false`.
- RLS still has no write policy, so only SECURITY DEFINER functions can set the flag.

**Backfill** (idempotent: it touches only rows with `system = false`):
```sql
update public.chat_messages
   set system = true,
       about_account_id = substring(body from '^\[catch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|')::uuid
 where not system and account_id is null and username = 'Ao cá'
   and body ~ '^\[catch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[a-z_]{1,32}\|[0-9]{1,6}\] ';
update public.chat_messages set system = true
 where not system and account_id is null and username = 'Hợp tác xã' and body ~ '^\[land:[0-9]{1,2}\] ';
```

**The client:**
- `ChatMessage` gains `system: boolean`, and `fetchRecentMessages` selects `system`. Before `0015` that column is missing: the select fails with the Postgres error 42703 (PostgREST passes it on), and `fetchRecentMessages` reads the messages once more without it, each with `system = false`.
- `parseCatchAnnouncement`, and the v15.1 `parseLandAnnouncement` (hence `parseAnnouncement`), accept a line only when `system === true`, in addition to the null author, the reserved name and the prefix. Their `Posted` pick gains `"system"`.
- A forged or orphaned line renders as a normal message.

**Existing accounts that break the rules** keep working. The owner's pre-deploy query lists them (§11.4).

### 6.2 H4 — queue metadata

**`add_queue_item(p_room_id uuid, p_session_token text, p_video_id text, p_title text, p_thumb text, p_duration integer)`** keeps its signature:
- **Video id:** raise `invalid video` (22023) unless `p_video_id ~ '^[A-Za-z0-9_-]{11}$'`. A null id is refused too.
- **Title:** `_clean_title(p_title)`, or `p_video_id` when nothing visible is left (`_title_key` of it is empty).
- **Thumbnail:** `_yt_thumb(p_video_id)` = `'https://i.ytimg.com/vi/' || p_video_id || '/mqdefault.jpg'`. `p_thumb` is ignored.
- **Duration:** `case when p_duration between 1 and 86400 then p_duration end`.
- The room rules (`_check_queue_rules`), the order limit and the approval status then run on these values, as today. The rules' banned-keyword check is given `_title_key(title)`.

**`add_queue_items(p_room_id uuid, p_session_token text, p_items jsonb)`:**
- An element whose `video_id` fails the pattern is skipped, as an empty id is today.
- Title, thumbnail and duration follow the same rules.

**`_clean_title(t text) returns text`**, `immutable`, private:
1. C and S characters become a space.
2. Runs of spaces collapse to one.
3. `btrim`, then `left(…, 200)`.

Z characters stay in the stored title: an emoji needs its variation selector (U+FE0F in "❤️") and its joiners (U+200D).

**`_title_key(t text) returns text`**, `immutable`, private: what the banned-keyword check compares. It removes the Z characters of a clean title, then collapses the runs of spaces again and trims, so a zero-width character cannot split a keyword.

**Existing rows** (idempotent):
- `queue_items.thumbnail_url` and `play_history.thumbnail_url` are rewritten to `_yt_thumb(youtube_video_id)` when the id matches the pattern, and set to `null` otherwise.

**What stays as it is:**
- The room rules still run on the title and duration the client declares, so a DevTools user can still slip a video past them.
- The song bonus still pays on the declared duration, bounded to 10 × 10 xu a day. Both wait for signed metadata (§16).
- No client change: the honest client already sends 11-character ids (`lib/youtube/parse.ts`, `search.ts`, `playlist.ts`) and keeps sending `thumb`, which is ignored.

### 6.3 H2 — the reel

The minigame runs in the browser, so a script can report a win (v14 trust model). This spec accepts that and adds a daily cap and detection.

**`start_cast(p_room_id uuid, p_session_token text)`** — after the hourly check, before the previous cast is abandoned:
```sql
if p.day_on = v_today and p.day_casts >= 300 then
  raise exception 'daily cast limit' using errcode = '53400',
    detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
end if;
```
On success it counts the cast:
```sql
update public.fishing_profiles
   set window_casts = window_casts + 1,
       day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
       day_on = v_today
 where account_id = v_account
returning day_casts into v_day;
```
When `v_day = 300`, it logs the soft signal `cast_daily_cap` (§7.4).

**`_fishing_state`** gains `casts_today_left` and `day_resets_at` (§10.4).

**The client:**
- `castBlocker` gains `"daily_limit"`, checked after `"cast_limit"`: `castsTodayLeft <= 0` and `day_resets_at` is still in the future on the server clock.
- The texts are in §12.4.

**Detection:**
- `reel_too_fast` (hard, §7.2) catches a win reported before the time gate.
- `reel_gate_hug` (soft, §7.4) flags a win that keeps landing right at the gate.

### 6.4 H3 — farm quality (D1)

- **In `0013`:** the v15.1 task makes `_farm_do_transplant` and `_farm_do_harvest` use 1.0 whatever `p_quality` is. The v15 smoke's "quality clamped" assertion becomes "quality ignored = 1".
- **In `0015`:** the public wrappers `transplant` and `harvest` gain the `quality_range` hard check (§7.2). It stays when v15.3 brings a real quality back.

### 6.5 H1 — lyrics (`0014`)

- **What `0014` does:** `0014_lyrics_lockdown.sql` and its client patch on `main` close H1. The lyrics RPCs require a session and the DJ role, anon writes are revoked, sizes are capped, and the broadcast becomes a hint.
- **This spec does not cover it.** `0015` does not depend on `0014`.
- The guard allowlist holds the lyrics RPCs `upsert_video_lyrics` and `update_video_lyric_offset` in both their `0011` and their `0014` signatures (§15.1), so either version passes.

## 7. Detection

### 7.1 Principles

1. **Detect on the server only.**
2. **A hard signal** is an input that no shipped client can produce, by construction, in any client version still deployed: v14 on `main`, v15.1 and the anti-cheat client.
   - Each one names the client code that makes it impossible.
   - Each one has a unit test that pins that code (§15.2).
3. **Refusals that can be race-prone or honest never count.** At most they are soft signals.
4. **Flagged calls return instead of raising (R1).** The lock refusal raises, because it has nothing to save.
5. **One strike per lock period.** Offences that arrive during a lock, or after a ban, are logged with the outcome `in_lock` and never escalate.
6. **Order of checks:** they run after authentication and the lock guard, before the body. A locked account's probes never reach them.

### 7.2 Hard signals (strike-eligible)

"Error" is the refusal the call would otherwise raise. It travels in the envelope's `error` (§9.1).

| Code | RPC | Strike when | Error | Why an honest client never sends it |
|---|---|---|---|---|
| `reel_too_fast` | `finish_cast` | `p_success = true`, the cast has not expired, and `now() < bite_at + 0.9·min_reel_ms`. This is the existing `too_early` branch. | none: the answer stays `{"result":"lost","why":"too_early"}` plus the envelope | See the timing argument below the table. |
| `quality_range` | `transplant`, `harvest` | `p_quality` is null, NaN or ±∞, or outside [0.9 − 1e-9, 1.1 + 1e-9]. NaN is larger than every number in PostgreSQL, so the range test catches it. | `invalid quality` | v15.1 sends exactly 1 (`useFarmController` `finishWork`). v15.3's `0.9 + 0.2·score/12` stays in range; the 1e-9 tolerance absorbs floating-point error. |
| `bad_plot` | the 24 plot RPCs (§10.3) | `p_plot` is null or outside 1–10 | `invalid plot` | Plot numbers come from `field_state` (`PlotView.no`) and from the map's plot interactables. `MAX_PLOT = 10`. |
| `bad_slot` | `dry_collect` | `p_slot` is null or outside 1–4 | `invalid slot` | `DryingPanel` loops over `1..DRYING_SLOTS` (4). |
| `bad_water` | `water` | `p_delta` is null or not ±1 | `invalid quantity` | `plotActions` sends `delta: 1` or `delta: -1` only (`lib/game/farm/actions.ts`). |
| `bad_work` | `begin_work` | `p_work` is null or not `transplant`/`harvest` | `invalid work` | `PlotRun.work` is `"transplant" \| "harvest"`. |
| `bad_work` | `tend_crop` (`0016`) | `p_act` is null or not `lat_day`/`vun_goc` | `invalid act` | `plotActions` emits acts only from the crop's config, whose act ids the v15.2 smoke pins to {`lat_day`, `vun_goc`}. |
| `bad_qty` | `buy_item`, **after** the kind check | bait `p_qty` null or outside 1–99; gear `p_qty` ≠ 1 | `invalid quantity` | `ShopPanel` sends bait `n` ∈ [1, `maxBuyQty` ≤ 99] and gear 1. Checking the kind first spares the old v14 client, which offers farm items as bait with quantities up to 99 (§7.3). |
| `bad_qty` | `buy_farm_item`, after the kind check | `p_qty` null or outside 1–99 | `invalid quantity` | `FarmShopPanel` `n` ∈ [1, min(`ITEM_CAP` − held, affordable)] through `Stepper`. |
| `bad_qty` | `sell_rice` | `p_kg` null or < 1, or `p_dry` null | `invalid quantity` | `RiceDepotPanel` `n` ∈ [1, stock] and "Bán hết" sends the stock (≥ 1). `dry` is a boolean. |
| `bad_qty` | `dry_start` | `p_kg` null or < 1 | `invalid quantity` | `DryingPanel` `n` ∈ [1, wet stock]; it only lists varieties with wet stock > 0. |
| `bad_qty` | `sell_produce` (`0016`), after `_wallet_lock` | `p_kg` null or < 1 | `invalid quantity` | `RiceDepotPanel`'s produce rows send kg ∈ [1, stock], and "Bán hết" sends the stock (≥ 1). |
| `bad_price` | `list_plot`, `set_sublease` | a non-null price outside 1–5 000 000 / 1–100 000 (the economy spec's caps) | `invalid price` | `CoopPanel` sends only prices that pass `toPrice` → `priceRefusal` → `priceOk`. `LandButton` stays disabled unless the refusal is null, including "" and "0". |
| `bad_price` | `offer_plot` | the price is null, or outside 1–5 000 000 | `invalid price` | as above; an offer always carries a price |
| `foreign_offer` | `withdraw_offer` | the id is an offer **of this room** whose buyer is someone else | `offer not found` | The panel offers "Rút" only for `mine.my_offers`. A replaced offer gets a new id (`0013` `_farm_do_offer`), so an old id never points at someone else's offer. |
| `foreign_offer` | `decline_offer`, `accept_offer` | the id is an offer **of this room** on a plot the caller does not own | decline `offer not found`, accept `not your plot` | The panel offers these only for `mine.incoming_offers`. Every change of owner deletes the plot's offers in the same transaction: `_land_sale`, `_farm_do_buy_plot`, `_farm_do_sell_to_village`, the reclaim in the sweep and the release in §9.6. The check runs before the sweep, and a pending sweep still shows the old owner. |

**Why an honest client never sends `reel_too_fast`:**
1. **The hook comes after `bite_at`.** The hook is allowed only once `performance.now() − answeredAt ≥ bite_ms` (`canHook`, `hooks/useCastSession.ts`). The answer arrives after the transaction that set `bite_at = now() + bite_ms`.
2. **The reel takes at least `min_reel_ms` of real time.** The reel needs `min_reel_ms` of simulated time: progress runs from 0.3 to 1 at 0.7/`min_reel` per second while the fish is in the zone (`lib/game/fishing/reel.ts`). Simulated time is at most real time, because rAF's `dt` is clamped to 50 ms (`components/game/fishing/ReelOverlay.tsx`).
3. **The request arrives later still.**
4. **`p_success = true` only comes from a won reel** (`reelDone`).

So an honest client always has `now() − bite_at ≥ min_reel_ms`. The margin over the gate is at least 0.1 × 2 480 ms = 248 ms, for cá sặc (difficulty 12). The v14 client on `main` has the same files.

### 7.3 Refusals that must never count

| Refusal | Where | Honest cause |
|---|---|---|
| `cast not found` | `finish_cast` | a double finish; `abandon` racing `end`; another tab's `start_cast` deleted the open cast |
| `expired` (a lost answer) | `finish_cast` | the tab was in the background (rAF pauses the reel); a slow network; a 60 s reel plus latency |
| `cast limit`, `daily cast limit`, `dig cooldown` | `start_cast`, `dig_worms` | two tabs; the UI countdown drifting from the server |
| `bait full`, `hands full`, `bucket full`, `not enough coins`, `already owned`, `no bait` | fishing | stale state; a double click; two tabs |
| `item not available` (farm kinds in `buy_item`) | fishing shop | **the old cached v14 client.** On `main`, `fetchFishingCatalog` reads every `shop_items` row and `shopItemFromRow` turns unknown kinds into `"bait"`. Logged as soft `kind_mismatch` only. |
| `invalid quantity` (more than 99 held) | `buy_farm_item` | two tabs bought the same item |
| `fish not found` | `sell_fish`, `release_fish` | two tabs |
| `too fast` | `transplant`, `harvest`, `water` | a retry after a lost answer (`work` was already cleared); a double start; two tabs; the water-log cap, since "Bơm thêm nước (giữ Sâu)" stays enabled at level 3 |
| `wrong phase`, `need water`, `not prepared`, `crop exists`, `no crop` | farm | phase boundaries on a synced clock; two tabs; another tab acted first |
| `no item`, `not enough rice`, `invalid item`, `invalid variety` | farm | two tabs used the last bag or kilogram; a catalog changed under a cached client |
| `drying full`, `invalid slot` (slot 1–4), `not ready` | `dry_*` | another member took the last slot; **the slot was collected twice** (the sweep auto-collected it, or another tab did, and it may now hold someone else's batch); clock drift |
| `price changed`, `offer expired`, `offer not found` (row gone or another room), `buyer cannot buy`, `not for sale`, `plot taken`, `leased`, `farm limit`, `already own land`, `not your plot` (own plot, or ownership changed), `invalid plot` (plot 1–10 of the wrong kind, or your own plot) | land | concurrent market actions; a lease ended; a reclaim; a sale in another tab; a room switch without a remount |
| `no snails` | `pick_snails` | someone picked them first |
| `too fast` (the part gate), `work expired`, `harvesting`, `harvester busy`, `lease ending`, `lease ends` | `harvest_part`, `begin_work`, `rent_harvester`, farm care (`0016`) | two tabs; a stale state; a disconnect; a lease or a harvester running out |
| `no sickle`, `no sprayer`, `already owned`, `wrong crop`, `invalid crop`, `not enough crop`, `invalid quantity` (a tool with a quantity other than 1) | farm, `load_sprayer`, `buy_farm_item`, `sell_produce` (`0016`) | stale state; two tabs; **the cached v15.1 client**, whose shop shows a stepper on tool rows and whose rice harvest gets `wrong crop` |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
| `invalid username`, `username already taken`, `invalid username or password` | account | typing |
| `too many messages, slow down` | chat | fast typing |
| `invalid session`, `account is not a member of this room`, `account banned`, `account locked` | any | logged out elsewhere; kicked; calls already in flight when the lock landed |

**Also never counted:** double clicks, reconnects, clock skew (every timing check uses the server's `now()` at both ends), slow networks (they only make things later), and a cached client just after a deploy.

### 7.4 Soft signals (logged for review, never a strike)

| Code | Where | Logged when | Why soft |
|---|---|---|---|
| `reel_gate_hug` | `finish_cast` (a catch) | the 20th catch of the Vietnam day with (`now − bite_at`)/`min_reel_ms` < 1.05. `anticheat_status.hug_on` and `hug_count` count them. | A skilled player on hard fish can get close. A bot that waits for the gate lands there every time. |
| `cast_daily_cap` | `start_cast` | the cast that brings the day's count to 300 | A long honest session can reach it. |
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide or (from `0016`) tool | catalogs change; v15.3 adds `critter_box` |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |

- **Not logged:** every refusal in §7.3.
- **Later, v15.3 (`0018`):** a soft counter for "the quality is always 1.1".

## 8. Data model

### 8.1 New tables

```sql
create table if not exists public.anticheat_config (          -- exactly one row
  id boolean primary key default true check (id),
  mode text not null default 'log' check (mode in ('log', 'enforce')),
  mode_changed_at timestamptz not null default now(),
  mode_changed_by uuid references public.accounts(id) on delete set null
);
insert into public.anticheat_config (id) values (true) on conflict (id) do nothing;   -- a re-run never resets the mode

create table if not exists public.anticheat_status (          -- one row per account ever flagged or counted
  account_id uuid primary key references public.accounts(id) on delete cascade,
  strikes smallint not null default 0 check (strikes between 0 and 2),
  last_strike_at timestamptz,
  last_strike_code text,
  locked_until timestamptz,
  ban_state text check (ban_state in ('pending_wipe', 'wiped')),   -- null = not banned by the anti-cheat
  banned_at timestamptz,
  wiped_at timestamptz,                                          -- the last wipe; kept after a pardon (R11)
  pardoned_at timestamptz,
  pardoned_by uuid references public.accounts(id) on delete set null,
  hug_on date,
  hug_count smallint not null default 0,
  events_on date,
  events_count smallint not null default 0
);

create table if not exists public.anticheat_events (          -- the evidence log: append-only, never wiped, no FK
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,                                       -- snapshot
  code text not null,                                           -- §7.2 / §7.4 codes
  outcome text not null check (outcome in ('soft', 'log_only', 'root', 'in_lock', 'strike_1', 'strike_2')),
  rpc text not null,
  room_id uuid,
  detail jsonb not null default '{}'::jsonb,                    -- inputs + server context; never a session token
  client text,                                                  -- X-Client-Info, at most 100 characters
  user_agent text,                                              -- User-Agent, at most 200 characters
  created_at timestamptz not null default now()
);
create index if not exists idx_ac_events_account on public.anticheat_events (account_id, created_at desc);
create index if not exists idx_ac_events_purge on public.anticheat_events (created_at)
  where outcome in ('soft', 'log_only', 'root', 'in_lock');

create table if not exists public.anticheat_wipes (           -- one row per confirmed wipe
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,
  wiped_at timestamptz not null default now(),
  wiped_by uuid,                                                -- root; no FK, the row outlives accounts
  snapshot jsonb not null                                       -- _ac_holdings() at the moment of the wipe (§9.6)
);
create index if not exists idx_ac_wipes_account on public.anticheat_wipes (account_id, wiped_at desc);
```

What goes in `detail`, per code:

| Code | `detail` |
|---|---|
| `reel_too_fast` | `cast_id`, `species_id`, `bite_at`, `min_reel_ms`, `finished_at`, `ratio` |
| `quality_range` | `plot`, `quality` (as text, so NaN and ∞ survive) |
| `bad_plot` | `plot` |
| `bad_slot` | `slot` |
| `bad_water` | `plot`, `delta` |
| `bad_work` | `plot`, `work` |
| `bad_qty` | `item` or `variety`, `qty` or `kg`, `dry` |
| `bad_price` | `plot`, `price` |
| `foreign_offer` | `offer_id` plus the offer's `buyer_id` (withdraw) or `plot` and `owner_id` (decline, accept) |
| `kind_mismatch` | `item`, `kind` |
| `reel_gate_hug` | `day`, `count`, `ratio` |
| `cast_daily_cap` | `day`, `casts` |

A client's text is cut before it is stored: `work` and `variety` keep at most 32 characters. `_ac_flag` also caps the whole detail: one whose text is longer than 2 000 characters is stored as `{"truncated": true, "head": <its first 2 000 characters>}`. An evidence row thus stays small, however large the tampered input.

### 8.2 Changed tables

- `fishing_profiles`:
  - `add column if not exists day_on date`
  - `add column if not exists day_casts smallint not null default 0`
- `chat_messages`: `system`, `about_account_id` and `idx_chat_about` (§6.1).
- `coin_ledger`: the reason check is replaced with the `0013` list plus `'wipe'`: `daily, song, sell, buy, rent, land_buy, land_sell, land_refund, lease_pay, lease_income, farm_buy, rice_sell, wipe`.

### 8.3 Access

- All four tables: `enable row level security`, no policies, and `revoke all … from anon, authenticated`.
- Nothing is readable by anon, not even the mode. Only SECURITY DEFINER functions touch them.

### 8.4 Retention

| Data | Kept | How |
|---|---|---|
| `anticheat_events` rows with outcome `strike_1` or `strike_2` | forever | never purged |
| every other event row | 90 days | `_ac_flag` deletes up to 500 such rows older than 90 days on each call (`idx_ac_events_purge`) |
| event rows per account | at most 200 non-strike rows per Vietnam day | `events_on` / `events_count`; strike rows are always written |
| `anticheat_status` | forever (one small row per account) | cascades if root deletes the account |
| `anticheat_wipes` | forever | — |

## 9. The flow

### 9.1 The envelope and the error codes

A flagged call returns HTTP 200, so PostgREST commits it:

```jsonc
{
  "anticheat": {
    "code": "bad_plot",          // the signal (§7.2, §7.4)
    "strike": 0,                 // 0 recorded only · 1 warning + 5-minute lock · 2 ban
    "error": "invalid plot",     // the refusal the call would otherwise raise; null for finish_cast
    "locked_until": null,        // strike 1: the end of the lock (server time)
    "banned": false,             // strike 2
    "server_now": "2026-10-02T10:15:00.000+00:00"
  }
}
```

- **Room and account RPCs** return the envelope alone. Nothing changed, so it carries no state.
- **`finish_cast`** returns its normal lost answer with the envelope merged in: `{"result":"lost","why":"too_early","state":{…},"anticheat":{…}}`. The cast is consumed, as before.
- **`strike` by outcome:**
  - `soft`, `log_only`, `root` and `in_lock` give 0;
  - `strike_1` gives 1;
  - `strike_2` gives 2.

**Raised errors (new):**

| Message | SQLSTATE | `details` | `hint` | Raised by |
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 42 game RPCs (35 in `0015`, 7 more in `0016`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
| `invalid username` | 22023 | — | — | `register` |
| `invalid video` | 22023 | — | — | `add_queue_item` |
| `daily cast limit` | 53400 | seconds until the next Vietnam midnight | — | `start_cast` |
| `not pending` | 22023 | — | — | `admin_anticheat_resolve` wipe of an account not waiting for one |
| `nothing to pardon` | 22023 | — | — | `admin_anticheat_resolve` pardon with no strike, lock or ban |
| `invalid action`, `invalid mode` | 22023 | — | — | admin RPCs |

The RPCs are POST, so postgrest-js never retries them. 42501 has no special handling in the client.

### 9.2 Helpers (private; `revoke all … from public, anon, authenticated`)

```sql
-- Lock gate for the 35 game RPCs. Reads stay open, so the UI can show the countdown.
create or replace function public._ac_guard(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_until timestamptz;
begin
  select locked_until into v_until from public.anticheat_status where account_id = p_account;
  if v_until > now() then
    raise exception 'account locked' using errcode = '42501', hint = 'anticheat',
      detail = ceil(extract(epoch from (v_until - now())))::int::text;
  end if;
end $$;
```

**The auth, lock and state helpers:**

| Helper | What it does |
|---|---|
| `_ac_account(p_session_token text) returns uuid` | `_auth_account(token)`, then `_ac_guard` |
| `_ac_play(p_room_id uuid, p_session_token text) returns uuid` | `_farm_auth(room, token)` (membership + `last_seen_at`), then `_ac_guard` |
| `_ac_lock_state(p_account uuid) returns jsonb` (`language sql stable`) | `{"until": locked_until, "code": last_strike_code}` while `locked_until > now()`, otherwise null |
| `_ac_hug(p_account uuid, p_ratio numeric, p_room uuid) returns void` | upserts the status row and adds one to `hug_count` for the Vietnam day (1 on a new day). When the count reaches exactly 20, it calls `_ac_flag(…, 'reel_gate_hug', 'finish_cast', {day, count: 20, ratio}, room, null, false)`. |

**The wipe and pardon helpers:**

| Helper | What it does |
|---|---|
| `_ac_holdings(p_account uuid) returns jsonb` | the snapshot shape of §9.6. The admin's preview uses it too. |
| `_ac_wipe(p_account uuid, p_by uuid) returns jsonb` | §9.6 |
| `_ac_pardon(p_account uuid, p_by uuid) returns void` | §9.7 |

**The name and queue helpers:**

| Helper | What it does |
|---|---|
| `_name_norm`, `_name_key` | §6.1 |
| `_clean_title`, `_title_key`, `_yt_thumb` | §6.2 |

**`_ac_flag(p_account uuid, p_code text, p_rpc text, p_detail jsonb, p_room uuid default null, p_error text default null, p_hard boolean default true) returns jsonb`** runs these steps:

1. It reads `mode` from `anticheat_config` with `for share` on its row (§9.9), and the account's `username` and `is_root`.
2. It creates the status row if missing (`on conflict do nothing`) and locks it with `select … for update`. This serializes one account's escalation.
3. **The strike window.** If `strikes = 1 and last_strike_at <= now() - interval '30 days' and ban_state is null`, it sets `strikes = 0`.
4. **The outcome** is the first of these that applies:
   1. not `p_hard` → `soft`;
   2. mode `log` → `log_only`;
   3. root → `root`;
   4. `ban_state is not null` or `locked_until > now()` → `in_lock`;
   5. `strikes = 0` → `strike_1`;
   6. otherwise → `strike_2`.
5. **The evidence row.** A strike row is always written. Any other row is written only while the day's `events_count` is under 200: on a new Vietnam day `events_on` becomes today and the count restarts; each row adds one.
   - The headers come from `nullif(current_setting('request.headers', true), '')::json`. The parse sits in a nested block, so a bad or missing value gives null.
   - `client = left(h->>'x-client-info', 100)` and `user_agent = left(h->>'user-agent', 200)`.
   - The username is a snapshot.
   - The detail is stored as given, unless its text is longer than 2 000 characters: then `{"truncated": true, "head": left(detail::text, 2000)}` (§8.1).
6. **`strike_1`:** `strikes = 1`, `last_strike_at = now()`, `last_strike_code = p_code`, `locked_until = now() + interval '5 minutes'`.
7. **`strike_2`:**
   - the status row gets `strikes = 2`, `last_strike_at = now()`, `last_strike_code = p_code`, `locked_until = null`, `ban_state = 'pending_wipe'` and `banned_at = now()`;
   - then `update accounts set is_banned = true`;
   - then it deletes the account's sessions, `for update skip locked`: a session that another call of the account holds is skipped, and the `is_banned` check refuses it from then on.
8. **The purge.** It deletes up to 500 non-strike event rows older than 90 days, `for update skip locked`, so it never waits for another call's purge.
9. It returns the envelope, with `strike`, `locked_until` and `banned` taken from the outcome.

### 9.3 Strike 1: the warning and the 5-minute lock

**Locked** (they raise `account locked` while `locked_until > now()`) — D2:
- **Fishing (8):** `claim_daily`, `dig_worms`, `buy_item`, `set_loadout`, `start_cast`, `finish_cast`, `sell_fish`, `release_fish`.
- **Farm and land (27):**
  - the 24 room actions: `rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `withdraw_offer`, `decline_offer`, `accept_offer`, `set_sublease`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`, `dry_start`, `dry_collect`;
  - plus `sell_rice`, `buy_farm_item` and `claim_farm_gift`.
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all. The gather RPCs come with v15.3's `0018` (§11.3).

**Still open:**
- the reads: `fishing_state`, `fishing_board`, `field_state`, `touch_room`;
- the account RPCs: `register`, `login`, `me`, `logout`;
- chat, the queue and playback, and room administration;
- `save_character`, feedback, the lyrics RPCs and every `admin_*` RPC.

**The client:**
- **The warning modal** shows the reason.
- **The chip** counts down 🔒 m:ss on the shared server clock.
- **A locked action** shows the lock toast built from the error's `details`.
- **After a reload during the lock:** `fishing_state.lock` brings the chip back, and the warning shows once more (R14).

### 9.4 One strike per lock, and the 30-day window

**Only one strike per lock.** The first hard signal of an unlocked account in enforce mode sets `locked_until`. Any other hard signal before that time is logged as `in_lock`:
- a request already in flight;
- a second tab;
- a call that raced the lock.

`_ac_flag`'s row lock makes the second request wait and then see the lock. The guard stops everything that starts later.

**Example timeline:**
- **T:** strike 1; locked until T + 5 min.
- **T + 2 min:** a request that was in flight → `in_lock`.
- **T + 6 min:** another hard signal → strike 2 and the ban.
- **31 days after a lone strike 1:** the window has passed, so the next hard signal is strike 1 again.

### 9.5 Strike 2: the ban, with the wipe pending

- **The ban, in the same transaction:**
  - `accounts.is_banned = true`;
  - `delete from sessions`;
  - `ban_state = 'pending_wipe'`.
- **Every call with the old token** then fails with `invalid session`, or with `account banned` for a session that another call held at that moment (§9.2 step 7).
- **`login`** answers `account banned`.
- **On the next page load**, `me` fails and the client clears the stored session.
- **Nothing is deleted until the owner decides**, with one exception: the land-market freeze at each room's next sweep (R10, step 0a in §9.6).
- **`fishing_board`** hides banned accounts, **`_song_bonus`** skips them, and **`_room_wealth`** leaves them out of the fish price index (R30).

### 9.6 The owner's wipe

`admin_anticheat_resolve(token, account, 'wipe')`:
1. `_auth_root`.
2. `_wallet_lock(account)`.
3. The status row, `for update`. It must have `ban_state = 'pending_wipe'`, else `not pending`.
4. `_ac_wipe(account, root)`:
   1. `v_snap := _ac_holdings(account)`;
   2. `insert into anticheat_wipes … returning id`;
   3. the deletes below;
   4. `ban_state = 'wiped'`, `wiped_at = now()`.

| Data | What happens |
|---|---|
| `wallets` | One last `coin_ledger` row (`delta = −coins`, `balance = 0`, `reason = 'wipe'`, `ref = 'wipe #<id>'`), then the wallet row is deleted. This clears xu and the daily and bonus counters. |
| `inventory` | All rows deleted: gear, bait, seeds, fertilizers, pesticides and (from `0016`) tools. |
| `fishing_profiles`, `casts`, `fish` | Deleted. |
| `personal_bests` | Deleted, so the records leave Bảng kỷ lục. |
| `rice_stock` | Deleted. |
| `produce_stock` (`0016`) | Deleted: the hoa màu. |
| The sprayer's tank (`0016`) | Emptied: `farm_profiles.tank_item` null and `tank_charges` 0. The profile stays, so the gift stays claimed. |
| Catch and land announcements (D6) | `delete from chat_messages where system and about_account_id = <account>`. Realtime DELETE events remove them from open chats. |
| `field_plots` owned | Released **lazily** by sweep step 0b at the next field call in that room: `owner_id`, `owned_at`, `sale_price` and `sublease_price` become null, and the plot's offers are deleted. There is **no refund**. A sublease held by another player keeps running; the plot is the village's once it ends. |
| `plot_leases` held | Deleted by step 0b. A village plot is free again; an owner's plot goes back to its owner, who keeps the rent. |
| `crops` farmed | Removed by the existing sweep step 4 once the plot has no farmer. A running harvester job is never paid (v15.2 R10). |
| `land_offers` made | Deleted by steps 0a and 0b. |
| `drying_slots` | Deleted by step 0b. The rice is lost. |

**Kept:**
- `anticheat_events`, `anticheat_status` and `anticheat_wipes` (the snapshot);
- `coin_ledger` (the audit trail);
- the `accounts` row, banned, so the name stays taken and the evidence stays linked;
- `account_secrets`, `members`, `characters`, `farm_profiles` (the gift stays claimed) and `feedback`;
- every chat message that is not a system line about the account.

**Why the land is released lazily:**
- The admin's transaction holds the cheater's wallet row.
- Taking other rooms' plot locks from there could deadlock with a `_land_sale` that pays the cheater, because that sale takes the plot locks first and the wallet second.
- The sweep already runs under the right locks. Nobody sees a field before its sweep has run.

**`_field_sweep(p_room, p_now)`, re-created with step 0 before the existing steps 1–7:**
```sql
-- 0a. banned accounts leave the land market: an anti-cheat ban (review pending or wiped) or a ban set by hand (R10)
delete from public.land_offers lo
 where lo.room_id = p_room
   and (exists (select 1 from public.accounts a where a.id = lo.buyer_id and a.is_banned)
        or exists (select 1 from public.anticheat_status s where s.account_id = lo.buyer_id and s.ban_state is not null));
update public.field_plots fp set sale_price = null, sublease_price = null
 where fp.room_id = p_room and (fp.sale_price is not null or fp.sublease_price is not null)
   and (exists (select 1 from public.accounts a where a.id = fp.owner_id and a.is_banned)
        or exists (select 1 from public.anticheat_status s where s.account_id = fp.owner_id and s.ban_state is not null));
-- 0b. a wipe releases what the account held at the time of the wipe, without refund (R11)
delete from public.plot_leases pl using public.anticheat_status s
 where pl.room_id = p_room and s.account_id = pl.farmer_id and s.wiped_at is not null and pl.starts_at <= s.wiped_at;
update public.field_plots fp set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
  from public.anticheat_status s
 where fp.room_id = p_room and s.account_id = fp.owner_id and s.wiped_at is not null
   and (fp.owned_at is null or fp.owned_at <= s.wiped_at);
delete from public.land_offers lo using public.anticheat_status s
 where lo.room_id = p_room and s.account_id = lo.buyer_id and s.wiped_at is not null and lo.created_at <= s.wiped_at;
delete from public.drying_slots d using public.anticheat_status s
 where d.room_id = p_room and s.account_id = d.account_id and s.wiped_at is not null
   and d.ready_at <= s.wiped_at + interval '3 hours';
-- 0c. offers on a plot that has no owner any more (a release above, or a deleted account)
delete from public.land_offers lo using public.field_plots fp
 where lo.room_id = p_room and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id is null;
```
Step 0 runs before step 3, the reclaim, so a wiped owner is never refunded. It also runs before step 7, the auto-collect, so a wiped account's batch is never turned into dry rice.

**The snapshot** (`_ac_holdings`; the same JSON is the admin's preview):
```jsonc
{
  "wallet": { "coins": 1230, "daily_on": "2026-10-01", "bonus_on": "2026-10-01", "bonus_count": 3 } | null,
  "inventory": [{ "item_id": "rod_bamboo", "qty": 1 }],
  "fishing_profile": { "rod": "rod_bamboo", "bobber": "bobber_feather", "bait": "bait_worm" } | null,
  "fish": [{ "species_id": "ca_tra", "weight_g": 3150, "price": 221, "caught_at": "…" }],
  "personal_bests": [{ "species_id": "ca_tra", "weight_g": 3150, "caught_at": "…" }],
  "rice": [{ "variety": "nep", "wet_kg": 0, "dry_kg": 70 }],
  "plots": [{ "room_id": "…", "plot_no": 3, "kind": "private", "owned_at": "…", "sale_price": null, "sublease_price": 300 }],
  "leases": [{ "room_id": "…", "plot_no": 7, "source": "village", "price": 250, "until": "…" }],
  "offers": [{ "room_id": "…", "plot_no": 2, "price": 8000, "created_at": "…" }],
  "crops": [{ "room_id": "…", "plot_no": 7, "variety": "nep", "transplant_at": "…" }],
  "drying": [{ "room_id": "…", "slot": 2, "variety": "nep", "kg": 70, "ready_at": "…" }],
  "announcements": 4
}
```

### 9.7 Pardon

`admin_anticheat_resolve(token, account, 'pardon')`, and `admin_set_ban(token, account, false)` when the account has an anti-cheat `ban_state` (R9), both run `_ac_pardon`:
1. `accounts.is_banned = false`, only when `ban_state` is not null. A ban that root set by hand in the Accounts tab stays: the pardon clears the strikes and the lock of such an account, not its ban.
2. The status row gets `strikes = 0`, and these become null: `last_strike_at`, `last_strike_code`, `locked_until`, `ban_state`, `banned_at`.
3. `pardoned_at = now()` and `pardoned_by = root`.
4. `wiped_at` is kept (R11).

**Pardon after a wipe:** the account logs in again with zero data, and the snapshot stays in `anticheat_wipes` (R8).

**Refused:** `nothing to pardon` (22023) when the account has no active strike, no lock and no `ban_state`.

### 9.8 Root, log mode and the mode switch

- **Root accounts:** their hard signals are logged with the outcome `root` (in enforce mode) and are never locked or banned. The envelope has `strike: 0`.
- **Log mode (the default at deploy, D5):** every flagged call returns `strike: 0` and is logged `log_only`. Nothing is locked or banned. Log-mode rows never count later (R7).
- **`admin_anticheat_set_mode(token, 'log' | 'enforce')`:**
  - it records `mode_changed_at` and `mode_changed_by`;
  - switching to `log` also runs `update anticheat_status set locked_until = null where locked_until > now()` (R6).
- **The 7-day review, before enforcing:**
  1. List the `log_only` rows of hard codes in the tab.
  2. For each one, ask whether an honest client could have sent it (§7.2).
  3. If any doubt remains, stay in log mode and fix the check.
  4. Otherwise switch to enforce.

### 9.9 Concurrency

- `_ac_flag` reads the config row `for share`, then locks the account's status row, `for update`.
- `admin_anticheat_set_mode` updates the config row, so it waits for the flags already in flight, and a flag that starts after it reads the new mode. No lock or ban lands after a switch to `log`: a lock set in flight is lifted by the switch itself.
- Callers of `_ac_flag` hold either the wallet lock (`finish_cast`, `buy_item`, `buy_farm_item`, `sell_rice`, `start_cast`) or no lock (the room wrappers, which check before `_farm_do_*`).
- `_ac_flag` never takes a wallet lock.
- At strike 2, `_ac_flag` skips the session rows that other calls of the account hold (`skip locked`), and its purge skips rows another call is purging, so neither waits for another call.
- The admin resolve takes the wallet row, then the status row.

So every path takes the wallet row before the status row, or takes only one of them. There is no cycle (R16).

## 10. RPC changes

Every re-created public RPC keeps its signature and gets `grant execute … to anon, authenticated`.

### 10.1 Account, chat and queue

| RPC | Change |
|---|---|
| `register(text, text)` | Name rules (§6.1). |
| `login(text, text)` | Normalized lookup; the ban check after the password (§6.1). |
| `admin_set_ban(text, uuid, boolean)` | Unbanning an account with an anti-cheat `ban_state` runs `_ac_pardon` (R9). Otherwise unchanged. |
| `add_queue_item(uuid, text, text, text, text, integer)` | Id pattern, title, derived thumbnail, duration range (§6.2). |
| `add_queue_items(uuid, text, jsonb)` | The same checks per element; invalid ids are skipped. |

### 10.2 Fishing (`0012`, with `buy_item` from `0013`)

Every one of these swaps `_auth_account` for `_ac_account`. The bodies are otherwise copied from `0012`/`0013`.

| RPC | Checks after the guard, in order |
|---|---|
| `claim_daily(text)` | — |
| `dig_worms(text)` | — |
| `buy_item(text, text, integer)` | After `_wallet_lock`, `_fishing_profile` and reading the item: `kind_mismatch` (soft, error `item not available`), then `bad_qty` (hard). An unknown or unpriced item still raises `item not available`, unlogged. |
| `set_loadout(text, text, text, text)` | — |
| `start_cast(uuid, text)` | `_auth(room, token, 'any')`, then `_ac_account`; the hourly cap; the daily cap (§6.3); `cast_daily_cap` (soft) on the 300th cast. |
| `finish_cast(text, uuid, boolean)` | After the single-use delete: `reel_too_fast` (hard). After a catch, `_ac_hug` when the ratio < 1.05. The announcement is posted with `system = true` and `about_account_id`. |
| `sell_fish(text, uuid[])`, `release_fish(text, uuid)` | — |
| `fishing_state(text)` | Unchanged. It inherits the new `_fishing_state` keys. |
| `fishing_board(uuid, text)` | `records`, `richest` and `my_rank` skip accounts with `is_banned` (R30). |

**The `finish_cast` branch:**
```sql
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;        -- numeric
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then   -- the existing gate, unchanged
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3)),
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account))
           || coalesce(v_ac, '{}'::jsonb);
  end if;
```

### 10.3 Farm (`0013`)

**The 24 room wrappers** become `language plpgsql`:
1. `declare v_account uuid := public._ac_play(p_room_id, p_session_token);`
2. the checks below, in order;
3. `return public._farm_do_…(p_room_id, v_account, …, now());`

**The 24 plot RPCs** are the ones that check `bad_plot`: `rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `set_sublease`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`, and from `0016` `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop` and `tend_crop`.

| RPC | Checks after the guard, in order |
|---|---|
| `rent_plot`, `buy_plot`, `sell_plot_to_village`, `buy_listed_plot`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `sow_seed`, `pick_snails` | `bad_plot` |
| `list_plot`, `set_sublease` | `bad_plot`, then `bad_price` (a non-null price out of range) |
| `offer_plot` | `bad_plot`, then `bad_price` (null or out of range) |
| `withdraw_offer` | `foreign_offer` (the buyer) |
| `decline_offer`, `accept_offer` | `foreign_offer` (the plot's owner) |
| `apply_fertilizer`, `soak_seed`, `spray` | `bad_plot`, then `kind_mismatch` (soft, error `invalid item`) when the item exists with another kind than `fertilizer` / `seed` / `pesticide` |
| `begin_work` | `bad_plot`, then `bad_work` |
| `transplant`, `harvest` | `bad_plot`, then `quality_range` |
| `water` | `bad_plot`, then `bad_water` |
| `prepare_beds`, `harvest_part`, `rent_harvester` (`0016`) | `bad_plot` |
| `plant_crop` (`0016`) | `bad_plot`, then `kind_mismatch` (soft, error `invalid item`) when the item exists with another kind than `seed` |
| `tend_crop` (`0016`) | `bad_plot`, then `bad_work` (error `invalid act`) |
| `dry_start` | `bad_qty` (kg) |
| `dry_collect` | `bad_slot` |

**The account-only farm RPCs** use `_ac_account`:

| RPC | Checks |
|---|---|
| `sell_rice(text, text, boolean, integer)` | After `_wallet_lock`: `bad_qty` (kg, dry), then the existing variety check. |
| `buy_farm_item(text, text, integer)` | After reading the item: `kind_mismatch` (soft, error `item not available`), then `bad_qty`. More than 99 held still raises `invalid quantity` unlogged (§7.3). From `0016` a `tool` is a farm kind too, and a tool with a quantity other than 1 raises `invalid quantity` unlogged (v15.2 R18). |
| `claim_farm_gift(text)` | — |
| `load_sprayer(text, text)` (`0016`) | `kind_mismatch` (soft, error `invalid item`) when the item exists with another kind than `pesticide`. |
| `sell_produce(text, text, integer)` (`0016`) | After `_wallet_lock`: `bad_qty` (kg). |

`touch_room(uuid, text)` and `field_state(uuid, text)` are unchanged, and not guarded.

**An example wrapper:**
```sql
create or replace function public.water(p_room_id uuid, p_session_token text, p_plot integer, p_delta integer)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'water', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_delta is null or p_delta not in (1, -1) then
    return public._ac_flag(v_account, 'bad_water', 'water', jsonb_build_object('plot', p_plot, 'delta', p_delta),
                           p_room_id, 'invalid quantity');
  end if;
  return public._farm_do_water(p_room_id, v_account, p_plot, p_delta, now());
end $$;
grant execute on function public.water(uuid, text, integer, integer) to anon, authenticated;
```

### 10.4 Shared private functions (re-created)

**`_fishing_state(p_account)`** keeps every key it has in `0013`, `server_now` included, and gains three:

```jsonc
"casts_today_left": 300,            // 300 − today's casts (Vietnam day), never below 0
"day_resets_at": null,              // the next Vietnam midnight, only while casts_today_left = 0
"lock": null                        // or { "until": "…", "code": "reel_too_fast" } while locked (_ac_lock_state)
```

**The other re-created functions:**
- **`_field_sweep(p_room, p_now)`:** step 0 (§9.6), then steps 1–7 unchanged.
- **`_land_sale`:** the announcement insert gains `system = true` and `about_account_id = p_buyer`; nothing else changes.
- **`_song_bonus`:** it also returns early when the adder `is_banned` (R30); nothing else changes.
- **`_room_wealth(p_room, p_now)`** (`0013` section H, the fish price index): a member who `is_banned` counts neither in the average nor in the "fewer than 2" test (R30); nothing else changes.

### 10.5 Admin RPCs (new; each runs `_auth_root` first; granted to anon and authenticated like the other `admin_*` RPCs)

**`admin_anticheat_list(p_session_token text) returns jsonb`**

A case is any status row with one of these:
- strikes > 0;
- a `ban_state`;
- a lock;
- a `pardoned_at`;
- an event in the last 90 days.

The order is: pending wipes, then locked accounts, then by the last event, newest first. At most 200 cases.

```jsonc
{
  "mode": "log", "mode_changed_at": "…", "server_now": "…",
  "cases": [{
    "account_id": "…", "username": "Dat", "is_root": false, "is_banned": false,
    "strikes": 1, "active_strikes": 1,        // 2 while banned; 1 while the 30-day window runs; else 0
    "last_strike_at": "…", "last_strike_code": "reel_too_fast",
    "locked_until": "…" | null, "ban_state": null | "pending_wipe" | "wiped",
    "banned_at": null, "wiped_at": null, "pardoned_at": null,
    "hard_events": 3, "soft_events": 12, "last_event_at": "…"
  }]
}
```

**`admin_anticheat_account(p_session_token text, p_account_id uuid) returns jsonb`**

```jsonc
{
  "case": { /* the list row */ },
  "holdings": { /* _ac_holdings now: what a wipe would remove */ },
  "events": [{ "id": 1, "created_at": "…", "code": "…", "outcome": "…", "rpc": "…", "room_id": "…" | null,
               "detail": { }, "client": "…" | null, "user_agent": "…" | null }],          // newest 300
  "wipes": [{ "id": 1, "wiped_at": "…", "wiped_by": "rootname" | null, "snapshot": { } }]
}
```

**The two write RPCs:**
- **`admin_anticheat_resolve(p_session_token text, p_account_id uuid, p_action text) returns jsonb`:** `p_action` is `wipe` (§9.6) or `pardon` (§9.7), else `invalid action`. It returns the updated case row.
- **`admin_anticheat_set_mode(p_session_token text, p_mode text) returns jsonb`:** `p_mode` is `log` or `enforce`, else `invalid mode`. It returns `{ "mode", "mode_changed_at" }`.

## 11. Migration `0015_anticheat.sql`

### 11.1 Sections

The sections are in this order, because `language sql` bodies are checked when they are created:

| Section | Contents |
|---|---|
| **A** Accounts and chat | `_name_norm`, `_name_key`, `_clean_title`, `_title_key`, `_yt_thumb`; `register`, `login`; `chat_messages.system`, `about_account_id`, `idx_chat_about`, the backfill. |
| **B** Queue | `add_queue_item`, `add_queue_items`; the thumbnail rewrite of `queue_items` and `play_history`. |
| **C** Tables | `anticheat_config` and its row, `anticheat_status`, `anticheat_events`, `anticheat_wipes` with their indexes, RLS and revokes; `fishing_profiles.day_on` and `day_casts`; the `coin_ledger` reason check with `'wipe'`. |
| **D** Helpers | `_ac_guard`, `_ac_account`, `_ac_play`, `_ac_flag`, `_ac_hug`, `_ac_lock_state`, `_ac_holdings`, `_ac_wipe`, `_ac_pardon`. Each is `revoke all … from public, anon, authenticated`. |
| **E** Guarded RPCs | the 8 fishing and 27 farm RPCs (§10.2, §10.3) and `_land_sale`, with explicit grants. |
| **F** Shared functions | the private `_fishing_state`, `_field_sweep`, `_song_bonus` and `_room_wealth`, and the public read `fishing_board` (with its grant). |
| **G** Admin | `admin_anticheat_list`, `admin_anticheat_account`, `admin_anticheat_resolve`, `admin_anticheat_set_mode`, `admin_set_ban`, with grants. |

### 11.2 Re-running

Re-running is safe:
- The DDL uses `if not exists`, `create or replace` and `drop constraint if exists` + `add constraint`.
- The config row is inserted with `on conflict do nothing`, so a re-run never flips `enforce` back to `log`.
- The backfill touches only `system = false` rows.
- The thumbnail rewrite uses `is distinct from`.
- Grants and revokes are idempotent.

### 11.3 Rules for later migrations

1. **A re-created game RPC keeps its guard.** Any `create or replace` of a guarded RPC keeps its `_ac_account`/`_ac_play` call, its hard checks and its explicit grant.
2. **New game RPCs start guarded** (deny by default, R23). For `0016` (v15.2): `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`. The gather RPCs `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters` come with `0018` (v15.3).
   - `crab_finish` with `hits` outside 0–3 is a hard `bad_qty`.
   - A `crab_finish` faster than its 3 s gate never counts, for the same retry and double-start reasons as `too fast`.
3. **Re-created shared functions keep this spec's parts:**
   - `_field_sweep` keeps step 0;
   - `_fishing_state` keeps `lock`, `casts_today_left` and `day_resets_at`;
   - `_song_bonus` and `_room_wealth` keep the banned check;
   - `_land_sale` and `finish_cast` keep `system` and `about_account_id`.
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, then v15.3's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
6. **Every later smoke run ends with `tests/sql/anticheat-guards.sql`.** The dynamic loop in that file gains the new game RPCs, and a new RPC that is not a game action joins its allowlist by signature.
7. **Re-running `0013` after `0015` undoes the guards.** `0013` re-creates the game RPCs and the `coin_ledger` reason check without the anti-cheat parts. After any re-run of `0013`, run `0015` again right away. On a database that has already seen a wipe, `0013`'s reason check (without `'wipe'`) fails, so add `'wipe'` to its list first. Later migrations follow the same order: `0013` → `0015` → the rest.

### 11.4 Pre-deploy checks (owner, in the SQL editor, before running `0015`)

```sql
-- 1. Names that the new rules would refuse (they keep working; decide per account whether to ban or delete).
select id, username, created_at from public.accounts
 where regexp_replace(lower(extensions.unaccent(normalize(username, NFC))), '[^a-z0-9]+', '', 'g')
       in ('aoca','hoptacxa','hethong','quantri','quantrivien','admin','root','system')
    or username ~ '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff]'
    or normalize(username, NFC) ~ '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]'
    or char_length(username) not between 2 and 24
 order by created_at;
-- 2. Author-less announcer lines: the backfill marks the well-formed ones as system lines.
select id, room_id, username, left(body, 80) as body, created_at from public.chat_messages
 where account_id is null and username in ('Ao cá', 'Hợp tác xã')
 order by created_at;
```

If query 1 shows that a look-alike announcer account ever existed and was deleted, the owner deletes its forged `[catch:`/`[land:` lines from query 2 before running `0015`.

### 11.5 Deploy order

1. `0012`, if still pending. The v14 client on `main` is already live.
2. `0014_lyrics_lockdown.sql` and its client patch on `main`. This step is independent.
3. `0013` (with D1) and the v15.1 client.
4. The pre-deploy checks (§11.4), then `0015`. It starts in `log` mode.
5. The anti-cheat client, after `0015`. A client that goes live first by mistake still loads the chat, because it reads the messages again without `chat_messages.system` (§6.1), but it shows the catch and land announcements as plain lines until `0015` runs.
6. After 7 days, the review (§9.8), then `enforce` in /admin.
7. Later, `0016_v15_2_crops.sql` (v15.2), then `0017_v16_cards.sql` (v16) and `0018_v15_3_gather.sql` (v15.3), keeping the guards (§11.3).

**`0015` before the anti-cheat client is safe.** The v15.1 client against `0015` sees these differences only:
- the raw English texts `invalid username` and `account banned` on the auth screen;
- "Có lỗi, thử lại nhé." for `daily cast limit` and for envelopes, which only tampered calls get;
- and nothing else.

**The README** gains an "Anti-cheat" section:
- what is detected and what is not;
- the modes, how to review, and the deploy order;
- the updated trust models (v14: the daily cap; v15: quality ignored until v15.3).

## 12. Client and Vietnamese UI

### 12.1 `lib/anticheat.ts` and the RPC wrappers

**`lib/anticheat.ts`** is pure, apart from a small event hub:
- `interface AnticheatInfo { code: string; strike: 0 | 1 | 2; error: string | null; lockedUntil: number | null; banned: boolean; serverNow: number | null }`
- `parseAnticheat(data: unknown): AnticheatInfo | null`: reads `data.anticheat`, and returns null when it is absent or malformed.
- `class AnticheatError extends Error { info: AnticheatInfo }`. Its `message` is `info.error ?? "anticheat"`, so the existing `fishingErrorMessage` / `farmErrorMessage` switches map a `strike: 0` refusal as before.
- `lockSeconds(err: unknown): number | null`: `Number(details)` when `message === "account locked"`.
- `durationVi(sec)`, `lockText(sec)`, `chipText(sec)`, `chipLabel(sec)`, `reasonText(code)` and the constants in §12.2.
- `reportAnticheat(info)`, `reportLock(untilMs, code)`, `reportNoLock()`, `subscribeAnticheat(fn): () => void`.

**`call()` in `lib/game/fishing/rpc.ts` and `lib/game/farm/rpc.ts`:**
1. On `error.message === "account locked"`, it reports the lock (`serverNow() + seconds`), then throws as today.
2. When `parseAnticheat(data)` finds an envelope:
   1. it calls `syncClock(server_now)`;
   2. if `strike > 0`, it calls `reportAnticheat(info)`;
   3. it throws `AnticheatError`, except for `finish_cast`.
3. For `finish_cast`, `finishCast` returns the lost result with `anticheat: AnticheatInfo | null`, and `useCastSession` skips the lost toast when `strike ≥ 1`.

**The hooks:**
- `useFishing.act` and `useField.call` skip the toast when the error is an `AnticheatError` with `strike ≥ 1`, because the modal shows instead. They still reload.
- `parseFishingState` adds `castsTodayLeft` (default 300), `dayResetsAt` and `lock`.
- `useFishing` calls `reportLock` when an applied state has `lock`, and `reportNoLock` when it has none.

**`hooks/useAnticheat.ts`** gives the shell `{ modal: "warn" | "ban" | null, reason, secondsLeft, dismiss }`:
- the warning shows once per `lockedUntil` per page load;
- the countdown ticks every second on `serverNow()`;
- `reportNoLock` ends the countdown at once, so a pardon or a switch to log mode does not leave the chip counting.

**The components:**
- `AnticheatModal` uses `ParchmentModal`.
  - Its button (`Tôi đã hiểu` or `Đăng xuất`) has the initial focus (`autoFocus`).
  - The warning closes with its button, ✕ or Esc.
  - The ban modal calls `useAuth().logout()` on its button and on any close (R15).
  - While either is open, the canvas takes no input, and Esc belongs to the modal: it does not cancel the farm work.
- `AnticheatChip` renders in `GameShell`'s player card under `FishingHud` while `secondsLeft > 0`.

### 12.2 Warning, lock and ban (verbatim)

| Constant | Text |
|---|---|
| `WARN_TITLE` | `⚠️ Cảnh báo gian lận` |
| `WARN_BODY` | `Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).` |
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
| `WARN_OK` | `Tôi đã hiểu` |
| `BAN_TITLE` | `🚫 Tài khoản bị khoá vĩnh viễn` |
| `BAN_BODY` | `Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.` |
| reason line | `Lý do: {reasonText(code)}` |
| `BAN_WIPE` | `Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).` |
| `BAN_OK` | `Đăng xuất` |
| `reasonText("reel_too_fast")` | `Báo kéo được cá nhanh hơn mức trò chơi cho phép.` |
| `reasonText("quality_range")` | `Gửi điểm cấy/gặt ngoài phạm vi của trò chơi.` |
| `reasonText(other)` | `Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.` |
| `lockText(sec)` | `🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn {durationVi(sec)}.` |
| `chipText(sec)` | `🔒 {m}:{ss}` (for example `🔒 4:07`) |
| `chipLabel(sec)` (`title` and `aria-label`) | `Tạm khoá trò chơi — còn {durationVi(sec)}` |

`durationVi(sec)` first takes `n = max(1, ceil(sec))`, `m = floor(n / 60)` and `s = n % 60`, then gives:
- `{s} giây` when `m = 0`;
- `{m} phút` when `s = 0`;
- `{m} phút {s} giây` otherwise.

The numbers are below 1 000, so the `vi-VN` format adds no separator.

### 12.3 Login and register (`components/auth/AuthScreen.tsx`)

| Server | Text |
|---|---|
| `invalid username` | `Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.` |
| `account banned` | `🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.` |
| `username already taken`, `invalid username or password` | unchanged |

The refusal shows in a `role="alert"` line, so a screen reader reads it out.

### 12.4 Fishing texts (`lib/game/fishing/messages.ts`, `rpc.ts`)

| Where | Text |
|---|---|
| `DAILY_LIMIT_TEXT`; `blockerText("daily_limit")`; `fishingErrorMessage` for `daily cast limit` | `Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!` |
| `promptText` at a fishing spot while `daily_limit` | `Hết lượt câu hôm nay` |

### 12.5 /admin tab "Chống gian lận" (`components/admin/AnticheatTab.tsx`)

**The page:**
- `app/admin/page.tsx` gains the tab `{ id: "anticheat", label: "Chống gian lận" }` after "Thống kê".
- `lib/admin.ts` gains:
  - `adminAnticheatList(token)`;
  - `adminAnticheatAccount(token, accountId)`;
  - `adminAnticheatResolve(token, accountId, action)`;
  - `adminAnticheatSetMode(token, mode)`.
- After each action the tab reloads the list, and the open account's evidence too.

**Formats:**
- xu through `formatXu` ("1.230 xu");
- kilograms and counts through `toLocaleString("vi-VN")`;
- times through `new Date(x).toLocaleString("vi-VN")`.

**The page strings:**

| Element | Text |
|---|---|
| heading | `🛡️ Chống gian lận` |
| mode line | `Chế độ: {Chỉ ghi nhận \| Thi hành} · từ {time}` |
| mode buttons (`aria-pressed` on the current one) | `Chỉ ghi nhận` · `Thi hành` |
| mode help | `Chỉ ghi nhận: lưu vi phạm, không khoá ai. Thi hành: vi phạm lần 1 khoá trò chơi 5 phút, lần 2 cấm tài khoản; dữ liệu chỉ bị xoá khi bạn xác nhận.` |
| confirm → enforce | `Bật chế độ Thi hành? Từ giờ vi phạm lần 1 bị khoá trò chơi 5 phút, lần 2 bị cấm tài khoản.` |
| confirm → log | `Chuyển về Chỉ ghi nhận? Các lượt khoá 5 phút đang chạy sẽ được gỡ; tài khoản đã bị cấm vẫn bị cấm.` |
| loading | `Đang tải…` |
| empty | `Chưa có ghi nhận nào.` |
| footnote | `Ghi nhận mềm, ghi nhận lúc chỉ ghi nhận, của root hoặc lúc đang khoá được giữ 90 ngày; vi phạm và dữ liệu đã xoá được giữ lâu dài.` |

**A case card:**

| Element | Text |
|---|---|
| line 1 | `{username}` (bold, with ` 👑` for root) ` · {status}` |
| line 2 | `Vi phạm {active_strikes}/2 · {hard_events} cứng · {soft_events} mềm · lần cuối {time}` |
| status: pending wipe | `🚫 Đã cấm — chờ xoá dữ liệu` |
| status: wiped | `🚫 Đã cấm — đã xoá dữ liệu` |
| status: banned by hand (`is_banned` without `ban_state`; a pardon does not lift it, §9.7) | `Khoá tay` |
| status: locked | `🔒 Đang khoá đến {time}` |
| status: strike 1 in its window | `⚠️ Cảnh cáo (1/2)` |
| status: pardoned, nothing active | `🕊️ Đã ân xá` |
| status: otherwise | `Chỉ có ghi nhận` |
| buttons | `Bằng chứng` / `Ẩn bằng chứng` (with `aria-expanded`) · `Xoá dữ liệu` (pending wipe only) · `Ân xá` (any active strike, lock or ban) |
| confirm wipe | `Xoá toàn bộ dữ liệu trò chơi của {username}? Xu, đồ, cá, kỷ lục và lúa bị xoá ngay; đất được trả về làng ở lần mở ruộng kế tiếp. Không hoàn tác được.` |
| confirm pardon | `Ân xá {username}? Tài khoản được mở khoá và xoá vi phạm.` followed, when wiped, by ` Dữ liệu đã xoá không được khôi phục.` |

**The evidence panel:**

| Element | Text |
|---|---|
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat` |
| events heading | `Ghi nhận ({n})` |
| event line | `{time} · {code label} · {outcome label} · {rpc}`, then `detail` in a `<pre>` |
| event footer | `Client: {client \| —} · Trình duyệt: {user_agent \| —}` |
| wipes heading | `Đã xoá dữ liệu` |
| wipe line | `{time} · bởi {wiped_by \| —}` with `Xem dữ liệu đã xoá` / `Ẩn` around the snapshot `<pre>` |

**Errors:**

| Error | Text |
|---|---|
| `not pending` | `Tài khoản này không còn chờ xoá dữ liệu.` |
| `nothing to pardon` | `Tài khoản này không có gì để ân xá.` |
| the action went through, but the reload after it failed | `Đã xong — tải lại danh sách không được, thử lại.` |
| anything else | `Có lỗi, thử lại nhé.` |

After a refused action, its reason stays even when the reload fails too.

**Code labels:**

| Code | Label |
|---|---|
| `reel_too_fast` | `Kéo cá quá nhanh` |
| `quality_range` | `Điểm cấy/gặt sai` |
| `bad_plot` | `Số thửa sai` |
| `bad_slot` | `Số ô phơi sai` |
| `bad_water` | `Mức bơm/tháo nước sai` |
| `bad_work` | `Việc đồng sai` |
| `bad_qty` | `Số lượng sai` |
| `bad_price` | `Giá đất sai` |
| `foreign_offer` | `Đụng đề nghị của người khác` |
| `kind_mismatch` | `Sai loại vật phẩm` |
| `reel_gate_hug` | `Kéo cá sát ngưỡng (20 lần/ngày)` |
| `cast_daily_cap` | `Chạm 300 lần câu/ngày` |

**Outcome labels:**

| Outcome | Label |
|---|---|
| `soft` | `Tín hiệu mềm` |
| `log_only` | `Chỉ ghi nhận` |
| `root` | `Root — miễn` |
| `in_lock` | `Khi đang khoá/cấm` |
| `strike_1` | `Vi phạm 1 → khoá 5 phút` |
| `strike_2` | `Vi phạm 2 → cấm` |

### 12.6 The build header

- **`next.config.ts`** sets `env: { NEXT_PUBLIC_CLIENT_BUILD: … }`. The value is:
  - the first 7 characters of `VERCEL_GIT_COMMIT_SHA`, else of `CF_PAGES_COMMIT_SHA`;
  - else the build time as `YYYYMMDDHHmm` (UTC).
- **`lib/supabase.ts`** passes `global: { headers: { "X-Client-Info": \`music-together/${process.env.NEXT_PUBLIC_CLIENT_BUILD ?? "dev"}\` } }`.
  - The exact key `X-Client-Info` overrides supabase-js's default header of the same name; its objects are merged key by key.
  - Supabase's CORS already allows the header.
- The evidence row reads the header and `User-Agent` from `request.headers`. The manual pass verifies both on the hosted project (§15.4).

## 13. Errors → Vietnamese

| Server | Where | Vietnamese |
|---|---|---|
| `account locked` (`details` = seconds) | `fishingErrorMessage`, `farmErrorMessage` | `lockText(seconds)` |
| `daily cast limit` | `fishingErrorMessage` | `Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!` |
| `account banned` | `AuthScreen` (login) | §12.3 |
| `account banned` | `fishingErrorMessage`, `farmErrorMessage` | unchanged: `Tài khoản đã bị khoá.` |
| `invalid username` | `AuthScreen` | §12.3 |
| envelope `strike: 0` | the RPC's error function | its `error`, mapped as before. For example, `invalid quantity` in the fishing shop gives `Món này không mua được.`, and `invalid price` gives `Số không hợp lệ.` |
| envelope `strike: 1` | `useFishing`, `useField` | no toast: the warning modal (§12.2) |
| envelope `strike: 2` | `useFishing`, `useField` | no toast: the ban modal, then logout |
| `invalid quality`, `invalid video`, `invalid slot`, `invalid work`, `invalid item` | — | not mapped: an honest client cannot trigger them. The generic `Có lỗi, thử lại nhé.` stays. |
| admin errors | `AnticheatTab` | §12.5 |

## 14. Realtime client hardening

The server never sees Broadcast, so everything here runs in the receiving client. The helpers are pure and have unit tests.

**1. Presence filter** (`GameCanvas`, with a new prop `isHere(accountId)` from `GameShell`):
- `bye`, `lk`, `fs` and `fa` from another account are accepted only when the sender is a member **and** is in this room's presence with `mode = "game"` and `map` = this map.
- `hello` and `fp` need the sender to be a member only (R34). Presence arrives at least 1 s late, and a newcomer's `hello` must be answered at once, as a changed plot must be fetched. Their budgets bound them: `hello` 1 per 10 s (2 below) and the `fp` refetch gap (3 below).
- My own id keeps today's handling.
- Movement needs membership only, and a roster entry before an actor is drawn (`lib/game/world.ts` `needsActor`). So the others draw a newcomer, and take their `fs`, once the newcomer's presence arrives; the last movement is kept until then.
- A member who newly appears in this map's roster calls the reply scheduler once, as a `hello` would (R34). This covers a `hello` that the budget dropped, for example after a quick return through a portal. When the answer to the newcomer's `hello` already went out, it costs one more answer.

**2. Per-sender receive budgets** (`lib/game/net/budget.ts`, token buckets keyed by sender and kind):

| Message | Budget per sender | Over budget |
|---|---|---|
| `st`, `mv`, `pa` | 5 per s, burst 5 | dropped; the next one carries the position |
| `hello` | 1 per 10 s | dropped |
| `bye` | 1 per 10 s | dropped |
| `fs`, `fa` | 3 per s, burst 5 | dropped |
| `lk` | 1 per 30 s per account (`useLooks.refresh`) | one trailing refresh at the end of the window |
| `react` (`reactions:{roomId}`) | 5 per s, burst 5, keyed by `accountId`, else `username`, else one shared bucket; at most 12 per s in total | dropped |

Honest senders stay within these budgets, with room for network jitter:
- the send gate allows 3 game messages per second in total (`createSendGate`);
- a sender throttles reactions to one per 250 ms (`throttled`).

**3. `fp` refetch cap** (`useField.plotChanged`, R35):
- The 400 ms gather (`FP_GATHER_MS`) stays.
- Refetch starts are at least `FP_MIN_GAP_MS = 2000` apart. An `fp` inside the gap schedules one trailing refetch.
- A flood of `fp` then costs each client at most one `field_state` every 2 s.

**What these cannot stop:**
- **A spoofer using the id of a member who is present on the map passes every filter.** Member ids can be read from `members`. Such a spoofer can:
  - move that member, and hide them with `bye`;
  - fake their fishing phase, hand fish, catch labels and farm animations.
- **Any member's id, present or not, can send `hello` and `fp`:** each client then answers at most once per 10 s per id, and refetches the field at the capped rate.
- **Presence is spoofable too.** Anyone can track presence under any key, so an offline member can be made to look present.
- **Logged-out and banned users** keep full Realtime access.
- **Floods still count against the project's Realtime quota** (free plan: 100 messages/s, 2 M per month). The budgets only protect the clients' CPU and the database from amplification.
- **Not addressed:** the `lobby` channel (fake room activity), the names in reactions and presence, and the `[reply:…]` quote prefix. All are cosmetic.
- **No strikes from Realtime.** Nothing sent over Realtime can produce a strike, because the server never sees it.

## 15. Testing

### 15.1 SQL smoke (`tests/sql/anticheat-smoke.sql` and `tests/sql/anticheat-guards.sql`)

**The cluster:** a throwaway PostgreSQL 18 cluster:
- `initdb -U postgres --auth=trust`, then `pg_ctl start -o "-p 5499"`;
- `create schema extensions`, the stub roles `anon` and `authenticated`, and `create publication supabase_realtime`.

**Run twice:**
1. Replay `0004`…`0013` (with D1), then `0014` if it has been merged, then `0015`.
2. Run `v15-smoke.sql` and `anticheat-smoke.sql` (and `lyrics-lockdown-smoke.sql` once, when `0014` is applied). `v14-smoke.sql` runs right after `0012` only: since the fish price index (economy spec §5) a catch's price carries the room's factor, so its price check no longer holds after `0013`. The existing smokes' accounts (`smoke14_a_…`, 19 characters) pass the new name rules.
3. Replay `0015` again, and run `anticheat-smoke.sql` and `v15-smoke.sql` again.

Each phase sets the mode explicitly, so a second run passes too. The house style applies: `\set ON_ERROR_STOP on`, `pg_temp.err(sql)`, and `assert` in `do` blocks.

**`anticheat-smoke.sql` covers:**

1. **Private objects:**
   - the `_ac_*`, `_name_*`, `_clean_title`, `_title_key` and `_yt_thumb` helpers are not executable by anon;
   - the four tables are not selectable by anon;
   - the admin RPCs refuse a non-root token with `root role required`.
2. **H5:**
   - `register` refuses `A`, a 25-character name, `Ao cá`, `AO CA`, `Ao  cá`, `Hợp tác xã`, `hop-tac-xa`, `root`, `Lan` + U+200B, `Lan` + U+00A0 and `La` + U+0301 U+0301 + `n`;
   - it accepts `Đạt`, `lan_99` and `Minh Anh`;
   - `'  Minh   Anh '` is stored as `Minh Anh`;
   - `minh  anh`, and the NFD form of `Đạt`, are refused as taken;
   - `login` works with the NFD form and with extra spaces;
   - a banned account with a wrong password gets `invalid username or password`, and with the right one `account banned`.
3. **System lines:**
   - a rare catch and a land sale insert `system = true` with the right `about_account_id`;
   - `send_chat_message` inserts `false`;
   - the backfill marks well-formed old lines and leaves an author-less `Ao cá` line without the prefix unmarked.
4. **H4:**
   - a bad id is refused (single add) or skipped (batch);
   - the title is cleaned and capped at 200, and keeps its invisible characters: a title with "❤️" is stored with U+FE0F, a family emoji with its joiners, while a zero-width character still cannot split a banned keyword;
   - the thumbnail is derived;
   - durations 0, −5 and 90 000 become null;
   - existing queue and history thumbnails are rewritten.
5. **Daily cap:**
   - at `day_casts = 299` one more cast works and logs `cast_daily_cap` once;
   - the next cast raises `daily cast limit` with a numeric detail;
   - with `day_on` set to yesterday, casting works again;
   - `fishing_state` shows `casts_today_left` and `day_resets_at`.
6. **Log mode:**
   - every hard signal of §7.2 returns an envelope with `strike: 0` and the listed `error`;
   - each writes a `log_only` row and no lock;
   - state is unchanged (for example, `water` with delta 5 leaves `water_log` as it was).
7. **Enforce mode:**
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
   - `_ac_flag` called during the lock gives `in_lock`;
   - with `locked_until` moved into the past, the next hard signal gives strike 2: `is_banned`, sessions gone, `login` → `account banned`, `ban_state = 'pending_wipe'`;
   - with `last_strike_at` 31 days back and no lock, a hard signal gives strike 1 again.
8. **Root:** outcome `root`, `strike: 0`, no lock.
9. **Market freeze:** at the next `_field_open`, a banned account's offers are deleted and its listing and sublease price cleared, for a ban root set by hand too.
10. **Wipe** (through `admin_anticheat_resolve` with a root token):
    - the wallet, inventory, fish, bests, rice, profile and cast are gone;
    - there is a `wipe` ledger row with `−coins`;
    - the snapshot equals the `_ac_holdings` taken just before;
    - the system lines about the account are deleted, and its other messages stay.
11. **The next `_field_open` after the wipe:**
    - releases the owned plot with no `land_refund`;
    - deletes the cheater's village lease, crop, drying batch and offers;
    - keeps an innocent sublessee's lease on the cheater's plot until it ends;
    - `_song_bonus` does not pay the banned account, `fishing_board` hides it, and `_room_wealth` leaves it out.
12. **Pardon:**
    - while pending: unbanned, strikes 0, and login works;
    - after a wipe: login works with zero data; a plot bought after the pardon survives the next sweep, while a pre-wipe plot in an unswept room is still released;
    - `admin_set_ban(…, false)` on an anti-cheat ban behaves like a pardon;
    - pardoning a strike-1 account that root banned by hand clears the strike and keeps the ban;
    - `nothing to pardon` and `not pending` refusals.
13. **Mode:** switching from enforce to log clears running locks and keeps bans.
14. **No false positives:** in enforce mode, none of these writes a hard row or a lock:
    - a double `finish_cast`, and `finish_cast` after expiry;
    - a won reel at ratio 1.0 (with `bite_at` set back by `min_reel_ms`) is caught;
    - `buy_item('seed_short', 5)` (the old v14 client) writes a `soft` row only;
    - `dry_collect` of a slot the sweep already collected;
    - `transplant` repeated after it succeeded;
    - `water` +1 at level 3;
    - `price changed`, `offer expired`, and an offer id from another room;
    - a refused `add_queue_item`, and a refused `register`.
15. **Evidence cap and purge:**
    - 201 soft signals in one day leave 200 rows, and strike rows are still written;
    - a soft row 91 days old is purged by the next flag, and an old strike row stays;
    - a 1 MB `work` flags, and its evidence row stays under 2.2 kB; a long variety keeps 32 characters, and a detail over 2 000 characters keeps its head.
16. **The guard file:** it ends with `\i tests/sql/anticheat-guards.sql`.

**`anticheat-guards.sql`** is self-contained, so later smokes can include it:
- **Static check (R23):** every function with `pronamespace = 'public'::regnamespace`, `prosecdef` and `has_function_privilege('anon', oid, 'execute')` whose signature (`oid::regprocedure::text`) is not on the allowlist must match `prosrc ~ '_ac_(account|play)\('`. The allowlist holds one signature per function below, as the migrations define it, so a new overload of an allowed name is not allowed by its name:
  - `register`, `login`, `me`, `logout`;
  - `create_room`, `join_room`, `rename_room`, `kick_member`, `assign_dj`, `transfer_admin`, `set_play_mode`, `update_room_settings`, `touch_room`;
  - `add_queue_item`, `add_queue_items`, `advance_queue`, `set_playback`, `seek_playback`, `reorder_item`, `bump_to_top`, `delete_item`, `approve_queue_item`, `approve_all_pending`, `reject_queue_item`;
  - `send_chat_message`, `delete_chat_message`;
  - `submit_feedback`, `list_feedback`, `set_feedback_status`, `delete_feedback`;
  - `admin_list_rooms`, `admin_delete_room`, `admin_list_accounts`, `admin_set_ban`, `admin_delete_account`, `admin_stats`, `admin_anticheat_list`, `admin_anticheat_account`, `admin_anticheat_resolve`, `admin_anticheat_set_mode`;
  - `save_character`, and `upsert_video_lyrics` and `update_video_lyric_offset` in both their `0011` and their `0014` signatures;
  - `fishing_state`, `fishing_board`, `field_state`.
- **The check checks itself:** in a transaction that is rolled back, an unguarded overload `login(text, text, integer)` must be reported.
- **Dynamic loop:**
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads; each must succeed.

### 15.2 Unit and RTL tests (Vitest)

**Unit tests:**
- **`lib/anticheat.ts`:** `parseAnticheat` (valid, absent, malformed), `AnticheatError`, `lockSeconds`, `durationVi` (0.2 s, 59 s, 60 s, 125 s, 300 s), `chipText`, `chipLabel`, `reasonText` for every code, and the event hub.
- **The fishing and farm RPC wrappers:**
  - `call()` throws `AnticheatError` for `strike` 0, 1 and 2, and reports strikes of 1 and above;
  - `finishCast` returns the lost result with `anticheat`;
  - `fishingErrorMessage` and `farmErrorMessage` map `account locked` (details 125 → `…còn 2 phút 5 giây.`) and `daily cast limit`.
- **Fishing state:** `parseFishingState` (`castsTodayLeft`, `dayResetsAt`, `lock`); `castBlocker` returns `daily_limit`; `promptText` shows `Hết lượt câu hôm nay`.
- **Announcements:** the catch and land parsers return null when `system` is false; the existing fixtures gain `system: true`.
- **Chat:** `fetchRecentMessages` selects `system`.
- **Budgets:** `budget.ts` buckets per sender and kind; the `isHere` rule.
- **Refetch and refresh caps:** `useField` (fake timers: 10 `fp` in 1 s give one refetch at 400 ms and one trailing at 2 s); `useLooks` (the `lk` window).
- **Reactions:** the reaction budget.

**One test per hard signal**, pinning the client code that makes it impossible:

| Signal | The test |
|---|---|
| `reel_too_fast` | `stepReel` at 16 ms and 50 ms frames never catches before `minReelMs` for difficulties 12–90; `canHook` is false before `biteMs`. |
| `bad_qty` (fishing shop) | `ShopPanel` quantity choices ⊂ [1, 99]; gear always sends 1. |
| `bad_qty` (farm shop) | `FarmShopPanel` sends `n` ∈ [1, 99]. |
| `bad_qty` (depot, drying) | `RiceDepotPanel` and `DryingPanel` send kg ≥ 1 and a boolean `dry`. |
| `bad_price` | `CoopPanel`: typing `""`, `"0"`, `"1.5"`, `"-3"` or `"1000001"` keeps "Gửi đề nghị", "Rao bán" and "Cho thuê" disabled. |
| `bad_water`, `bad_work` | `plotActions` emits only `delta` ±1 and `work` `transplant`/`harvest`. |
| `bad_plot` | Plot numbers come from the state, 1–10. |
| `bad_slot` | `DryingPanel` slots are 1–4. |
| `foreign_offer` | "Rút" uses `myOffers` ids; "Đồng ý" and "Từ chối" use `incomingOffers` ids. |
| `quality_range` | `useFarmController` sends quality 1. |

**RTL:**
- `AnticheatModal`: the warning text and its button; the ban button and closing both call `logout`.
- `AnticheatChip`: the countdown, with fake timers.
- `AnticheatTab`: statuses; the wipe confirm calls the RPC; pardon; the mode switch with its confirm; the evidence toggle.
- `AuthScreen`: the two texts.

### 15.3 Integration (skipped without `SUPABASE_TEST_URL`)

- `register('Ao cá', …)` is refused.
- A banned test account gets `account banned` at login.
- `fishing_state` carries `casts_today_left`.
- With the test project in log mode, `water` with delta 5 returns an envelope with `strike: 0`.
- anon cannot select `anticheat_events`.

### 15.4 The owner's manual pass (two accounts; enforce steps on a test project or at a quiet hour)

1. **After `0015` (log mode):**
   1. Run the §11.4 queries.
   2. Play normally with both accounts: fishing, farming, the land market, drying.
   3. Also try the honest edge cases: double clicks, two tabs, DevTools "Slow 3G", a backgrounded tab mid-cast, a reload mid-reel, a portal mid-cast.
   4. Check that the tab shows **no** hard rows.
2. **From the console on a test account:** send `finish_cast` with success right after `start_cast`, `water` with delta 5, and `buy_item` with bait quantity 500.
   - Each returns `strike: 0`.
   - The tab shows `log_only` rows with `client = music-together/<build>` and a user agent. This verifies the headers.
3. **Switch to enforce and repeat one tampered call:**
   - the warning modal and the chip appear;
   - fishing and farm actions show the lock toast;
   - chat and the queue still work;
   - a reload keeps the chip.
   Five minutes later, a second tampered call brings the ban modal, the logout, and a refused login.
4. **In /admin:**
   1. Check the evidence and the holdings preview.
   2. Confirm the wipe. The data is gone; the land is released at the next field visit, while B's sublease stays; the catch lines vanish from chat.
   3. Pardon. Login works, with zero data.
5. **Return to log mode** until the 7 days are over, then do the review (§9.8).

## 16. Out of scope

- **Server-signed queue metadata** (D8, the v10 "option B"). It would also make the song bonus and the room rules tamper-proof.
- **A server-driven reel**, which would make the fishing minigame verifiable.
- **A Realtime relay** or private channels with RLS on `realtime.messages` and a custom JWT, which would police Broadcast.
- **Restoring wiped data** from `anticheat_wipes.snapshot`.
- **Account security:** device or IP binding, a login brute-force back-off, and session expiry.
- **The audit's side findings:**
  - the plot locks `field_state` takes on every read;
  - length caps for room names and feedback;
  - unlimited queue rows for admin and DJ;
  - chat, queue and member reads of password-protected rooms;
  - public `members.last_seen_at`.
- **Colluding accounts** moving xu through land sales at any price (by design).
- **Cosmetic Realtime spoofing:** lobby spoofing, reaction and presence names, and the `[reply:…]` prefix (§14).
- **The v15.3 soft signal** "quality always 1.1", which comes with `0018`.
- **A soft counter for rice parts claimed under 9 s** after their `begin_work` (v15.2 §11.5).
- **The lyrics hole (H1) and its broadcast budget**, which `0014` covers.
