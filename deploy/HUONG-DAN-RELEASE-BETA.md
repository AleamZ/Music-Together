# Hướng dẫn lên bản BETA (prod) + Reset Beta

Làm theo đúng thứ tự. Mọi lệnh chạy trên VPS, trừ khi có ghi chú khác.

| Bước | Việc | Ai làm |
|---|---|---|
| 0 | Sửa quyền thư mục deploy | root trên VPS |
| 1 | Backup DB prod | VPS |
| 2 | Chạy migration 0099 → 0118 trên prod | VPS |
| 3 | Cấu hình email Supabase cho prod | Supabase dashboard |
| 4 | Deploy main | VPS / GitHub Actions |
| 5 | Kiểm tra nhanh | Trình duyệt |
| 6 | Thử Reset Beta trên **dev** | Admin dev |
| 7 | Reset Beta trên **prod** | Admin prod |
| 8 | Đăng tin thông báo | Supabase SQL editor |

---

## 0. Sửa quyền thư mục (lỗi CI: `cannot open .git/FETCH_HEAD: Permission denied`)

Thư mục code đang thuộc root, nên user `deploy` không `git fetch` được.

```bash
sudo chown -R deploy:deploy /opt/music-together-main /opt/music-together-dev
```

## 1. Backup DB prod

Lấy chuỗi kết nối ở Supabase (project **prod**) → **Connect** → **Session pooler** (cổng 5432, **không** dùng 6543).

```bash
sudo apt-get install -y postgresql-client   # nếu chưa có psql/pg_dump
export DATABASE_URL='postgresql://postgres.<ref>:<mật-khẩu>@aws-0-<region>.pooler.supabase.com:5432/postgres'
pg_dump "$DATABASE_URL" -Fc -f ~/prod-truoc-beta-$(date +%F).dump
ls -lh ~/prod-truoc-beta-*.dump              # file phải > 0 byte
```

> Nếu pg_dump báo lệch phiên bản server, cài `postgresql-client-17` (hoặc dùng mục Backups trong Supabase dashboard).
> Không dán mật khẩu DB vào chat/commit. Chạy xong nên `unset DATABASE_URL`.

## 2. Chạy migration 0099 → 0118

```bash
cd /opt/music-together-main
git fetch origin main && git checkout -f origin/main   # để có đủ file migration mới nhất

# 2a. Chạy riêng 0099 trước (kinh tế) và xem kết quả
bash scripts/db/migrate-from.sh 0099 0099

# 2b. Chạy phần còn lại
bash scripts/db/migrate-from.sh 0100
```

- Mỗi file chạy trong 1 transaction. Lỗi ở đâu thì dừng ngay ở đó, các file trước vẫn giữ.
- Migration chạy lại được: sửa lỗi xong cứ chạy lại từ số bị lỗi, ví dụ `migrate-from.sh 0112`.
- Thấy dòng `[xx/xx] 0118_beta_reset.sql … ok` là xong.

Kiểm tra:

```bash
psql "$DATABASE_URL" -tAc "select to_regprocedure('public.admin_beta_snapshot(text)') is not null"   # t
```

## 3. Email Supabase cho prod

Làm theo `deploy/HUONG-DAN-EMAIL.md`:
- Site URL = `https://muziktogether.io.vn`
- Redirect URLs
- SMTP
- Mẫu email

## 4. Deploy main

Chọn một trong hai cách:

```bash
# Thủ công
su - deploy -c "/opt/music-together-main/scripts/vps/deploy.sh main"
su - deploy -c "/opt/music-together-dev/scripts/vps/deploy.sh dev"    # nếu dev cũng cần
```

hoặc GitHub → Actions → run "Deploy VPS" bị lỗi → **Re-run failed jobs**.

## 5. Kiểm tra nhanh trên https://muziktogether.io.vn

- Đăng nhập (username và email), quên mật khẩu.
- Vào phòng, đi lại, câu cá (lắp cần, rải thính), hòm thư.
- Thử trên điện thoại: HUD thu gọn, nút ☰.
- Xem log: `docker compose -f /opt/music-together-main/deploy/docker-compose.yml logs -f --tail=100`

---

## 6–7. Reset Beta

### Reset làm gì
- **Xoá sạch tiến trình, chỉ giữ tài khoản.** Mất ví, đồ, cần, cá, đất, nhà, thú, xe, cấp.
- Trước khi xoá, hệ thống **chốt sổ tổng tài sản** của từng người để xếp tier quà:
  - ví + đồ (theo giá shop) + cần/phụ kiện + cá + thời trang + nội thất + xe + thú + đất (800k/ô) + nhà + nông sản.

### Quà kỷ niệm (exclusive, không bán, không ai khác có)

| Tổng tài sản | Đồ Beta | Xu khởi đầu |
|---|---|---|
| < 10k | không có | 2.000 |
| ≥ 10k | Dép Beta | 5.000 |
| ≥ 50k | + Nón Beta | 8.000 |
| ≥ 100k | + Quần Beta | 12.000 |
| ≥ 200k | + Áo Beta | 16.000 |
| ≥ 500k | Full set Beta | 20.000 |

Mọi người chơi cũ còn được thêm:
- Thư **"Quà kỷ niệm Beta"**: xu, 20 Mồi tép, 5 Thính, đồ Beta theo tier.
- Cần tre lắp sẵn phụ kiện.
- Linh vật kỷ niệm (nội thất).
- Danh hiệu **"Người khai hoang Beta"** và khung tên Beta theo tier.
- **Tăng tốc 7 ngày**: +50% XP, +25% hạn mức NPC. Có chip đếm ngược trên HUD.

### Cách chạy (Admin → tab **Reset Beta**)

1. **Chốt sổ** (`admin_beta_snapshot`): chỉ đọc, chạy lại thoải mái. Xem bảng tier, số người mỗi tier, top tài sản.
   - Nếu báo **có tài sản chưa phân loại**, reset sẽ bị chặn. Báo dev để thêm giá cho loại đó.
2. Gõ **`RESET BETA`** rồi xác nhận (`admin_beta_reset`):
   - Xoá dữ liệu và phát quà trong **1 transaction**: lỗi thì không mất gì.
   - Bấm lại cũng không phát quà hai lần.
3. Mục **Trạng thái** (`admin_beta_status`) cho biết đã reset lúc nào và đã phát bao nhiêu phần quà.

**Bắt buộc thử trên dev trước** (dev.muziktogether.io.vn, DB dev đã có 0118). Sau khi reset dev, kiểm tra:
- tài khoản cũ vẫn đăng nhập được;
- hòm thư có quà, nhận được đồ;
- danh hiệu và khung tên hiện;
- chip tăng tốc hiện trên HUD.

Ổn rồi mới làm trên prod. **Nhớ backup ngay trước khi reset prod** (lặp lại bước 1).

## 8. Đăng tin thông báo

Supabase (prod) → SQL editor → dán nội dung `scripts/db/beta-reset-news.sql` → Run. Hoặc:

```bash
psql "$DATABASE_URL" -f scripts/db/beta-reset-news.sql
```

---

## Khôi phục khi có sự cố

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" ~/prod-truoc-beta-YYYY-MM-DD.dump
```

Nếu cần quay code main về bản cũ:

```bash
cd /opt/music-together-main && git checkout -f 9b0e91b
docker compose -f deploy/docker-compose.yml up -d --build
```

## Lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| `Permission denied` ở `.git` | Làm lại bước 0 |
| `connection reset by peer` khi CI SSH | fail2ban chặn IP GitHub: `sudo fail2ban-client set sshd unbanip <ip>`, hoặc deploy thủ công |
| `function ... does not exist` trên prod | Chưa chạy đủ migration, quay lại bước 2 |
| `This database has no game tables` | Sai `DATABASE_URL` (trỏ nhầm project) |
| Reset báo "chưa phân loại" | Có loại tài sản chưa có giá. Không reset, báo dev |
