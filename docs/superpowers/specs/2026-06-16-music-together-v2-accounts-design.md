# Music Together v2 — Tài khoản, Sảnh phòng & Đĩa than động (Thiết kế)

- **Ngày:** 2026-06-16
- **Trạng thái:** Đã chốt qua brainstorming, chờ review trước khi lập kế hoạch triển khai
- **Tiền đề:** Tiếp nối bản v1 (đã hoàn tất trên nhánh `feat/implementation`). Xem [v1 spec](2026-06-16-music-together-design.md). v2 thay lớp **danh tính theo thiết bị (device token)** bằng **tài khoản người dùng**, thêm **sảnh phòng**, và nâng cấp UI.

---

## 1. Mục tiêu v2

1. **Tài khoản người dùng** (username + mật khẩu) để định danh chuẩn xác và **đăng nhập lại từ bất kỳ thiết bị nào**. Vai trò Admin/DJ gắn theo **tài khoản** → chủ phòng đổi máy, đăng nhập đúng acc là **tự khôi phục quyền** (không cần token thiết bị).
2. **Sảnh phòng (lobby):** mọi người thấy **các phòng đang mở** (có người online) + số người + đang phát gì, để chủ động vào (nhập mật khẩu) **mà không cần mã phòng**.
3. **UI:** đĩa than có **cần đĩa hạ kim khi phát / dựng đứng khi dừng**; mã phòng có **icon sao chép**; thêm **icon chia sẻ** phòng.

### Ngoài phạm vi v2
- Đăng nhập Google (để sau — thêm qua lớp riêng nếu cần; xem §11).
- Phòng riêng tư/ẩn khỏi sảnh (mọi phòng đang mở đều hiện; xem §11).
- Đặt lại mật khẩu qua email (không có email).
- Logic chat/reactions/likes (vẫn là placeholder như v1).

---

## 2. Quyết định cốt lõi (chốt khi brainstorming)

| Chủ đề | Quyết định |
|---|---|
| Cơ chế đăng nhập | **Username + mật khẩu**, tài khoản **tùy chỉnh** mở rộng pattern hiện có (bảng `accounts` + bcrypt + **token phiên**), KHÔNG dùng Supabase Auth. Google để sau. |
| Định danh hiển thị | Dùng chính **username** làm tên hiển thị (YAGNI — không tách display_name riêng). |
| Khôi phục vai trò | **Tự động theo tài khoản**: đăng nhập đúng acc + vào phòng đã là thành viên ⇒ tự là Admin/DJ như trước, không có nút "vào với quyền admin" riêng. |
| Mật khẩu phòng | Vẫn còn, **chỉ hỏi khi vào lần đầu** (chưa là thành viên). Đã là thành viên (theo account) ⇒ vào thẳng. |
| Sảnh phòng | Chỉ hiện **phòng đang hoạt động** (≥1 người online), suy từ **Realtime Presence toàn cục**, không ghi DB. |
| Migration | **Teardown + rebuild**: 1 script drop bảng/hàm v1 rồi dựng schema v2 (chấp nhận mất dữ liệu phòng cũ vì đang dev). |
| Đĩa than | OFF: cần đĩa **dựng đứng 90°**, đậu ngoài mép. PHÁT: swing vào **hạ kim giữa vành đen** + đĩa xoay. Đồng bộ theo `is_playing`. |
| Sao chép / chia sẻ | 📋 sao chép **mã**; 🔗 chia sẻ **link đầy đủ** (Web Share API trên mobile, fallback clipboard). |

---

## 3. Kiến trúc danh tính & dữ liệu

### Bảng mới
- **`accounts`** — `id uuid pk, username text not null, created_at timestamptz`. Username **unique không phân biệt hoa/thường** (unique index trên `lower(username)`). Username là tên hiển thị luôn.
- **`account_secrets`** — `account_id uuid pk fk, password_hash text`. Băm **bcrypt** (`crypt()/gen_salt('bf')`). **Giấu** như `room_secrets` (RLS bật, **không** policy đọc, **không** trong realtime publication).
- **`sessions`** — `token_hash text pk, account_id uuid fk, created_at, last_seen`. Mỗi lần đăng nhập tạo 1 phiên (đa thiết bị). `token_hash = encode(digest(raw_token,'sha256'),'hex')`. Token gốc (`gen_random_bytes(32)` hex) trả 1 lần, client lưu `localStorage` key **`music-together:auth`**. RLS bật, không policy đọc, không realtime.

### Bảng đổi
- **`members`** → `id uuid pk, room_id uuid fk, account_id uuid fk, joined_at`. **UNIQUE(room_id, account_id)** (1 người = 1 member/phòng). **Bỏ** `name` + bảng `member_secrets`. Tên hiển thị lấy qua join `accounts.username`.
- **`queue_items`** → `added_by_member_id` đổi thành **`added_by_account_id` (fk accounts on delete set null)** + giữ `added_by_name` (snapshot username để vẫn hiện khi account rời phòng). Các cột khác như v1.
- **`rooms`**, **`room_secrets`**, **`play_history`**: như v1 (rooms vẫn dùng con trỏ `admin_member_id`/`dj_member_id` → member → account).

### Xác thực RPC (đổi từ device-token sang session)
Helper riêng **`_auth(p_room_id uuid, p_session_token text, p_required_role text)`**:
1. `account_id` = từ `sessions` theo `token_hash`; không có ⇒ raise `invalid session`.
2. member = `members` theo `(room_id, account_id)`; không có ⇒ raise `not a member` (với RPC trong phòng).
3. Kiểm vai trò: so `member.id` với `rooms.admin_member_id`/`dj_member_id` theo `p_required_role` (`any|admin|dj|admin_or_dj`).
4. Trả `member_id` (và `account_id`). `SECURITY DEFINER`, `search_path=public,extensions`, revoke khỏi anon/authenticated.

Helper account-only **`_auth_account(p_session_token)`** → `account_id` (cho RPC không thuộc phòng cụ thể, vd create_room).

---

## 4. RPC (Postgres, SECURITY DEFINER)

### Tài khoản
- `register(p_username, p_password)` → username trống? trùng? (raise); tạo `accounts` + `account_secrets` (bcrypt) + 1 `session`; trả `(account_id, username, token)`.
- `login(p_username, p_password)` → tìm account theo `lower(username)`; verify `crypt(p_password, hash)=hash`; tạo session; trả `(account_id, username, token)`; sai ⇒ raise `invalid credentials`.
- `me(p_token)` → giải session → `(account_id, username)`; cập nhật `last_seen`; không hợp lệ ⇒ trả rỗng/raise.
- `logout(p_token)` → xóa session theo `token_hash`.

### Phòng (đổi chữ ký: bỏ `p_member_id`+device token, dùng `p_session_token`)
- `create_room(p_room_name, p_password, p_session_token)` → `_auth_account`; tạo `rooms`+`room_secrets`+member(account); gán admin+dj; trả `(code, room_id, member_id)`.
- `join_room(p_code, p_password, p_session_token)` → `_auth_account`; tìm room; **nếu đã là member ⇒ trả luôn** (bỏ qua mật khẩu); chưa ⇒ verify mật khẩu (`crypt`) → tạo member; trả `(room_id, member_id)`. Sai mật khẩu ⇒ raise.
- `add_queue_item(p_room_id, p_session_token, p_video_id, p_title, p_thumb, p_duration)` → `_auth(...,'any')`; chèn (added_by_account_id + username).
- `advance_queue(p_room_id, p_session_token)` → `'dj'`; như v1 (archive→delete→chọn theo play_mode→reset playback).
- `set_playback(p_room_id, p_session_token, p_is_playing, p_started_at, p_paused_elapsed_ms)` → `'dj'`.
- `seek_playback(p_room_id, p_session_token, p_position_ms)` → `'dj'`.
- `reorder_item/bump_to_top/delete_item(p_room_id, p_session_token, p_item_id[, p_new_position])` → `'admin_or_dj'`; `delete_item` vẫn từ chối bài đang phát.
- `set_play_mode(p_room_id, p_session_token, p_play_mode)` → `'admin'`.
- `assign_dj/transfer_admin/kick_member(p_room_id, p_session_token, p_target_member)` → `'admin'`; `kick` không tự kick; clear con trỏ vai trò.
- `rename_room(p_room_id, p_session_token, p_new_name)` → `'admin'`.

Grant execute mọi RPC public ở trên cho `anon, authenticated`; `_auth`/`_auth_account` KHÔNG grant.

---

## 5. Luồng

1. **Đăng ký/Đăng nhập:** app load → đọc token `localStorage` → `me(token)`; hợp lệ ⇒ vào sảnh; không ⇒ màn **Auth** (tabs Đăng nhập / Đăng ký, username + mật khẩu). Lưu token sau khi thành công. **Đăng xuất** = `logout` + xóa token.
2. **Tạo phòng:** (đã đăng nhập) form tên phòng + mật khẩu → `create_room` → điều hướng `/room/<code>`.
3. **Vào phòng:** từ sảnh hoặc mã → `/room/<code>` → nếu đã là member ⇒ vào thẳng; chưa ⇒ JoinGate hỏi **mật khẩu phòng** → `join_room`.
4. **Đổi máy:** đăng nhập acc → mở phòng đã từng vào ⇒ vào thẳng, **giữ quyền** (vai trò theo account).
5. **Trong phòng:** như v1 (hàng đợi, DJ điều khiển, đồng bộ realtime) nhưng định danh theo account.

---

## 6. Sảnh phòng (lobby)

- **Phát hiện phòng đang mở:** một kênh **Realtime Presence toàn cục** tên `lobby`. MỌI client đã đăng nhập đều `track({ account_id, username, room_id })` — `room_id` = phòng đang ở, hoặc `null` nếu đang ở sảnh. Trang sảnh đọc `presenceState()` → gom theo `room_id` (loại `null`) → **đếm account riêng biệt mỗi phòng** ⇒ danh sách phòng đang mở + số online. Realtime, **không ghi DB**.
- **Chi tiết thẻ phòng:** từ bảng `rooms` (SELECT theo các `room_id` đang mở): tên, mã, `is_playing`, `current_item_id` → tên bài (join `queue_items`). DJ hiện tại (join member→account username). Hiện 🔒 (mọi phòng đều có mật khẩu).
- **UI sảnh** (trang chủ khi đã đăng nhập): nút **Tạo phòng**, ô **Vào bằng mã**, danh sách thẻ phòng (tên · 🔒 · 🎵 đang phát · 👥 online · DJ · nút **Vào ▸**). Bấm Vào → `/room/<code>`.
- **Cập nhật:** thẻ phòng cập nhật khi presence thay đổi (join/leave/sync) và khi `rooms`/`queue_items` đổi (subscribe nhẹ theo các room đang mở, hoặc refetch chi tiết định kỳ/khi presence đổi).
- **Khi vào phòng:** client cập nhật `track({room_id})` trên kênh lobby; khi rời/đăng xuất set `null`. Mỗi client giữ 1 kết nối kênh `lobby` xuyên suốt (rẻ).

---

## 7. UI nâng cấp

### 7.1 Đĩa than động (`components/room/Turntable.tsx`)
- Thêm **cần đĩa (tonearm)**: pivot ở góc trên-phải đĩa; `transform-origin` tại pivot; `transition: transform .9s`.
- **OFF (không phát):** `rotate(0deg)` — cần đĩa **thẳng đứng (vuông góc mặt phẳng)**, kim đậu ngoài mép phải (có "giá đỡ" puck mờ).
- **PLAYING:** `rotate(~36deg)` — kim hạ vào **giữa vành đen**. Đĩa xoay (`animation-play-state: running`); OFF thì `paused`.
- Trạng thái lấy từ prop `spinning = room.is_playing && !!current` (đồng bộ mọi người; chỉ DJ điều khiển). *(Góc 0°/36° tinh chỉnh theo hình học đĩa thực tế khi code.)*

### 7.2 Sao chép & chia sẻ (`components/room/Header.tsx` + `ShareButtons`)
- **📋 sao chép mã:** `navigator.clipboard.writeText(room.code)` + toast "✓ Đã sao chép mã".
- **🔗 Chia sẻ:** nếu có `navigator.share` (mobile) ⇒ `navigator.share({title, url})` với `url = ${origin}/room/${code}`; nếu không ⇒ `clipboard.writeText(url)` + toast.
- Có fallback khi `navigator.clipboard` không khả dụng (vd HTTP) → bỏ qua êm hoặc chọn text.

### 7.3 Màn Auth + sảnh
- `components/auth/AuthScreen.tsx`: tabs Đăng nhập / Đăng ký (username + mật khẩu), lỗi tiếng Việt (username trùng / sai đăng nhập).
- Nút **Đăng xuất** ở thanh trên (sảnh và trong phòng).
- Phong cách Vintage Library như v1.

---

## 8. Migration (teardown + rebuild)

- Vì v1 đã chạy trên Supabase và **chấp nhận drop**: cung cấp **1 script reset** (cũng là bộ migration v2 đã sửa lại):
  1. `drop` (if exists, cascade) toàn bộ RPC v1 + bảng v1 (`play_history, queue_items, member_secrets, members, room_secrets, rooms`).
  2. `create extension if not exists pgcrypto`.
  3. Tạo schema v2: `accounts, account_secrets, sessions, rooms, room_secrets, members, queue_items, play_history` + index + RLS + SELECT policies (rooms/members/queue_items/play_history công khai; `account_secrets/room_secrets/sessions` không policy đọc).
  4. Tạo `_auth`, `_auth_account` + toàn bộ RPC v2 + grants.
  5. `alter publication supabase_realtime add table public.rooms, public.members, public.queue_items;` (KHÔNG thêm secrets/sessions).
- **Cách dùng:** dán script vào **Supabase SQL Editor** (chạy 1 lần — drop cũ, dựng mới). Với local/CLI: `supabase db reset` áp lại từ đầu. An toàn trên cả DB hiện có lẫn DB trống nhờ `drop ... if exists`.
- File: thay bộ `supabase/migrations/000{1,2,3}` bằng bộ v2 (vd `0001_init.sql` account-native + `0002_rpc.sql` + `0003_realtime.sql`), mỗi file mở đầu bằng `drop ... if exists` cần thiết để re-run sạch.

---

## 9. Bảo mật

- Mật khẩu tài khoản & mật khẩu phòng: **bcrypt** trong bảng `*_secrets` riêng, không policy đọc.
- **Session token:** ngẫu nhiên 32 byte, DB chỉ lưu **sha256**; client giữ token gốc; mọi RPC ghi xác thực qua `_auth`/`_auth_account`. Đăng xuất xóa session.
- **RLS:** bật mọi bảng; SELECT công khai cho `rooms/members/queue_items/play_history/accounts` (cần cho Realtime + hiện tên). `accounts` chỉ chứa `id/username/created_at` — **mọi bí mật nằm ở `account_secrets`** (bảng riêng, không policy đọc) nên SELECT công khai an toàn. `sessions` cũng không policy đọc. Không policy ghi ⇒ ghi chỉ qua RPC.
- **Lưu ý:** `members`/`accounts` đọc công khai (username, ai trong phòng nào) — chấp nhận như v1 (`using(true)`), không lộ bí mật. Sảnh công khai theo presence là chủ đích.
- Mất token = đăng nhập lại (không có khôi phục token).

---

## 10. Kiểm thử

- **Unit (pure, TDD):** chuẩn hóa username (`lower/trim`), helper localStorage session, (giữ `computeElapsedMs`, `parseYouTubeId`, `positionBetween`, `deriveRole` từ v1).
- **Integration (RPC, local/hosted Supabase):** `register` (trùng username), `login` (sai mật khẩu), `me`/`logout`, `create_room` qua session, `join_room` (lần đầu cần mật khẩu / lần sau bỏ qua), phân quyền qua session (guest không advance/skip/admin), **vai trò theo account qua 2 session khác nhau cùng acc** (mô phỏng 2 thiết bị).
- **Manual:** sảnh hiện đúng phòng đang mở + số online (2–3 tab); đăng nhập acc trên trình duyệt khác ⇒ vào phòng cũ vẫn là Admin; animation cần đĩa; sao chép mã + chia sẻ link.

---

## 11. Cấu trúc dự án (thay đổi v2)

```
app/
  page.tsx                      # ĐỔI: cổng Auth → Sảnh (đăng nhập? sảnh : AuthScreen)
  room/[code]/page.tsx          # giữ (server await params)
  room/[code]/RoomClient.tsx    # ĐỔI: dùng account/session thay token thiết bị
lib/
  auth.ts                       # MỚI: wrappers register/login/me/logout + types Session/Account
  supabase.ts                   # ĐỔI: RPC wrappers nhận session_token; bỏ Identity device-token
  session.ts                    # MỚI: lưu/đọc token phiên ở localStorage (key music-together:auth)
  lobby.ts                      # MỚI: presence toàn cục + gom phòng đang mở
  realtime.ts                   # giữ (subscribeRoom/trackPresence)
hooks/
  useAuth.ts                    # MỚI: context phiên (session, account, login/register/logout, restore qua me())
  useRoom.ts                    # ĐỔI: membership theo account; track room_id lên kênh lobby
  useDjController.ts            # ĐỔI nhẹ: RPC theo session_token
  useYouTubePlayer.ts           # giữ
components/
  auth/AuthScreen.tsx           # MỚI
  lobby/Lobby.tsx, RoomCard.tsx # MỚI
  room/Turntable.tsx            # ĐỔI: cần đĩa động
  room/Header.tsx, ShareButtons.tsx # ĐỔI/MỚI: icon sao chép + chia sẻ
  room/JoinGate.tsx             # ĐỔI: chỉ hỏi mật khẩu phòng (account đã có)
  room/SettingsDialog.tsx, MemberList.tsx, Queue.tsx # ĐỔI: hiển thị theo username, RPC session
supabase/migrations/
  0001_init.sql, 0002_rpc.sql, 0003_realtime.sql   # VIẾT LẠI account-native (teardown+rebuild)
```

---

## 12. Kế hoạch theo giai đoạn (cho plan)
- **Phase A — Backend tài khoản:** migration v2 (teardown+rebuild) + RPC account/session + rework RPC phòng sang session + integration tests.
- **Phase B — Client auth:** `lib/auth`, `lib/session`, `useAuth`, `AuthScreen`, cổng trang chủ; rework `lib/supabase` wrappers + `useRoom`/`JoinGate`/`useDjController`/`RoomClient` sang session.
- **Phase C — Sảnh phòng:** `lib/lobby` (presence toàn cục), `Lobby` + `RoomCard`, tích hợp vào trang chủ; `useRoom` track `room_id` lên kênh lobby.
- **Phase D — UI polish:** cần đĩa động (`Turntable`), icon sao chép + chia sẻ (`Header`/`ShareButtons`).

---

## 13. Câu hỏi mở / tương lai
- Đăng nhập Google (thêm bảng map `account ↔ google_sub`, hoặc chuyển sang Supabase Auth khi cần).
- Phòng riêng tư/ẩn khỏi sảnh (cờ `rooms.is_listed`).
- Đặt lại mật khẩu (cần email — ngoài phạm vi username-only).
- Dọn session/phòng cũ (TTL) nếu dữ liệu phình.
