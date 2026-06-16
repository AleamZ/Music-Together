# Music Together v3 — Hòm thư góp ý, role Root & siết bảo mật (Thiết kế)

- **Ngày:** 2026-06-16
- **Trạng thái:** Đã chốt qua brainstorming, chờ review trước khi lập kế hoạch triển khai
- **Tiền đề:** Tiếp nối v2 (tài khoản + sảnh, đã deploy public). Xem [v2 spec](2026-06-16-music-together-v2-accounts-design.md). Server **đã public** nên v3 chú trọng an toàn.

---

## 1. Mục tiêu v3
1. **Hòm thư góp ý:** mọi user đã đăng nhập gửi feedback (loại + nội dung); **root** đọc & xử lý.
2. **Role `root`:** quản trị toàn hệ thống — feedback, phòng, tài khoản, thống kê.
3. **Siết bảo mật / chống lạm dụng:** khóa (ban) tài khoản, rate-limit chống spam. (KHÔNG đổi kiến trúc đọc — xem §2.)

### Ngoài phạm vi
- Đổi mô hình đọc công khai (`using(true)`) → giữ nguyên (cần cho Realtime; bí mật vẫn được cô lập). Quyết định ở §2.
- Rate-limit `register` ở tầng DB (không có IP) — để tầng Vercel/Cloudflare sau (§11).
- Root tự phong root khác qua UI (bootstrap root qua SQL riêng).

---

## 2. Quyết định cốt lõi (chốt khi brainstorming)
| Chủ đề | Quyết định |
|---|---|
| Mức bảo mật DB | **Chống ghi/sửa trái phép + chống lạm dụng**, KHÔNG đổi kiến trúc đọc. (Ghi đã khóa qua RPC+vai trò; bí mật cô lập ở `*_secrets`/`sessions`.) |
| Tạo root | **Cột `is_root` trên `accounts`**; tài khoản root tạo bằng **SQL chạy riêng** trong Supabase SQL Editor (KHÔNG commit), mật khẩu mạnh. Có thể nhiều root. |
| Quyền root | Quản lý feedback; xem/xóa mọi phòng; xem/khóa/xóa tài khoản; xem thống kê. |
| Feedback | Form: **loại** (bug/suggestion/other) + **nội dung**; người gửi là user đã đăng nhập (gắn username + thời gian). |
| Migration | **Additive `0005_v3_admin.sql`** — chỉ ALTER/CREATE, **không drop** dữ liệu (server đã có dữ liệu thật). |
| Rate-limit | `submit_feedback` ≤ **10/tài khoản/giờ**; `create_room` ≤ **10/tài khoản/giờ**. |

---

## 3. Migration (additive — KHÔNG wipe)
`supabase/migrations/0005_v3_admin.sql` chỉ thêm, dán vào SQL Editor (hoặc `supabase db reset` chạy 0001→0005):
1. `alter table public.accounts add column if not exists is_root boolean not null default false;`
2. `alter table public.accounts add column if not exists is_banned boolean not null default false;`
3. `alter table public.rooms add column if not exists created_by_account_id uuid references public.accounts(id) on delete set null;`
4. `create table if not exists public.feedback (...)` (xem §4) + RLS + index.
5. `create or replace` các RPC mới + sửa `_auth_account`/`create_room`/`me` (xem §5) + grants.
6. KHÔNG thêm `feedback` vào realtime publication.

**Tạo tài khoản root (CHẠY RIÊNG sau khi áp 0005 — KHÔNG commit, mật khẩu mạnh, không dùng `aleam007`):**
```sql
do $$ declare v_id uuid := gen_random_uuid();
begin
  insert into public.accounts (id, username, is_root) values (v_id, 'root', true)
    on conflict do nothing;
  insert into public.account_secrets (account_id, password_hash)
    values (v_id, crypt('<STRONG_PASSWORD>', gen_salt('bf')))
    on conflict (account_id) do update set password_hash = excluded.password_hash;
end $$;
```
*(Nếu tài khoản `root` đã tồn tại do `on conflict do nothing`, set quyền bằng `update public.accounts set is_root=true where lower(username)='root';`.)*

---

## 4. Mô hình dữ liệu
- `accounts`: + `is_root boolean default false`, + `is_banned boolean default false`.
- `rooms`: + `created_by_account_id uuid references accounts(id) on delete set null`.
- **`feedback`** (mới):
  | cột | kiểu | ghi chú |
  |---|---|---|
  | `id` | uuid pk | |
  | `account_id` | uuid fk accounts **on delete set null** | ai gửi (giữ lịch sử khi acc bị xóa) |
  | `username` | text | snapshot tên người gửi |
  | `category` | text check in ('bug','suggestion','other') | loại |
  | `message` | text not null | nội dung |
  | `status` | text default 'new' check in ('new','handled') | trạng thái xử lý |
  | `created_at` | timestamptz default now() | |
  - Index: `idx_feedback_status_created on feedback(status, created_at desc)`.
- **RLS:** bật trên `feedback`, **không policy nào** → client không đọc/ghi trực tiếp; chỉ RPC (SECURITY DEFINER) chạm tới. (Không thêm vào realtime publication.)
- `accounts` vẫn SELECT công khai (gồm `is_root`, `is_banned` — không phải bí mật; quyền vẫn kiểm server-side).

---

## 5. RPC (SECURITY DEFINER, `set search_path = public, extensions`)

**Sửa `_auth_account(p_session_token)`** (CREATE OR REPLACE): sau khi giải `account_id` từ session, **kiểm `is_banned`** → nếu true raise `'account banned'` (errcode 42501). ⇒ tài khoản bị ban bị khóa ở MỌI RPC ghi + `me()` fail.

**Helper mới `_auth_root(p_session_token)`** → gọi `_auth_account`, kiểm `accounts.is_root` → trả `account_id` hoặc raise `'root role required'`. `revoke all ... from public, anon, authenticated`.

**Feedback:**
- `submit_feedback(p_session_token, p_category, p_message)` returns uuid — `_auth_account`; validate category ∈ (bug,suggestion,other) & message không rỗng; **rate-limit**: `select count(*) from feedback f join ... ` theo `account_id` trong `now()-interval '1 hour'`, nếu ≥ 10 raise `'too many feedback, try later'`; insert (account_id, username snapshot, category, message). Grant anon/authenticated.
- `list_feedback(p_session_token)` returns setof — `_auth_root`; trả toàn bộ feedback order by created_at desc.
- `set_feedback_status(p_session_token, p_id, p_status)` returns void — `_auth_root`; validate status ∈ (new,handled); update.
- `delete_feedback(p_session_token, p_id)` returns void — `_auth_root`; delete.

**Quản trị (root only):**
- `admin_list_rooms(p_session_token)` — `_auth_root`; trả mỗi phòng: id, code, name, is_playing, created_at, creator username (join `created_by_account_id`→accounts), member_count (subquery count members).
- `admin_delete_room(p_session_token, p_room_id)` — `_auth_root`; `delete from rooms where id=p_room_id` (cascade members/queue_items/room_secrets/play_history).
- `admin_list_accounts(p_session_token)` — `_auth_root`; trả id, username, is_root, is_banned, created_at.
- `admin_set_ban(p_session_token, p_account_id, p_banned)` — `_auth_root`; **không cho tự ban** (`p_account_id = caller` → raise); set `is_banned`; nếu ban thì `delete from sessions where account_id=p_account_id` (đá ra ngay).
- `admin_delete_account(p_session_token, p_account_id)` — `_auth_root`; **không cho tự xóa**; `delete from accounts where id=p_account_id` (cascade: account_secrets, sessions, members; `queue_items.added_by_account_id`/`feedback.account_id`/`rooms.created_by_account_id`/`rooms.*_member_id` đều `on delete set null`/cascade hợp lý).
- `admin_stats(p_session_token)` — `_auth_root`; trả counts: total_rooms, total_accounts, feedback_new, feedback_total. (Số online là Realtime/presence — hiển thị phía client nếu cần, không tính ở DB.)

**Sửa `create_room`** (CREATE OR REPLACE): set `created_by_account_id = v_account`; **rate-limit**: count rooms `where created_by_account_id=v_account and created_at > now()-interval '1 hour'`, ≥ 10 → raise `'too many rooms, try later'`. (Phần còn lại như v2.)

**Sửa `me(p_token)`** (CREATE OR REPLACE): trả thêm `out is_root boolean` (lấy từ accounts). (Vẫn qua `_auth_account` → tài khoản ban sẽ fail `me()` → client tự đăng xuất.)

**Grants:** cấp execute cho `anon, authenticated`: `submit_feedback, list_feedback, set_feedback_status, delete_feedback, admin_list_rooms, admin_delete_room, admin_list_accounts, admin_set_ban, admin_delete_account, admin_stats` (+ `create_room`, `me` đã có). `_auth_root` KHÔNG grant.

---

## 6. Bảo mật
- **Ban = khóa tận gốc:** `_auth_account` từ chối tài khoản `is_banned` ⇒ mọi RPC ghi + `me()` fail; ban kèm xóa session.
- **Root kiểm server-side:** mọi RPC quản trị qua `_auth_root` (đọc `is_root` từ DB theo session). Ẩn/hiện link UI chỉ là tiện ích, không phải ranh giới bảo mật.
- **Rate-limit trong RPC** (server-side) cho feedback + create_room.
- **Tự bảo vệ:** root không tự ban/tự xóa.
- **Bí mật không lên repo:** mật khẩu root tạo bằng SQL riêng (không commit). `feedback` không đọc công khai, không realtime.
- **Tài khoản bị xóa:** FK `on delete set null`/cascade đảm bảo không vỡ ràng buộc; lịch sử (feedback/queue) giữ `username`/`added_by_name` đã snapshot.

---

## 7. Giao diện
- **Nút "💬 Góp ý"** (mọi user đã đăng nhập): ở thanh trên **Sảnh** và **header phòng** → mở `FeedbackModal` (dropdown loại + textarea nội dung + Gửi) → `submit_feedback` → toast thành công / lỗi (rate-limit). Component: `components/feedback/FeedbackButton.tsx` + `FeedbackModal.tsx`.
- **Trang `/admin`** (`app/admin/page.tsx`, client): chưa đăng nhập → `AuthScreen`; đã đăng nhập mà không root → "Bạn không có quyền truy cập" + link về `/`; root → dashboard 4 tab:
  - **Hòm thư** (`FeedbackTab`): list feedback + đánh dấu đã xử lý / xóa.
  - **Phòng** (`RoomsTab`): list phòng (tên, mã, người tạo, #thành viên, ngày) + xóa.
  - **Tài khoản** (`AccountsTab`): list account (username, 👑root, 🚫banned, ngày) + khóa/mở + xóa (ẩn nút trên chính mình).
  - **Thống kê** (`StatsTab`): tổng phòng / tài khoản / feedback chưa xử lý / tổng.
  - Phong cách Vintage Library.
- **`useAuth` & điều hướng:** `Account` thêm `isRoot`; `me/login/register` (lib/auth + supabase wrappers) trả `is_root`. Sảnh hiện link **"⚙️ Quản trị"** nếu `isRoot`.

**File:** MỚI `lib/feedback.ts`, `lib/admin.ts`, `components/feedback/{FeedbackButton,FeedbackModal}.tsx`, `app/admin/page.tsx`, `components/admin/{FeedbackTab,RoomsTab,AccountsTab,StatsTab}.tsx`. SỬA `hooks/useAuth.tsx` (+isRoot), `lib/auth.ts` (me/login/register +is_root), `lib/supabase.ts` (createRoom giữ chữ ký), `components/lobby/Lobby.tsx` (link Quản trị + nút Góp ý), `components/room/Header.tsx` (nút Góp ý). MỚI `supabase/migrations/0005_v3_admin.sql`.

---

## 8. Kiểm thử
- **Unit (pure, TDD):** không nhiều logic thuần mới (rate-limit nằm trong SQL). Giữ các test v1/v2.
- **Integration (RPC, local/hosted Supabase):** `submit_feedback` (validate category, rate-limit ≥10 → lỗi), `list_feedback`/`set_feedback_status`/`delete_feedback` chỉ root (guest/non-root bị từ chối), `_auth_account` từ chối tài khoản banned, `admin_set_ban` (không tự ban; ban xóa session), `admin_delete_account` (không tự xóa), `admin_list_rooms/accounts/stats` chỉ root, `create_room` rate-limit, `me` trả `is_root`.
- **Manual:** gửi feedback từ user thường → root thấy trong `/admin`; root xóa phòng/khóa tài khoản; non-root vào `/admin` bị chặn; tài khoản bị ban bị đá ra.

---

## 9. Cấu trúc dự án (thay đổi v3) — xem §7 (danh sách file).

## 10. Kế hoạch theo giai đoạn (cho plan)
- **Phase A — Backend:** `0005_v3_admin.sql` (cột + feedback table + RLS + RPC + rate-limit + grants) + integration tests.
- **Phase B — Client wiring:** `lib/feedback.ts`, `lib/admin.ts`; `me/login/register` + `useAuth` trả `isRoot`.
- **Phase C — UI:** `FeedbackButton/Modal` (Sảnh + Header); trang `/admin` + 4 tab + link Quản trị.

## 11. Câu hỏi mở / tương lai
- Rate-limit `register` ở tầng Vercel/Cloudflare (chống spam đăng ký).
- Root tự phong/thu root khác qua UI (hiện chỉ qua SQL).
- Cân nhắc siết đọc-công-khai (cần chuyển Supabase Auth) nếu sau này cần riêng tư hơn.
- Dọn feedback cũ / phân trang khi danh sách lớn.
