# Music Together — Phòng nghe nhạc chung (Thiết kế)

- **Ngày:** 2026-06-16
- **Trạng thái:** Đã chốt qua brainstorming, chờ review trước khi lập kế hoạch triển khai
- **Chủ đề:** Web cho nhiều người cùng nhau đóng góp & nghe nhạc YouTube trong một "phòng", phong cách quý tộc Anh / đĩa than.

---

## 1. Mục tiêu & phạm vi

### Mục tiêu
- Nhiều người vào chung một **phòng**, cùng đóng góp nhạc từ YouTube vào **hàng đợi**.
- Bài phát xong sẽ **tự rời khỏi hàng đợi** (và được lưu vào lịch sử).
- Có **3 vai trò**: Admin (chủ phòng), DJ (người phát nhạc), Guest (đóng góp nhạc).
- Phong cách giao diện **cổ điển quý tộc Anh + đĩa than** (chỉ nghe nhạc, không cần xem video).
- **Tối ưu chi phí tối đa**: server chỉ nhận/kiểm tra request & đẩy realtime; trình duyệt người dùng làm việc nặng (phát nhạc, render). Mục tiêu host **free tier**.

### Ngoài phạm vi (Phase 1)
- Logic chat, thả emoji/cảm xúc, like bài hát — **chỉ dựng UI sẵn**, logic làm ở Phase 2.
- Tài khoản đăng nhập thật (chỉ dùng tên + mật khẩu phòng).
- Xem video YouTube (chỉ phát audio).
- Đồng bộ âm thanh ra nhiều máy (chỉ máy DJ phát ra tiếng).

---

## 2. Quyết định cốt lõi (chốt khi brainstorming)

| Chủ đề | Quyết định |
|---|---|
| Mô hình phát nhạc | **Chỉ máy DJ phát ra tiếng.** Người khác đóng góp & quản lý hàng đợi, máy họ im lặng. → Chỉ cần đồng bộ *hàng đợi/now-playing*, không đồng bộ vị trí phát giữa các máy. |
| Vòng đời phòng | **Lưu lâu dài (persistent)** — có mã/link cố định, giữ setting & lịch sử → cần database. |
| Quy mô | **≤ ~50 người/phòng** (vừa). |
| Thêm nhạc | **Dán link YouTube** là chính (miễn phí, không cần API key). **Ô tìm kiếm** là tùy chọn (chỉ bật khi cấu hình YouTube Data API key). |
| Vai trò DJ | **1 DJ tại một thời điểm, do Admin chỉ định.** Người tạo phòng mặc định là Admin + DJ; có thể trao quyền DJ. |
| Quyền Admin | Đổi chế độ phát (Thứ tự/Trộn) + quản lý thành viên & vai trò (giao/thu DJ, chuyển Admin, kick, đổi tên phòng). |
| Backend | **Supabase** (Postgres + Realtime + RPC) + Next.js client-rendered trên **Vercel/Cloudflare Pages**. |
| Bảo mật vào phòng | **Tạo phòng phải đặt mật khẩu; vào phòng phải nhập đúng mật khẩu** (kiểm tra server-side qua RPC, băm bcrypt). |
| Phong cách UI | **C — Vintage Library**: giấy da (parchment), mực nâu (sepia), đỏ rượu vang (burgundy), đồng faded; chữ serif (Cormorant Garamond / EB Garamond / Playfair Display). |
| Bố cục | **A — Salon**: đĩa than chính giữa, Thành viên + Chat bên trái, Hàng đợi bên phải. |
| Thêm UI (logic sau) | Chat, thả cảm xúc emoji, like bài hát — hiển thị "Sắp ra mắt". |

---

## 3. Kiến trúc tổng thể

```
① TRÌNH DUYỆT NGƯỜI DÙNG (làm việc nặng)
   🎧 Máy DJ        — nguồn âm thanh duy nhất (YouTube IFrame Player, ẩn video);
                      điều khiển play/pause/skip/seek/volume; bài xong tự advance;
                      ghi "đang phát" + mốc started_at.
   👑 Máy Admin     — đổi chế độ phát; quản lý vai trò & thành viên; cũng xóa/kéo bài.
   👤 Máy người nghe — im lặng, chỉ xem & đóng góp link; thanh tiến độ tự chạy.
        │  Đọc: subscribe Supabase Realtime (WebSocket)
        │  Ghi: gọi RPC (kiểm tra token + vai trò)
        ▼
② SUPABASE (free tier)
   🗄️ Postgres   — rooms, members, queue_items, play_history (+ bảng secrets)
   📡 Realtime   — đẩy thay đổi tới mọi máy tức thì
   🔐 RPC (SECURITY DEFINER) — mọi thao tác ghi đi qua đây, kiểm tra quyền trước khi sửa

   🎼 YouTube: IFrame Player (chỉ DJ) + oEmbed (lấy tên/ảnh, miễn phí, không key)
   ▲ Vercel/Cloudflare Pages: chỉ phục vụ file tĩnh Next.js → chi phí ~ $0
```

### 3 cơ chế quan trọng
1. **Chỉ DJ phát tiếng** → không cần đồng bộ vị trí phát qua mạng (nhẹ nhất).
2. **Tiến độ suy ra từ mốc thời gian, không cần heartbeat:** máy DJ chỉ ghi `started_at` (mốc ảo) mỗi khi đổi trạng thái (play/pause/seek/đổi bài). Mọi máy tự tính `elapsed = now − started_at`. → Cực kỳ ít message realtime. Khi DJ **tua**, chỉ ghi lại `started_at` → thanh tiến độ mọi máy nhảy theo.
3. **Mọi ghi đi qua RPC kiểm tra quyền:** mỗi người có **token bí mật** (lưu `localStorage`). RPC xác thực token + vai trò trước khi cho sửa. Realtime chỉ dùng để đọc.

---

## 4. Công nghệ

- **Next.js 16.2.9** (App Router) + **React 19** + **TypeScript** + **Tailwind CSS v4** (đã có sẵn trong repo).
  - ⚠️ **Bắt buộc:** Đây là bản Next.js có thay đổi phá vỡ so với kiến thức cũ. **Đọc `node_modules/next/dist/docs/`** trước khi viết code, tuân theo các cảnh báo deprecation (theo `AGENTS.md`).
  - App chủ yếu là **client components** (render phía client) để giữ server gần như không làm gì.
- **Supabase JS client** (`@supabase/supabase-js`): Postgres + Realtime + RPC.
- **YouTube IFrame Player API** (chỉ tải trên máy DJ) + **YouTube oEmbed** (lấy metadata).
- **State phía client:** React hooks + Context (hoặc một store nhẹ như Zustand nếu cần). Tránh thêm dependency nặng.
- **Hosting:** Vercel hoặc Cloudflare Pages (static/SSG + client) — free tier.

---

## 5. Mô hình dữ liệu (Postgres)

> Bật extension `pgcrypto` (băm mật khẩu) và bật **Realtime** cho các bảng cần subscribe.

### `rooms` — nguồn sự thật cho trạng thái phát
| cột | kiểu | ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `code` | text UNIQUE | mã ngắn chia sẻ, vd `salon-xK3` |
| `name` | text | tên phòng |
| `play_mode` | text `'order'`\|`'shuffle'` | chế độ phát |
| `admin_member_id` | uuid | trỏ member đang là Admin (đảm bảo 1 admin) |
| `dj_member_id` | uuid \| null | trỏ member đang là DJ (đảm bảo 1 DJ) |
| `current_item_id` | uuid \| null | bài đang phát |
| `is_playing` | bool | đang phát / tạm dừng |
| `started_at` | timestamptz \| null | mốc ảo: `elapsed = now − started_at` |
| `paused_elapsed_ms` | int default 0 | vị trí đã trôi khi tạm dừng (để resume/seek) |
| `created_at` | timestamptz default now() | |

### `room_secrets` — tách riêng, **không cho client đọc**
| cột | kiểu | ghi chú |
|---|---|---|
| `room_id` | uuid PK FK | |
| `password_hash` | text | bcrypt qua `crypt()`/`gen_salt('bf')` của pgcrypto |

### `members` — danh tính + vai trò (bền vững theo phòng)
| cột | kiểu | ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `room_id` | uuid FK | |
| `name` | text | tên tự đặt |
| `token_hash` | text | sha-256 của token bí mật (token gốc ở `localStorage`) |
| `joined_at` | timestamptz default now() | |

> Online/offline dùng **Supabase Realtime Presence** (ephemeral), không lưu DB.

### `queue_items` — hàng đợi
| cột | kiểu | ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `room_id` | uuid FK | |
| `youtube_video_id` | text | tách từ link |
| `title` | text | qua oEmbed |
| `thumbnail_url` | text | qua oEmbed |
| `duration_seconds` | int \| null | điền khi máy DJ tải bài (hoặc qua API nếu có key) |
| `added_by_member_id` | uuid FK | |
| `added_by_name` | text | lưu kèm để vẫn hiển thị khi người đó rời phòng |
| `position` | double precision | sắp thứ tự; "kéo lên đầu" = nhỏ hơn min; chèn giữa = trung bình 2 hàng xóm |
| `created_at` | timestamptz default now() | |

### `play_history` — lịch sử đã phát (phần lưu lâu dài)
`id` PK, `room_id` FK, `youtube_video_id`, `title`, `added_by_name`, `played_at`.

### Bảng dự trữ cho Phase 2 (chỉ ghi chú, **chưa tạo**)
- `chat_messages(id, room_id, member_id, name, body, created_at)`
- `reactions(id, room_id, member_id, emoji, created_at)` — biểu cảm thoáng qua
- `song_likes(queue_item_id, member_id)` — like bài, unique theo cặp

---

## 6. Vai trò & phân quyền

| Hành động | Guest | DJ | Admin |
|---|:--:|:--:|:--:|
| Xem phòng, dán link thêm bài | ✅ | ✅ | ✅ |
| Chat / thả emoji / like *(UI giờ, logic Phase 2)* | ✅ | ✅ | ✅ |
| ⏯ Play/Pause, ⏭ Skip, tua timeline, chỉnh âm lượng | — | ✅ | — |
| Xóa bài *đang chờ* trong hàng đợi, kéo lên ưu tiên, kéo-thả đổi thứ tự | — | ✅ | ✅ |
| Đổi chế độ Thứ tự / Trộn | — | — | ✅ |
| Giao/thu quyền DJ, chuyển Admin, kick, đổi tên phòng | — | — | ✅ |

**Quy ước:**
- Điều khiển phát (play/pause/skip/seek/volume) thuộc **DJ** (máy DJ là nguồn âm thanh). Âm lượng là **cục bộ** trên máy DJ (lưu `localStorage`), không đồng bộ.
- **Skip** bài đang phát chỉ DJ làm (là thao tác trên player). Admin/DJ xóa được các bài *đang chờ*; **không** xóa trực tiếp bài đang phát (muốn bỏ thì DJ skip).
- Chỉ **1 Admin** và **1 DJ** mỗi thời điểm (đảm bảo bằng con trỏ trên `rooms`). Người tạo phòng mặc định là cả hai.

---

## 7. Các luồng chính

1. **Tạo phòng:** nhập tên + đặt mật khẩu phòng → RPC `create_room` (tạo `rooms`, `room_secrets` băm mật khẩu, `members` cho người tạo; gán `admin_member_id`=`dj_member_id`=người tạo) → trả `code` + member token → lưu `localStorage`.
2. **Vào phòng:** mở `/room/[code]` → nhập tên + mật khẩu → RPC `join_room(code, name, password)` kiểm tra mật khẩu (`crypt`) → đúng: tạo member + trả token; sai: báo lỗi, không vào.
3. **Reload / vào lại:** đọc `localStorage` (`{code, memberId, token}`) → re-subscribe realtime, **giữ nguyên vai trò**. Không phải nhập lại mật khẩu.
4. **Thêm bài:** dán link → client tách `videoId` → fetch oEmbed lấy title+thumbnail → RPC `add_queue_item` (`position = max+1`) → realtime cập nhật mọi người. Nếu đang **idle** (không có bài phát) và có DJ online → máy DJ tự bắt đầu phát bài kế.
5. **Phát & chuyển bài (máy DJ):** player `ENDED` → RPC `advance_queue`: ghi bài hiện tại vào `play_history`, xóa khỏi `queue_items`, chọn bài kế (`order`: position nhỏ nhất / `shuffle`: ngẫu nhiên), set `current_item_id`, `started_at=now`, `is_playing=true`. Hàng đợi trống → `current_item_id=null`, `is_playing=false` (UI: "Hàng đợi trống").
6. **Tạm dừng / resume / tua / âm lượng (DJ):**
   - Pause → `is_playing=false`, `paused_elapsed_ms = now − started_at`.
   - Resume → `started_at = now − paused_elapsed_ms`, `is_playing=true`.
   - Seek(P) → đặt `started_at = now − P` (đang phát) hoặc `paused_elapsed_ms = P` (đang dừng); máy DJ `seekTo(P)`.
   - Volume → chỉ cục bộ máy DJ.
7. **Quản lý hàng đợi (Admin/DJ):** RPC `reorder_item` (đổi `position`), `bump_to_top`, `delete_item`.
8. **Đổi chế độ (Admin):** RPC `set_play_mode`.
9. **Vai trò (Admin):** `assign_dj(member)`, `transfer_admin(member)` (kèm xác nhận; admin cũ thành Guest), `kick(member)`, `rename_room`.
10. **DJ rời phòng:** Presence offline → không còn nguồn phát; UI báo "DJ đang offline — chờ DJ". Admin gán DJ mới → máy DJ mới tải player & tiếp tục từ `started_at`/`paused_elapsed_ms` đã lưu.
11. **Bị kick:** member nhận sự kiện realtime → bị đẩy ra màn hình "Bạn đã bị mời khỏi phòng".

**Trường hợp biên cần xử lý:** Admin offline lâu (Phase 1: phòng vẫn chạy, setting tạm khóa cho tới khi Admin quay lại; *future:* cho "claim admin" sau X phút). Bài trùng được phép thêm. Tranh chấp reorder giải quyết bằng `position` dạng số thực, ghi qua RPC.

---

## 8. Realtime & đồng bộ

- Mỗi client subscribe **postgres_changes** trong phạm vi `room_id`:
  - `rooms` (this room) → now-playing, chế độ, vai trò.
  - `queue_items` (filter `room_id`) → hàng đợi.
  - `members` (filter `room_id`) → danh sách thành viên.
- **Presence channel** theo phòng (key = `memberId`) → online/offline.
- Tiến độ tính cục bộ từ `started_at`/`is_playing`/`paused_elapsed_ms` → **không** stream vị trí.
- Ngân sách free tier: ≤50 người × vài thay đổi/phút là nhỏ; vẫn cần để mắt nếu nhiều phòng đông cùng lúc.

---

## 9. Tích hợp YouTube

- **Thêm bằng link:** chấp nhận các dạng `youtube.com/watch?v=`, `youtu.be/`, `music.youtube.com`, có thể kèm timestamp; tách `videoId` bằng regex/parse URL. Lấy title+thumbnail qua **oEmbed** (`https://www.youtube.com/oembed?url=...&format=json`) — miễn phí, không cần key.
- **Phát:** chỉ máy DJ nhúng **IFrame Player API**, kích thước ẩn/nhỏ (chỉ cần audio). `duration_seconds` lấy từ player khi tải; ghi ngược lên `queue_items` nếu còn thiếu.
- **Ô tìm kiếm (tùy chọn):** chỉ bật khi có `YOUTUBE_API_KEY` (feature flag). Cảnh báo: `search.list` tốn 100 quota/lượt, free ~10.000/ngày → ~100 lượt/ngày cho toàn app. Mặc định **tắt**.
- Rủi ro: vài video chặn nhúng (embedding disabled) → bắt lỗi player, báo "không phát được", cho DJ skip.

---

## 10. Bảo mật (mức hợp lý cho app vui, không phải hệ thống ngân hàng)

- **Mật khẩu phòng:** băm bcrypt trong `room_secrets`, kiểm tra server-side qua RPC. Client không bao giờ giữ mật khẩu sau khi vào.
- **Token thành viên:** token ngẫu nhiên (≥32 byte) lưu `localStorage`; DB chỉ lưu sha-256. Mọi RPC ghi đều nhận `(member_id, token)` và xác thực + kiểm tra vai trò.
- **RLS:** bật trên mọi bảng. Cho **SELECT** dữ liệu công khai theo phòng (rooms/members/queue_items/play_history) để client đọc + realtime hoạt động; **chặn INSERT/UPDATE/DELETE trực tiếp** từ client. Mọi ghi qua **RPC `SECURITY DEFINER`**.
- `room_secrets` **không** có policy SELECT cho client (chỉ RPC truy cập).
- Lưu ý chấp nhận: có thể giả mạo *tên* hiển thị; nhưng không leo thang vai trò nếu không có token hợp lệ.

---

## 11. Giao diện (Style C · Layout A)

- **Phong cách C — Vintage Library:** nền giấy da, mực nâu `#3a2f23`, đỏ rượu `#6e2233`, đồng faded `#b08d57`, điểm sáng `#fff7e6`. Chữ: tiêu đề `Cormorant Garamond`/`Playfair Display`, thân `EB Garamond`.
- **Bố cục A — Salon:**
  - **Header:** 🎩 tên phòng · nút sao chép mã/link · gạt **Thứ tự/Trộn** (Admin) · ⚙️ Setting (Admin).
  - **Cột trái:** **Thành viên** (chấm online, badge 👑 Admin / 🎧 DJ) + **Chat** *(Sắp ra mắt)*.
  - **Giữa (sân khấu):** **đĩa than quay** + cần đĩa, tên bài + người đóng góp, thanh tiến độ (DJ kéo để tua), nút ⏮⏯⏭ + **âm lượng** *(chỉ DJ)*, hàng **thả cảm xúc** 😍🔥👏🕺❤️ *(Sắp ra mắt)*.
  - **Cột phải:** ô **dán link YouTube** (+ ô tìm kiếm tùy chọn), **hàng đợi** (thumbnail, người order, ♥ like *(Sắp ra mắt)*, nút ⬆ kéo lên đầu / ✕ xóa / ⠿ kéo-thả — chỉ Admin & DJ).
- **Theo vai trò:** Guest thấy cùng bố cục nhưng **ẩn** nút điều khiển phát + nút xóa/kéo bài.
- **Responsive:** ≤1000px → 3 cột xếp dọc.
- **Trang vào phòng:** form đặt tên + mật khẩu (tạo phòng) / nhập tên + mật khẩu (vào phòng), cùng tông cổ điển.
- Mockup tham chiếu: `.superpowers/brainstorm/.../room-mockup.html` (đã duyệt).

---

## 12. Cấu trúc dự án (dự kiến)

```
app/
  page.tsx                  # trang chủ: tạo / vào phòng
  room/[code]/page.tsx      # phòng nghe (client component)
lib/
  supabase.ts               # khởi tạo client
  youtube.ts                # parse link, oEmbed, helper IFrame
  identity.ts               # token/localStorage, danh tính & vai trò
  realtime.ts               # subscribe postgres_changes + presence
components/
  room/Turntable.tsx        # đĩa than + cần đĩa + animation
  room/NowPlaying.tsx       # tiến độ (suy ra từ started_at) + điều khiển DJ
  room/Queue.tsx            # hàng đợi + thêm bài + reorder/xóa
  room/MemberList.tsx       # thành viên + vai trò
  room/ChatPanel.tsx        # UI chat (Sắp ra mắt)
  room/Reactions.tsx        # UI thả cảm xúc (Sắp ra mắt)
  room/SettingsDialog.tsx   # Admin: chế độ + quản lý vai trò
supabase/
  migrations/*.sql          # schema + RLS + RPC functions
```

---

## 13. Kiểm thử

- **Logic thuần (unit):** parse link YouTube → videoId; tính `elapsed` từ `started_at`/`paused_elapsed_ms`; chọn bài kế (order vs shuffle); tính `position` khi reorder/bump.
- **RPC (integration):** chạy trên Supabase local (Docker) — kiểm tra phân quyền (token sai/đúng, vai trò), mật khẩu đúng/sai, advance_queue, transfer_admin.
- **Theo TDD** khi triển khai từng đơn vị (skill test-driven-development ở bước lập kế hoạch).
- Đồng bộ realtime kiểm tra thủ công bằng 2–3 tab/thiết bị.

---

## 14. Triển khai & free tier

- **Frontend:** Vercel/Cloudflare Pages (static + client). Biến môi trường: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, (tùy chọn) `YOUTUBE_API_KEY`.
- **Supabase:** project free tier; chạy migrations SQL. Lưu ý project free có thể "ngủ" khi cả tuần không dùng → lần truy cập đầu hơi chậm (chấp nhận được).
- **Mục tiêu chi phí:** ~$0 ở quy mô vài phòng ≤50 người.

---

## 15. Kế hoạch theo giai đoạn

- **Phase 1 (MVP):** tạo/vào phòng có mật khẩu; danh tính theo tên + token; hàng đợi (thêm bằng link, oEmbed); phát chỉ-DJ + đồng bộ now-playing (timestamp); play/pause/skip/seek/volume; xóa/kéo/đổi thứ tự; chế độ Thứ tự/Trộn; quản lý vai trò & thành viên; presence; lịch sử; UI Style C + Layout A; **UI placeholder** cho chat/emoji/like.
- **Phase 2:** nối logic **chat**, **thả cảm xúc**, **like bài hát**; (tùy chọn) ô tìm kiếm YouTube; (tùy chọn) "claim admin" khi admin offline lâu.

---

## 16. Câu hỏi mở / sẽ quyết khi triển khai
- Có cần giới hạn số bài mỗi người không? (hiện: **không** — có thể thêm sau nếu bị spam.)
- Có cần auto-skip khi video bị chặn nhúng/lỗi tải sau N giây không? (đề xuất: có, để DJ không kẹt.)
- Cơ chế "claim admin" khi admin biến mất (Phase 2).
