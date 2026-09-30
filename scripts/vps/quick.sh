#!/usr/bin/env bash
# The one-command VPS install (deploy/HUONG-DAN-VPS.md): run as root, answer a few questions, done.
#   bash <(curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/quick.sh)
# It runs setup.sh (Docker, the deploy user, /opt/music-together-dev and -main), asks for the Supabase URL/key and the
# Cloudflare Tunnel tokens (blank = later), writes both .env files, deploys dev (and main when that branch has the
# scripts), and prints what GitHub needs. Safe to run again: blank answers keep what is already set.
set -euo pipefail
RAW="https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ask() { local q="$1" def="${2:-}" a; read -r -p "$q${def:+ [$def]}: " a </dev/tty || true; echo "${a:-$def}"; }
setv() {                                   # setv FILE KEY VALUE (only when VALUE is not empty)
  local f="$1" k="$2" v="$3"
  [ -n "$v" ] || return 0
  if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else echo "$k=$v" >> "$f"; fi
}

[ "$(id -u)" = 0 ] || { echo "Chạy bằng root nhé (đăng nhập root rồi chạy lại)."; exit 1; }

say "1/4  Cài Docker, user deploy, tải code (2–5 phút)…"
curl -fsSL "$RAW/setup.sh" | bash >/tmp/mt-setup.log 2>&1 || { tail -30 /tmp/mt-setup.log; exit 1; }
echo "   xong."

say "2/4  Supabase (lấy ở Vercel → Settings → Environment Variables). Enter để bỏ qua."
URL=$(ask "NEXT_PUBLIC_SUPABASE_URL")
KEY=$(ask "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
SAME=$(ask "Bản main dùng CHUNG Supabase này? (y/n)" "y")
if [ "$SAME" = y ] || [ "$SAME" = Y ]; then URL_M="$URL"; KEY_M="$KEY"; else
  URL_M=$(ask "Supabase URL cho main"); KEY_M=$(ask "Supabase key cho main"); fi

say "3/4  Cloudflare Tunnel token (Zero Trust → Networks → Tunnels → tunnel → chuỗi eyJ…). Chưa có thì Enter."
TD=$(ask "Token tunnel DEV  (dev.muziktogether.io.vn)")
TM=$(ask "Token tunnel MAIN (muziktogether.io.vn)")

for e in dev main; do
  f="/opt/music-together-$e/.env"
  if [ "$e" = dev ]; then setv "$f" NEXT_PUBLIC_SUPABASE_URL "$URL"; setv "$f" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$KEY"; setv "$f" CLOUDFLARE_TUNNEL_TOKEN "$TD"
  else setv "$f" NEXT_PUBLIC_SUPABASE_URL "$URL_M"; setv "$f" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$KEY_M"; setv "$f" CLOUDFLARE_TUNNEL_TOKEN "$TM"; fi
done

say "4/4  Build và chạy (lần đầu 5–10 phút mỗi bản)…"
for e in dev main; do
  d="/opt/music-together-$e"
  if ! grep -q '^NEXT_PUBLIC_SUPABASE_URL=.\+' "$d/.env"; then echo "   $e: chưa có Supabase → bỏ qua (chạy lại script khi có)"; continue; fi
  if [ ! -x "$d/scripts/vps/deploy.sh" ]; then echo "   $e: nhánh $e chưa có script deploy (cần merge dev → $e) → bỏ qua"; continue; fi
  if su - deploy -c "$d/scripts/vps/deploy.sh $e"; then echo "   ✅ $e đang chạy"; else echo "   ❌ $e lỗi, xem log ở trên"; fi
done

say "Trạng thái"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep music-together || echo "(chưa có container nào)"
for e in dev main; do
  grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.\+' "/opt/music-together-$e/.env" || echo "⚠️  $e chưa có token tunnel → chưa lên domain (chạy lại script khi có token)"
done

say "Để bật tự động deploy, vào GitHub → Settings → Secrets and variables → Actions, thêm 4 secret:"
echo "   VPS_HOST    = vn-hn.cloudcode.io.vn"
echo "   VPS_PORT    = (cổng SSH của VPS, vd 30359)"
echo "   VPS_USER    = deploy"
echo "   VPS_SSH_KEY = nội dung dưới đây (cả dòng BEGIN/END):"
echo "--------------------------------------------------------------"
cat /home/deploy/.ssh/ci_deploy
echo "--------------------------------------------------------------"
