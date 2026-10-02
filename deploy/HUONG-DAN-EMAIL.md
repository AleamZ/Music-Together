# Hướng dẫn bật đăng ký / đăng nhập bằng email (Supabase Auth)

Code đã sẵn sàng (migration `0112_email_auth.sql`, trang `/auth/callback` và `/auth/reset`). Những việc dưới đây
**chỉ bạn làm được** trên trang quản trị Supabase. Làm **cho cả 2 project**: project **dev** (dùng cho
`https://dev.<domain>` và `http://localhost:3000`) và project **prod** (dùng cho `https://<domain>`).

**Quy ước:** `<domain>` là tên miền của bạn, ví dụ `muziktogether.io.vn`. Chỗ nào ghi `<...>` thì thay bằng giá trị
của bạn và bỏ dấu `< >`. `🌐 Web` = thao tác trên trình duyệt tại https://supabase.com/dashboard.

| Project | Site URL | Dùng cho |
|---|---|---|
| dev | `https://dev.<domain>` | nhánh `dev`, máy của bạn (`localhost:3000`) |
| prod | `https://<domain>` | nhánh `main` |

---

## Bước 1 — Chạy migration 0112

Như mọi migration khác: mở **SQL Editor** của project, dán toàn bộ nội dung
`supabase/migrations/0112_email_auth.sql`, bấm **Run**. Làm ở dev trước, thử xong mới làm ở prod.
(Migration chạy lại nhiều lần vẫn an toàn.)

## Bước 2 — Bật đăng nhập bằng Email

🌐 **Authentication → Sign In / Providers** (tên cũ: *Providers*):
1. Mục **Email**: bật **Enable Email provider**.
2. Bật **Confirm email** (bắt buộc — game chỉ tạo nhân vật sau khi email đã xác nhận).
3. Bật **Secure email change** (đổi email phải xác nhận ở cả email cũ lẫn email mới).
4. **Minimum password length**: `8`. (Nếu có mục *Password requirements* thì chọn ít nhất "letters and digits".)
5. Mục **User Signups**: bật **Allow new users to sign up**. **Tắt** *Allow anonymous sign-ins* (game không dùng).
6. Bấm **Save**.

## Bước 3 — Địa chỉ trang web (URL Configuration)

🌐 **Authentication → URL Configuration**:
1. **Site URL**:
   - project **prod**: `https://<domain>`
   - project **dev**: `https://dev.<domain>`
2. **Redirect URLs** → **Add URL**, thêm từng dòng (cả 2 project đều thêm đủ 3 dòng cũng được; tối thiểu: prod thêm
   dòng 1, dev thêm dòng 2 và 3):
   ```
   https://<domain>/auth/*
   https://dev.<domain>/auth/*
   http://localhost:3000/auth/*
   ```
3. Bấm **Save**.

> Nếu thiếu dòng Redirect URL, Supabase sẽ đưa người chơi về Site URL thay vì `/auth/...` — trang chủ vẫn tự chuyển
> tiếp được, nhưng hãy thêm đủ để chắc chắn.

## Bước 4 — Máy gửi thư riêng (Custom SMTP) — bắt buộc trước khi mở cho mọi người

Máy gửi thư có sẵn của Supabase **chỉ gửi được vài thư mỗi giờ** và chỉ tới email của thành viên project — không đủ
cho người chơi thật. Dùng một dịch vụ gửi thư, ví dụ **Resend** (https://resend.com, gói miễn phí 3 000 thư/tháng,
100 thư/ngày), hoặc Brevo, Mailgun, Amazon SES, Postmark…

### 4.1 Tạo tài khoản Resend và xác minh tên miền
1. 🌐 Đăng ký tại https://resend.com.
2. **Domains → Add Domain** → nhập `<domain>` (hoặc một tên miền con như `mail.<domain>`).
3. Resend hiện ra vài bản ghi DNS (**MX**, **TXT** SPF, **TXT** DKIM `resend._domainkey`). Vào nơi quản lý DNS (ví dụ
   Cloudflare → DNS → Records) và thêm đúng từng bản ghi. Với Cloudflare, để **DNS only** (mây xám).
4. Quay lại Resend bấm **Verify**. Chờ tới khi trạng thái **Verified** (vài phút tới vài giờ).
5. **API Keys → Create API Key** → quyền **Sending access** → sao chép khoá (bắt đầu bằng `re_`). **Không** gửi khoá
   này qua chat, không dán vào code.

### 4.2 Điền vào Supabase
🌐 **Authentication → Emails → SMTP Settings** (tên cũ: *Project Settings → Authentication → SMTP*) → bật
**Enable Custom SMTP**, điền:

| Ô | Giá trị (Resend) |
|---|---|
| Sender email | `no-reply@<domain>` (phải thuộc tên miền đã xác minh) |
| Sender name | `Music Together` |
| Host | `smtp.resend.com` |
| Port number | `465` |
| Username | `resend` |
| Password | khoá API `re_...` ở bước 4.1 |
| Minimum interval between emails | `60` giây (mặc định) |

Bấm **Save**. Làm cho **cả 2 project** (có thể dùng chung một khoá, hoặc tạo 2 khoá cho dễ thu hồi).

### 4.3 Giới hạn gửi thư
🌐 **Authentication → Rate Limits**: sau khi có SMTP riêng, đặt **Rate limit for sending emails** khoảng `30`–`100`
thư/giờ (tuỳ gói Resend). Giữ nguyên các giới hạn đăng nhập / xác minh mặc định.

## Bước 5 — Mẫu thư tiếng Việt

🌐 **Authentication → Emails → Templates**. Sửa 3 mẫu dưới đây (ở **cả 2 project**): chép **Subject** và dán toàn
bộ **Body** (chế độ *Source* / HTML). Các liên kết dùng `token_hash` nên người chơi mở thư trên máy nào cũng được.

### 5.1 Confirm signup (Xác nhận đăng ký)

**Subject:** `Xác nhận email của bạn — Music Together`

```html
<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:24px;background:#fbf6ea;color:#2b1d14;border:1px solid #c9a24a;border-radius:12px">
  <h2 style="color:#6b1e2e;margin-top:0">Chào mừng bạn đến Music Together!</h2>
  <p>Bạn (hoặc ai đó) vừa đăng ký bằng email <b>{{ .Email }}</b>.</p>
  <p>Bấm nút dưới đây để xác nhận email và vào game:</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"
       style="background:#6b1e2e;color:#fbf6ea;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Xác nhận email</a>
  </p>
  <p style="font-size:13px;color:#6b5a4a">Liên kết chỉ dùng được một lần và sẽ hết hạn sau một thời gian ngắn. Nếu bạn không đăng ký, hãy bỏ qua thư này.</p>
</div>
```

### 5.2 Reset password (Đặt lại mật khẩu)

**Subject:** `Đặt lại mật khẩu — Music Together`

```html
<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:24px;background:#fbf6ea;color:#2b1d14;border:1px solid #c9a24a;border-radius:12px">
  <h2 style="color:#6b1e2e;margin-top:0">Đặt lại mật khẩu</h2>
  <p>Có yêu cầu đặt lại mật khẩu cho tài khoản <b>{{ .Email }}</b>.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"
       style="background:#6b1e2e;color:#fbf6ea;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Đặt mật khẩu mới</a>
  </p>
  <p style="font-size:13px;color:#6b5a4a">Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu của bạn không thay đổi.</p>
</div>
```

### 5.3 Change email address (Đổi email)

**Subject:** `Xác nhận đổi email — Music Together`

```html
<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:24px;background:#fbf6ea;color:#2b1d14;border:1px solid #c9a24a;border-radius:12px">
  <h2 style="color:#6b1e2e;margin-top:0">Xác nhận đổi email</h2>
  <p>Có yêu cầu đổi email tài khoản từ <b>{{ .Email }}</b> sang <b>{{ .NewEmail }}</b>.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email_change"
       style="background:#6b1e2e;color:#fbf6ea;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Xác nhận đổi email</a>
  </p>
  <p style="font-size:13px;color:#6b5a4a">Nếu bạn không yêu cầu, đừng bấm nút — hãy đăng nhập và đổi mật khẩu ngay.</p>
</div>
```

Bấm **Save** sau mỗi mẫu. (Mẫu *Magic Link*, *Invite user*, *Reauthentication* không dùng — để nguyên.)

## Bước 6 — Thử (làm ở dev trước)

1. Mở `https://dev.<domain>` → thẻ **Email** → **Đăng ký**: nhập email thật của bạn, tên nhân vật, mật khẩu ≥ 8 ký tự.
2. Mở hộp thư (xem cả mục Spam), bấm **Xác nhận email** → trang `/auth/callback` tự vào game với tên đã chọn.
3. **Đăng xuất**, đăng nhập lại bằng email. Thử **Quên mật khẩu?** → thư → đặt mật khẩu mới.
4. Đăng nhập bằng một tài khoản cũ (thẻ **Tên đăng nhập cũ**) → bấm tên mình ở góc trên → **Liên kết email** → mở thư
   **trên cùng trình duyệt** → tài khoản được liên kết; từ giờ tài khoản đó chỉ đăng nhập bằng email.
5. Trong 🌐 **Authentication → Users** sẽ thấy người dùng mới với cột *Confirmed*.

## Bước 7 — Đóng đăng ký kiểu cũ (sau khi email chạy ổn)

Trang web đã không còn nút đăng ký bằng tên đăng nhập, nhưng hàm `register` vẫn mở để không làm hỏng gì. Khi email đã
chạy tốt ở prod, chạy trong **SQL Editor** (project prod, sau đó dev nếu muốn):

```sql
update public.app_flags set enabled = false, changed_at = now() where key = 'legacy_register_open';
```

(Mở lại: đổi `false` thành `true`.) Tài khoản cũ vẫn đăng nhập bằng tên + mật khẩu như trước cho tới khi liên kết email.

## Ghi chú bảo mật

- Email người chơi nằm trong bảng `public.account_auth` (không ai đọc được từ trình duyệt), **không** nằm trong bảng
  `accounts` (bảng này ai cũng đọc được).
- Không bao giờ dán khoá `service_role` hay khoá SMTP vào code hoặc file `.env` được commit.
- Nếu nghi lộ khoá Resend: vào Resend → API Keys → **Revoke**, tạo khoá mới, điền lại ở Bước 4.2.
