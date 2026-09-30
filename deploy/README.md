# Tự host trên VPS (chạy song song với Vercel)

Vercel vẫn deploy như cũ. VPS là bản thứ hai, dùng domain riêng. Mỗi lần push lên `dev`, GitHub Actions chạy typecheck và unit test. Qua hết thì nó SSH vào VPS, build image Docker ngay trên server rồi khởi động lại.

```
push dev ─▶ GitHub Actions: check (tsc, test) ─▶ SSH ─▶ VPS: scripts/vps/deploy.sh
                                                         git pull → docker compose build → up
domain ─▶ Cloudflare Tunnel (hoặc Caddy 80/443) ─▶ app:3000 (Next.js standalone)
```

## 1. Cài đặt server (làm một lần)

SSH vào VPS bằng tài khoản root, rồi chạy:

```bash
curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
```

Script này làm các việc sau:
- cài Docker và git;
- tạo user `deploy`;
- clone repo vào `/opt/music-together` và tạo file `.env` để bạn điền;
- in ra **khóa SSH riêng cho GitHub Actions**.

## 2. Điền `/opt/music-together/.env`

```
NEXT_PUBLIC_SUPABASE_URL=...            # giống trên Vercel
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_APP_MODE=prod
PROXY=tunnel                            # tunnel (NAT VPS) hoặc caddy (nếu có cổng 80/443)
CLOUDFLARE_TUNNEL_TOKEN=...             # khi PROXY=tunnel
DOMAIN=game.example.com                 # khi PROXY=caddy
```

## 3. Gắn domain

**NAT VPS (không có cổng 80/443): dùng Cloudflare Tunnel.**
1. Đưa domain lên Cloudflare (đổi nameserver).
2. Vào Cloudflare Zero Trust → Networks → Tunnels → Create tunnel (loại cloudflared) → copy **token** vào `CLOUDFLARE_TUNNEL_TOKEN`.
3. Trong tunnel đó, thêm **Public hostname**: domain của bạn → Service `HTTP` → URL `app:3000`.
4. Cloudflare tự cấp HTTPS. Không cần mở thêm cổng nào trên VPS.

**VPS có cổng 80/443 trỏ vào:**
1. Đặt `PROXY=caddy` và `DOMAIN=...`.
2. Trỏ bản ghi A của domain về IP VPS.
3. Caddy tự lấy chứng chỉ Let's Encrypt.

## 4. GitHub Actions

Vào repo → Settings → Secrets and variables → Actions → New repository secret, thêm:

| Secret | Giá trị |
|---|---|
| `VPS_HOST` | host SSH của VPS (vd. `vn-hn.cloudcode.io.vn`) |
| `VPS_PORT` | cổng SSH (vd. `30359`) |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | khóa riêng mà script in ra (toàn bộ, kể cả dòng BEGIN/END) |

Tùy chọn: thêm Variable `DEPLOY_BRANCH` nếu muốn deploy nhánh khác, mặc định là `dev`.

Để deploy lần đầu: Actions → **Deploy VPS** → Run workflow. Hoặc chạy tay trên server:
`/opt/music-together/scripts/vps/deploy.sh dev`

## Vận hành

- Xem log: `cd /opt/music-together && docker compose -f deploy/docker-compose.yml logs -f app`
- Quay về bản trước: `git -C /opt/music-together reset --hard <commit> && docker compose -f deploy/docker-compose.yml --env-file .env --profile tunnel up -d --build`
- Bảo mật: sau khi đã thêm khóa SSH của bạn vào `/root/.ssh/authorized_keys`, chạy lại `setup.sh` để **tắt đăng nhập bằng mật khẩu**.

Lint chưa được chặn trong CI vì repo còn 22 lỗi lint cũ nằm ngoài phần game. Khi sửa hết thì thêm `pnpm lint` vào job `check`.
