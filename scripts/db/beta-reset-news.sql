-- scripts/db/beta-reset-news.sql — the Bản tin post announcing the end-of-Beta reset (0118). NOT a migration: run it
-- by hand ONCE, right AFTER admin_beta_reset succeeded (psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db/beta-reset-news.sql).
-- Re-runnable: it inserts nothing when the post already exists, and nothing at all before the reset was applied.
insert into public.news_posts (title, emoji, body, pinned, author_id)
select 'Kết thúc Beta — thế giới làm mới & quà Kỷ niệm Beta', '🎉',
'Cảm ơn tất cả mọi người đã cùng Music Together đi qua thời Beta!

Hôm nay giai đoạn Beta khép lại và thế giới được làm mới để mọi người bắt đầu công bằng:
• GIỮ LẠI: tài khoản của bạn (tên đăng nhập, mật khẩu / email), lịch sử chat.
• LÀM MỚI: xu, túi đồ, cần câu, cá, tủ lạnh, bể cá, ruộng, nhà, căn hộ, nội thất, quần áo và ngoại hình, cấp độ, nghề, thành tựu, nhiệm vụ, thú cưng, xe, chợ, hòm thư cũ, thống kê.

QUÀ KỶ NIỆM BETA (đã gửi vào 📬 Hòm thư — nhớ bấm Nhận, thư giữ 90 ngày):
• Xu khởi nghiệp theo bậc tài sản lúc chốt sổ: 2.000 / 5.000 / 8.000 / 12.000 / 16.000 / 20.000 xu (dưới 10k / từ 10k / 50k / 100k / 200k / 500k).
• Bộ đồ Kỷ niệm Beta (màu kem viền vàng, có huy hiệu β) theo bậc, cộng dồn:
  – từ 10.000: Dép kỷ niệm Beta
  – từ 50.000: + Nón kỷ niệm Beta
  – từ 100.000: + Quần kỷ niệm Beta
  – từ 200.000: + Áo kỷ niệm Beta
  – từ 500.000: + Set đồ kỷ niệm Beta
  Đồ Kỷ niệm Beta là độc quyền: không bán trong cửa hàng, không bán lại, không tặng, không giao dịch, không đăng chợ.
• 20 mồi tép + 5 túi thính cám gạo.

Đã có sẵn trong túi (không cần nhận):
• Cần tre đã lắp lưỡi đơn nhỏ, dây cước 0.2 và phao lông gà.
• Linh vật Kỷ niệm Beta (nội thất, đặt trong nhà / căn hộ).
• Danh hiệu “Người khai hoang Beta” và khung tên β cạnh tên bạn.
• 7 ngày tăng tốc: +50% kinh nghiệm và +25% hạn mức thương lái trả đủ giá (đồng hồ đếm ngược trên HUD).

Tài sản được tính = xu trong ví + giá trị đồ đang có (đồ theo giá cửa hàng, cá theo giá, ruộng, nhà, cần + linh kiện, quần áo, thú cưng, xe…). Tài khoản root và tài khoản bị khoá không nhận quà.

Hẹn gặp lại mọi người ở mùa chính thức! 🎶🎣',
false, (select applied_by from public.beta_state where id = 1)
where exists (select 1 from public.beta_state where id = 1 and applied_at is not null)
  and not exists (select 1 from public.news_posts where title = 'Kết thúc Beta — thế giới làm mới & quà Kỷ niệm Beta');
