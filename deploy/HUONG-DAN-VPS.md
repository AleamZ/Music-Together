# Hướng dẫn cấu hình VPS từng lệnh (dev + main, CI/CD, 2 domain)

File này hướng dẫn từ lúc có VPS trống đến lúc 2 domain chạy và tự deploy mỗi khi push code. Làm lần lượt theo thứ tự. Mỗi khối lệnh cứ copy rồi dán vào terminal.

**Quy ước:**
- `💻 Máy bạn`: chạy trên máy tính của bạn (PowerShell trên Windows, Terminal trên Mac/Linux).
- `🖥️ VPS`: chạy trong VPS, sau khi đã SSH vào hoặc đang mở Console trên panel.
- `🌐 Web`: thao tác trên trình duyệt.
- Chỗ nào ghi `<...>` thì thay bằng giá trị của bạn và bỏ dấu `< >`.

| Môi trường | Nhánh | Thư mục trên VPS | Cổng | Domain ví dụ |
|---|---|---|---|---|
| dev | `dev` | `/opt/music-together-dev` | 3001 | `dev.<domain>` |
| main | `main` | `/opt/music-together-main` | 3000 | `<domain>` |

---

## Bước 0: Chuẩn bị

### 0.1 Đổi mật khẩu (bắt buộc nếu mật khẩu đã từng gửi qua chat)
🌐 Web: vào https://vps.cloudcode.io.vn, chọn server, dùng chức năng **Change/Reset root password**. Đổi luôn mật khẩu tài khoản panel.

### 0.2 Đảm bảo nhánh `main` cũng có script
Script cài đặt lấy từ nhánh `dev`, và **main chỉ deploy được khi `main` đã được merge từ `dev`**.
🌐 Web: mở https://github.com/AleamZ/Music-Together/compare/main...dev, bấm **Create pull request**, rồi **Merge**.
(Nếu tạm thời chỉ cần dev thì bỏ qua bước này.)

---

## Bước 1: Vào VPS

💻 Máy bạn:
```bash
ssh root@vn-hn.cloudcode.io.vn -p 30359
```
- Khi hỏi `Are you sure...` thì gõ `yes` rồi Enter.
- Nhập mật khẩu root. Lúc gõ màn hình không hiện ký tự, đó là bình thường.
- Thấy dòng `root@nat-plus-...:~#` là đã vào.

**Nếu báo `Connection reset`:** dùng **Console** trên panel để vào, làm tiếp các bước dưới trong đó. Cách sửa SSH nằm ở **Phụ lục A**.

Kiểm tra hệ điều hành (cần Ubuntu hoặc Debian):
🖥️ VPS:
```bash
cat /etc/os-release | head -3
```

---

## Bước 2: Chạy script cài đặt

🖥️ VPS:
```bash
curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
```
Script chạy khoảng 2–5 phút và làm các việc:
- cài Docker và git;
- tạo user `deploy`;
- tạo `/opt/music-together-dev` và `/opt/music-together-main`, mỗi thư mục có sẵn file `.env`;
- tạo khóa SSH cho GitHub Actions.

Kiểm tra kết quả:
🖥️ VPS:
```bash
docker --version
ls -la /opt/ | grep music-together
ls /opt/music-together-dev/scripts/vps/
```
Phải thấy phiên bản Docker, 2 thư mục `music-together-dev` và `music-together-main`, và 2 file `setup.sh deploy.sh`.

Xem lại khóa cho GitHub. Bước 6 sẽ cần nên **copy toàn bộ**, từ dòng `-----BEGIN` đến hết dòng `-----END ... KEY-----`:
🖥️ VPS:
```bash
cat /home/deploy/.ssh/ci_deploy
```

---

## Bước 3: Tạo 2 Cloudflare Tunnel (gắn 2 domain)

### 3.1 Đưa domain lên Cloudflare (làm một lần)
🌐 Web:
1. Vào https://dash.cloudflare.com, đăng ký/đăng nhập, bấm **Add a domain**, nhập domain, chọn gói **Free**.
2. Cloudflare sẽ đưa 2 nameserver, dạng `xxx.ns.cloudflare.com`.
3. Vào trang quản lý nơi bạn mua domain, mục **Nameserver / DNS**, thay nameserver bằng 2 cái của Cloudflare.
4. Chờ đến khi trang domain trên Cloudflare báo **Active**.

Kiểm tra trạng thái nameserver:
💻 Máy bạn:
```bash
nslookup -type=ns <domain>
```
Kết quả phải có `cloudflare.com`.

### 3.2 Tunnel cho dev
🌐 Web: vào Cloudflare → **Zero Trust** → **Networks → Tunnels** → **Create a tunnel** → chọn **Cloudflared**.
1. Đặt tên `mt-dev`, bấm **Save tunnel**.
2. Màn hình *Install connector* hiện một lệnh có đoạn `--token eyJ...`. Chỉ **copy phần token** (chuỗi dài bắt đầu bằng `eyJ`), **không chạy** lệnh đó. Lưu tạm lại, gọi là **TOKEN_DEV**.
3. Bấm **Next**, sang tab **Public Hostname**:
   - Subdomain: `dev`
   - Domain: chọn `<domain>`
   - Type: `HTTP`
   - URL: `app:3000`
4. Bấm **Save tunnel**.

### 3.3 Tunnel cho main
Làm giống 3.2 nhưng:
- Tên tunnel: `mt-main`
- Token lưu lại là **TOKEN_MAIN**
- Public Hostname: Subdomain **để trống** (dùng domain gốc) hoặc `www`, Type `HTTP`, URL `app:3000`.

> URL luôn là `app:3000` cho cả hai: mỗi tunnel chạy trong mạng Docker riêng của môi trường mình, nên không bị lẫn.

---

## Bước 4: Điền cấu hình `.env`

Lấy giá trị Supabase ở 🌐 **Vercel** → Project → **Settings → Environment Variables**, copy y nguyên. Hoặc lấy ở Supabase → **Project Settings → API**.

### 4.1 dev
🖥️ VPS:
```bash
nano /opt/music-together-dev/.env
```
Sửa cho giống mẫu dưới (giữ nguyên các dòng khác):
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-dev>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<key-dev>
NEXT_PUBLIC_APP_MODE=dev
PROXY=tunnel
CLOUDFLARE_TUNNEL_TOKEN=<TOKEN_DEV>
APP_PORT=3001
```
Lưu: bấm `Ctrl + O`, Enter. Thoát: `Ctrl + X`.

### 4.2 main
🖥️ VPS:
```bash
nano /opt/music-together-main/.env
```
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-main>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<key-main>
NEXT_PUBLIC_APP_MODE=prod
PROXY=tunnel
CLOUDFLARE_TUNNEL_TOKEN=<TOKEN_MAIN>
APP_PORT=3000
```
Lưu và thoát như trên.

Kiểm tra đã điền đủ chưa (lệnh này không in giá trị bí mật ra màn hình):
🖥️ VPS:
```bash
for e in dev main; do echo "== $e"; grep -E '^(NEXT_PUBLIC_SUPABASE_URL|CLOUDFLARE_TUNNEL_TOKEN|APP_PORT)=' /opt/music-together-$e/.env | sed 's/=\(.\{12\}\).*/=\1…/'; done
```

---

## Bước 5: Deploy lần đầu (bằng tay)

🖥️ VPS:
```bash
su - deploy -c "/opt/music-together-dev/scripts/vps/deploy.sh dev"
```
Lần đầu mất khoảng 5–10 phút vì phải build. Thành công sẽ in: `deployed dev @ <commit> on :3001`.

Nếu đã làm bước 0.2 (merge vào main):
```bash
su - deploy -c "/opt/music-together-main/scripts/vps/deploy.sh main"
```
Thành công sẽ in: `deployed main @ <commit> on :3000`.

Kiểm tra:
🖥️ VPS:
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sI http://127.0.0.1:3001 | head -1
curl -sI http://127.0.0.1:3000 | head -1
```
- Phải thấy 4 container: `music-together-dev-app-1`, `music-together-dev-cloudflared-1`, `music-together-main-app-1`, `music-together-main-cloudflared-1`, tất cả đều `Up`.
- Hai lệnh `curl` phải trả về `HTTP/1.1 200` (hoặc 307/308).

🌐 Web: mở `https://dev.<domain>` và `https://<domain>`.

---

## Bước 6: Bật CI/CD trên GitHub

### 6.1 Thêm secrets
🌐 Web: vào https://github.com/AleamZ/Music-Together/settings/secrets/actions, bấm **New repository secret** 4 lần:

| Name | Secret |
|---|---|
| `VPS_HOST` | `vn-hn.cloudcode.io.vn` |
| `VPS_PORT` | `30359` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | toàn bộ khóa ở Bước 2 (từ `-----BEGIN` đến `-----END ... KEY-----`) |

### 6.2 Chạy thử
🌐 Web: vào tab **Actions** → chọn **Deploy VPS** (cột trái) → **Run workflow** → chọn `dev` → **Run workflow**.
- Job `check` (typecheck + test) xanh, rồi job `deploy` xanh, là CI/CD đã chạy.
- Từ giờ **push hoặc merge vào `dev`** sẽ tự deploy `dev.<domain>`, còn **vào `main`** sẽ tự deploy `<domain>`.

### 6.3 (Nên làm) Bắt duyệt trước khi deploy production
🌐 Web: vào Settings → **Environments** → `main` → tick **Required reviewers** → chọn chính bạn → **Save**. Khi đó mỗi lần deploy main phải có người bấm **Approve**.

---

## Bước 7: Bảo mật SSH (nên làm)

💻 Máy bạn, tạo khóa cá nhân (Enter liên tục để nhận mặc định):
```bash
ssh-keygen -t ed25519
```
Chép khóa lên VPS:
- **Windows PowerShell:**
  ```powershell
  type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@vn-hn.cloudcode.io.vn -p 30359 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  ```
- **Mac/Linux:**
  ```bash
  ssh-copy-id -p 30359 root@vn-hn.cloudcode.io.vn
  ```

Thử đăng nhập lại. Lần này **không được hỏi mật khẩu**:
💻 Máy bạn:
```bash
ssh root@vn-hn.cloudcode.io.vn -p 30359
```
Nếu vào được mà không hỏi mật khẩu thì tắt hẳn đăng nhập bằng mật khẩu:
🖥️ VPS:
```bash
curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
```
(Script thấy đã có khóa sẽ tự đặt `PasswordAuthentication no`.)

---

## Lệnh vận hành hằng ngày

| Việc | 🖥️ Lệnh |
|---|---|
| Xem log dev (thoát: `Ctrl+C`) | `docker compose -p music-together-dev -f /opt/music-together-dev/deploy/docker-compose.yml logs -f --tail=100 app` |
| Xem log main | `docker compose -p music-together-main -f /opt/music-together-main/deploy/docker-compose.yml logs -f --tail=100 app` |
| Deploy lại dev bằng tay | `su - deploy -c "/opt/music-together-dev/scripts/vps/deploy.sh dev"` |
| Deploy lại main bằng tay | `su - deploy -c "/opt/music-together-main/scripts/vps/deploy.sh main"` |
| Khởi động lại dev | `docker compose -p music-together-dev -f /opt/music-together-dev/deploy/docker-compose.yml --env-file /opt/music-together-dev/.env --profile tunnel restart` |
| Dừng dev | `docker compose -p music-together-dev -f /opt/music-together-dev/deploy/docker-compose.yml down` |
| Quay main về một commit cũ | `cd /opt/music-together-main && git reset --hard <commit> && docker compose -p music-together-main -f deploy/docker-compose.yml --env-file .env --profile tunnel up -d --build` |
| Dung lượng ổ / RAM | `df -h /` và `free -h` |
| Dọn image cũ | `docker system prune -af` |

---

## Phụ lục A: SSH báo `Connection reset`

🖥️ Mở **Console** trên panel, đăng nhập root, rồi chạy:
```bash
systemctl status ssh --no-pager | head -5
ss -tlnp | grep -E 'ssh|:22'
```
- Nếu SSH **không chạy**:
  ```bash
  apt-get update && apt-get install -y openssh-server && systemctl enable --now ssh
  ```
- Nếu SSH chạy ở `:22` nhưng panel chuyển cổng `30359` vào một cổng khác 22: xem mục **Port forwarding** trên panel. Nếu nó trỏ vào `30359` thì chạy:
  ```bash
  echo "Port 22" >> /etc/ssh/sshd_config && echo "Port 30359" >> /etc/ssh/sshd_config && systemctl restart ssh
  ```
- Nếu bị chặn do nhập sai quá nhiều lần:
  ```bash
  fail2ban-client unban --all 2>/dev/null || true
  ```
- Thử lại từ mạng khác, ví dụ phát 4G từ điện thoại.

## Phụ lục B: Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `curl ... setup.sh` báo **404** | Code chưa có trên nhánh `dev`. Merge PR vào `dev` rồi chạy lại |
| `deploy.sh main` báo `no checkout` hoặc không có file | `main` chưa được merge từ `dev` (Bước 0.2). Merge xong chạy lại `setup.sh` |
| Build bị kill / hết RAM | Tạo swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab` |
| Domain báo lỗi **1033 / 502** | Container `cloudflared` chưa chạy, hoặc token sai. Kiểm tra: `docker logs music-together-dev-cloudflared-1 --tail=30` |
| `deployed` nhưng domain vẫn trả trang cũ | Xoá cache Cloudflare: Caching → **Purge Everything** |
| GitHub Actions `deploy` báo lỗi SSH | Kiểm tra 4 secret. SSH từ ngoài phải hoạt động (Phụ lục A) |
