# 🚀 Đưa web lên VPS — hướng dẫn cho người mới hoàn toàn

> Không cần biết lập trình. Chỉ cần **làm đúng thứ tự**, **copy – dán** đúng chỗ.
> Tổng thời gian khoảng 30–60 phút, chưa tính thời gian chờ P.A mở khoá tên miền.

Khi làm xong sẽ có:
- 🟢 **https://dev.muziktogether.io.vn** là bản thử nghiệm (nhánh `dev`)
- 🔵 **https://muziktogether.io.vn** là bản chính thức (nhánh `main`)
- Mỗi lần có code mới, web **tự cập nhật**, bạn không phải làm gì.

---

## 📋 Danh sách việc cần làm

| # | Việc | Làm ở đâu | Mất bao lâu |
|---|---|---|---|
| 1 | Nhờ P.A mở khoá tên miền | Chat / điện thoại với P.A | 5 phút, rồi chờ vài giờ |
| 2 | Lấy 2 thông tin Supabase | Trang Vercel | 3 phút |
| 3 | Mở cửa sổ lệnh của VPS | Trang quản lý VPS | 2 phút |
| 4 | Dán 1 lệnh cài đặt | Cửa sổ lệnh VPS | 15 phút (máy tự chạy) |
| 5 | Tạo 2 "đường hầm" Cloudflare | Trang Cloudflare | 10 phút, **làm sau khi xong việc 1** |
| 6 | Dán 2 mã đường hầm vào VPS | Cửa sổ lệnh VPS | 5 phút |
| 7 | Bật tự động cập nhật | Trang GitHub | 5 phút |

Việc 1 phải **chờ P.A**, nên trong lúc chờ bạn cứ làm việc 2, 3, 4 trước.

---

## ✅ VIỆC 1 — Nhờ P.A Việt Nam mở khoá tên miền

**Vì sao cần:** tên miền vừa mua đang bị P.A **tạm khoá** (trạng thái `clientHold`), nên web chưa chạy được và chưa đổi được cài đặt.

**Cách làm:**
1. Mở trang quản lý tên miền của P.A, tìm nút **Chat / Hỗ trợ**. Hoặc gọi **1900 9477**.
2. Gửi nguyên văn đoạn này (bấm vào khung, bôi đen, copy rồi dán):

```
Chào P.A, tên miền muziktogether.io.vn đã xác thực đủ hồ sơ (CCCD, bản khai, xác thực chủ thể)
nhưng vẫn đang bị clientHold nên không đổi được nameserver.
Nhờ P.A gỡ clientHold và đổi nameserver sang:
fattouche.ns.cloudflare.com
jule.ns.cloudflare.com
Cảm ơn!
```

3. Chờ P.A trả lời. Thường mất vài giờ trong giờ hành chính.

👉 Trong lúc chờ, làm tiếp **Việc 2**.

---

## ✅ VIỆC 2 — Lấy 2 thông tin Supabase (giữ sẵn trong Notepad)

Web cần 2 thông tin này để kết nối cơ sở dữ liệu. Chúng đang được lưu trên Vercel.

1. Mở trình duyệt, vào **https://vercel.com** và đăng nhập.
2. Bấm vào project **music-together**.
3. Bấm tab **Settings** (ở thanh trên cùng).
4. Ở menu bên trái, bấm **Environment Variables**.
5. Bạn sẽ thấy 2 dòng. Bấm biểu tượng 👁 (con mắt) để hiện giá trị:
   - `NEXT_PUBLIC_SUPABASE_URL`: giá trị dạng `https://abcxyz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: một chuỗi dài
6. Mở **Notepad** trên máy (bấm phím Windows, gõ `notepad`, Enter), rồi copy 2 giá trị đó dán vào Notepad như sau:

```
URL: https://abcxyz.supabase.co
KEY: sb_publishable_xxxxxxxxxxxxxxxx
```

Để Notepad đó mở, lát nữa dùng.

---

## ✅ VIỆC 3 — Mở "cửa sổ lệnh" của VPS

"Cửa sổ lệnh" là nơi gõ lệnh để điều khiển máy chủ. Dùng **Console trên trang quản lý**, không cần cài gì thêm.

1. Vào **https://vps.cloudcode.io.vn** và đăng nhập tài khoản panel.
2. Bấm vào server **nat-plus-kakxx3**.
3. Tìm nút **Console** (hoặc **VNC**, **Web Console**), bấm vào. Một ô màn hình đen hiện ra.
4. Màn hình đen hiện chữ `login:`
   - Gõ `root` rồi bấm **Enter**
   - Hiện `Password:` thì gõ (hoặc dán) **mật khẩu root** rồi bấm **Enter**
   - ⚠️ Khi gõ mật khẩu **màn hình không hiện ký tự nào**. Đó là bình thường, cứ gõ xong rồi Enter.
5. Thấy dòng như sau là đã vào thành công:

```
root@nat-plus-kakxx3:~#
```

> 💡 **Mẹo dán trong Console:** có trang cho phép `Ctrl + Shift + V` hoặc chuột phải → Paste. Nếu Console không cho dán, tìm nút **"Paste / Send text"** trên thanh của Console.
>
> Nếu vẫn không dán được, xem **Phụ lục A** để dùng PowerShell trên máy bạn (dán dễ hơn).

---

## ✅ VIỆC 4 — Dán 1 lệnh cài đặt (máy tự làm hết)

1. Copy **nguyên dòng** dưới đây:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/quick.sh)
```

2. Dán vào cửa sổ lệnh VPS (ngay sau chữ `root@nat-plus-kakxx3:~#`), rồi bấm **Enter**.
3. Máy hiện `1/4 Cài Docker…`. **Chờ 2–5 phút**, đừng tắt cửa sổ.
4. Máy bắt đầu **hỏi**. Trả lời theo bảng dưới. Mỗi câu trả lời xong thì bấm **Enter**:

| Máy hỏi | Bạn làm gì |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL:` | dán dòng **URL** trong Notepad (chỉ phần `https://...`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:` | dán dòng **KEY** trong Notepad (chỉ phần chuỗi) |
| `Bản main dùng CHUNG Supabase này? (y/n) [y]:` | cứ bấm **Enter** |
| `Token tunnel DEV …:` | **chưa có**, bấm **Enter** bỏ qua |
| `Token tunnel MAIN …:` | **chưa có**, bấm **Enter** bỏ qua |

5. Máy hiện `4/4 Build và chạy…`. **Chờ 5–10 phút.**
6. Khi xong, thấy dòng này là thành công:

```
   ✅ dev đang chạy
```

Dòng `main: nhánh main chưa có script … bỏ qua` là **bình thường**. Bản chính thức sẽ bật sau.

7. Cuối cùng máy in ra một khung có chữ `VPS_SSH_KEY` và một đoạn dài bắt đầu bằng `-----BEGIN OPENSSH PRIVATE KEY-----`.
   - **Bôi đen toàn bộ** từ `-----BEGIN` đến hết `-----END OPENSSH PRIVATE KEY-----`, copy rồi dán vào Notepad (dòng mới, ghi chú `KHOA GITHUB:`).
   - ⚠️ Đây là **mật mã**. **Không gửi cho ai**, kể cả khi chụp màn hình gửi mình thì nhớ che đi.

📸 **Chụp màn hình phần cuối (che đoạn khóa) gửi mình** để mình kiểm tra.

---

## ✅ VIỆC 5 — Tạo 2 "đường hầm" Cloudflare
> ⏳ **Chỉ làm khi P.A đã mở khoá xong** (Việc 1). Khi đó Cloudflare báo tên miền **Active**, thường có email gửi về.

"Đường hầm" giúp tên miền trỏ vào VPS mà không cần mở cổng, và có sẵn khoá 🔒 HTTPS.

### 5a. Kiểm tra Cloudflare đã Active chưa
1. Vào **https://dash.cloudflare.com** và đăng nhập.
2. Bấm vào **muziktogether.io.vn**.
3. Trang **Overview** hiện chữ **Active** màu xanh là được. Nếu vẫn còn "Pending" thì cuộn xuống, bấm **Check nameservers now** rồi chờ thêm.

### 5b. Tạo đường hầm cho bản thử nghiệm (dev)
1. Ở menu trái của Cloudflare, bấm **Zero Trust**. Lần đầu sẽ hỏi đặt tên nhóm: gõ gì cũng được, vd `muzik`. Chọn gói **Free** (0$).
2. Trong Zero Trust, menu trái bấm **Networks**, rồi **Tunnels**.
3. Bấm nút **Create a tunnel**.
4. Chọn **Cloudflared**, bấm **Next**.
5. Ô tên: gõ `mt-dev`, bấm **Save tunnel**.
6. Trang tiếp theo có nhiều ô chọn hệ điều hành và **một ô lệnh dài**. **KHÔNG chạy lệnh đó.** Làm như sau:
   - Tìm trong lệnh đoạn chữ bắt đầu bằng **`eyJ`** (rất dài, nằm ngay sau chữ `--token` hoặc `install`).
   - Bôi đen **chỉ đoạn `eyJ…` đó** (đến hết lệnh), copy, rồi dán vào Notepad với ghi chú `TOKEN DEV:`.
7. Bấm **Next** (góc dưới phải).
8. Màn hình **Route traffic / Public hostname**, điền:

| Ô | Điền |
|---|---|
| Subdomain | `dev` |
| Domain | chọn `muziktogether.io.vn` |
| Path | để trống |
| Type | chọn `HTTP` |
| URL | `app:3000` |

9. Bấm **Save tunnel** (hoặc **Complete setup**).

### 5c. Tạo đường hầm cho bản chính (main)
Làm **y hệt 5b**, chỉ khác 3 chỗ:
- Tên tunnel: `mt-main`
- Token lưu vào Notepad với ghi chú `TOKEN MAIN:`
- Ô **Subdomain**: **để trống**

---

## ✅ VIỆC 6 — Dán 2 mã đường hầm vào VPS

1. Mở lại cửa sổ lệnh VPS như **Việc 3**.
2. Dán lại **đúng lệnh cũ**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/quick.sh)
```

3. Trả lời:

| Máy hỏi | Bạn làm gì |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL:` | bấm **Enter** (giữ như cũ) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:` | bấm **Enter** |
| `Bản main dùng CHUNG…` | bấm **Enter** |
| `Token tunnel DEV …:` | dán **TOKEN DEV** trong Notepad |
| `Token tunnel MAIN …:` | dán **TOKEN MAIN** trong Notepad |

4. Chờ máy chạy xong (khoảng 1–3 phút).
5. Mở trình duyệt vào **https://dev.muziktogether.io.vn**. Thấy trang web là 🎉 **xong phần web**.

---

## ✅ VIỆC 7 — Bật tự động cập nhật (GitHub)

Làm việc này thì mỗi khi có code mới, web tự cập nhật.

1. Vào **https://github.com/AleamZ/Music-Together/settings/secrets/actions** (đăng nhập GitHub nếu được hỏi).
2. Bấm nút xanh **New repository secret**.
3. Tạo **4 lần**. Mỗi lần điền ô **Name** và ô **Secret**, rồi bấm **Add secret**:

| Lần | Name (gõ đúng chữ hoa) | Secret |
|---|---|---|
| 1 | `VPS_HOST` | `vn-hn.cloudcode.io.vn` |
| 2 | `VPS_PORT` | `30359` |
| 3 | `VPS_USER` | `deploy` |
| 4 | `VPS_SSH_KEY` | dán **KHOA GITHUB** trong Notepad (cả dòng BEGIN và END) |

4. Kiểm tra: vào tab **Actions** của repo → bên trái chọn **Deploy VPS** → bấm **Run workflow** → chọn `dev` → bấm nút xanh **Run workflow**.
5. Chờ vài phút, thấy dấu ✅ xanh là **tự động cập nhật đã hoạt động**.

> ⚠️ Bước này cần SSH từ ngoài vào VPS hoạt động. Hiện máy bạn đang báo lỗi `Connection reset` khi SSH. Nếu Actions báo lỗi ở bước deploy, xem **Phụ lục B** hoặc gửi ảnh cho mình.

---

## 🔵 Bật bản chính thức (muziktogether.io.vn)

Bản chính chạy từ nhánh `main`. Chỉ cần gộp code `dev` vào `main` một lần:
1. Vào **https://github.com/AleamZ/Music-Together/compare/main...dev**
2. Bấm **Create pull request**, rồi bấm **Create pull request** thêm lần nữa.
3. Bấm **Merge pull request**, rồi **Confirm merge**.
4. Chạy lại lệnh ở **Việc 6** (các câu hỏi cứ Enter). Bản main sẽ được dựng.
5. Mở **https://muziktogether.io.vn** 🎉

---

## 🆘 Phụ lục A — Dùng PowerShell thay cho Console (dán lệnh dễ hơn)

1. Trên máy Windows, bấm phím **Windows**, gõ `powershell`, bấm **Enter**.
2. Gõ lệnh sau rồi Enter:

```
ssh root@vn-hn.cloudcode.io.vn -p 30359
```

3. Nếu hỏi `yes/no`, gõ `yes` rồi Enter. Tiếp theo nhập mật khẩu root rồi Enter.
4. Trong PowerShell, **chuột phải = dán**.

Nếu báo `Connection reset`, xem Phụ lục B.

## 🆘 Phụ lục B — SSH báo `Connection reset`

Vào **Console trên panel** (Việc 3), dán lần lượt từng dòng, mỗi dòng xong thì Enter:

```bash
apt-get update && apt-get install -y openssh-server
systemctl enable --now ssh
systemctl restart ssh
```

Sau đó thử lại Phụ lục A. Nếu vẫn lỗi:
- Trên panel VPS, tìm mục **Port forwarding / Cổng**, chụp màn hình gửi mình.
- Hoặc thử bằng **4G điện thoại** (phát wifi từ điện thoại cho máy tính).

## 🆘 Phụ lục C — Lỗi hay gặp

| Thấy gì | Làm gì |
|---|---|
| `404` khi dán lệnh | Gõ sai hoặc thiếu ký tự. Copy lại **nguyên dòng** lệnh |
| Chờ mãi rồi hiện `Killed` | VPS thiếu RAM. Dán lệnh dưới đây rồi chạy lại Việc 4 |
| Web báo lỗi **1033** | Chưa dán token đường hầm, hoặc token sai. Làm lại Việc 6 |
| Web báo lỗi **502** | Web đang khởi động. Chờ 2 phút rồi tải lại trang |
| Tên miền không vào được | P.A chưa mở khoá. Xem lại Việc 1 |

Lệnh sửa lỗi thiếu RAM (dán 1 dòng):

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

### 💬 Cần giúp?
Ở bất kỳ bước nào, **chụp màn hình** (nhớ che mật khẩu, khóa và token) rồi gửi mình, kèm câu "đang ở Việc số mấy".
