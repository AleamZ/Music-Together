# Tự host trên VPS: 2 môi trường `dev` và `main` (chạy song song với Vercel)

| Nhánh | Thư mục trên VPS | Cổng nội bộ | Domain (ví dụ) | Chế độ |
|---|---|---|---|---|
| `dev` | `/opt/music-together-dev` | 3001 | `dev.domain.com` | `NEXT_PUBLIC_APP_MODE=dev` |
| `main` | `/opt/music-together-main` | 3000 | `domain.com` | `NEXT_PUBLIC_APP_MODE=prod` |

Mỗi môi trường có code, file `.env`, container (project `music-together-<nhánh>`), cổng và Cloudflare Tunnel riêng. Khi push lên `dev`, CI chỉ deploy môi trường dev; push lên `main` thì chỉ deploy môi trường main.

```
push dev  ─▶ Actions: check ─▶ SSH ─▶ deploy.sh dev  ─▶ /opt/music-together-dev  ─▶ tunnel dev  ─▶ dev.domain.com
push main ─▶ Actions: check ─▶ SSH ─▶ deploy.sh main ─▶ /opt/music-together-main ─▶ tunnel main ─▶ domain.com
```

> ⚠️ Nhánh `main` chỉ deploy được khi nó đã có `scripts/vps/` và `deploy/`, tức là sau khi `dev` đã được merge vào `main` ít nhất một lần.

## 1. Cài đặt VPS (một lần, dùng user root)
```bash
curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
```
Script sẽ tạo `/opt/music-together-dev` và `/opt/music-together-main`, mỗi thư mục có sẵn một file `.env`. Cuối cùng nó in ra **VPS_SSH_KEY**; hãy lưu lại.

## 2. Tạo 2 Cloudflare Tunnel (mỗi môi trường một cái)
Cloudflare → Zero Trust → Networks → Tunnels → Create tunnel (Cloudflared):
- Tunnel `mt-dev`: Public hostname `dev.domain.com` → Service `HTTP` → URL `app:3000`. Copy token.
- Tunnel `mt-main`: Public hostname `domain.com` → Service `HTTP` → URL `app:3000`. Copy token.

URL luôn là `app:3000` vì mỗi tunnel chạy trong mạng riêng của môi trường đó.

## 3. Điền 2 file `.env`
```bash
nano /opt/music-together-dev/.env     # Supabase của dev + CLOUDFLARE_TUNNEL_TOKEN của tunnel mt-dev
nano /opt/music-together-main/.env    # Supabase của main + CLOUDFLARE_TUNNEL_TOKEN của tunnel mt-main
```
Nếu dev và main dùng chung một project Supabase thì điền cùng giá trị. Tách riêng thì an toàn hơn cho dữ liệu thật.

## 4. Deploy lần đầu bằng tay
```bash
su - deploy -c "/opt/music-together-dev/scripts/vps/deploy.sh dev"
su - deploy -c "/opt/music-together-main/scripts/vps/deploy.sh main"
docker ps     # mỗi môi trường có một container app và một container cloudflared
```

## 5. CI/CD trên GitHub
Vào Settings → Secrets and variables → Actions → New repository secret:

| Secret | Giá trị |
|---|---|
| `VPS_HOST` | `vn-hn.cloudcode.io.vn` |
| `VPS_PORT` | cổng SSH của VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | khóa riêng mà setup.sh in ra |

Workflow **Deploy VPS** tự chạy khi có push lên `dev` hoặc `main`. Muốn chạy tay thì vào Actions → Deploy VPS → Run workflow → chọn `dev` hoặc `main`. GitHub sẽ tạo 2 Environment `dev` và `main`. Bạn có thể bật **Required reviewers** cho `main` (Settings → Environments → main) để việc deploy production phải được duyệt.

## Vận hành
| Việc | Lệnh |
|---|---|
| Log dev / main | `docker compose -p music-together-dev -f /opt/music-together-dev/deploy/docker-compose.yml logs -f app` (đổi `dev` thành `main`) |
| Deploy lại | `su - deploy -c "/opt/music-together-<nhánh>/scripts/vps/deploy.sh <nhánh>"` |
| Dừng một môi trường | `docker compose -p music-together-dev -f /opt/music-together-dev/deploy/docker-compose.yml down` |

Lint chưa được chặn trong CI vì repo còn lỗi lint cũ nằm ngoài phần game. Khi sửa hết thì thêm `pnpm lint` vào job `check`.
