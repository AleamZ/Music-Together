-- 0122 — Tin tức: ruộng chín trong một ngày (0120), rừng tràm hoàn thiện (0121). Data only; re-runnable (skips a title
-- already posted). Run after 0121. Not pinned: the pinned post stays as the admins left it.

insert into public.news_posts (title, emoji, body, pinned, created_at)
select v.title, v.emoji, v.body, v.pinned, v.at
from (values
('Ruộng chín trong một ngày, rừng tràm đủ nghề', '🌾', $b$
Chào cả làng! Hai việc bà con hỏi nhiều nhất đã xong.

## Trồng trọt: một vụ không quá một ngày 🌾
Trước đây một vụ mất 2–4 ngày, thuê ruộng 4 ngày chỉ gặt được một lần. Giờ **mọi cây đều chín trong vòng 24 giờ**:

- Khoai lang: 48 giờ → **8 giờ**
- Lúa ngắn ngày: ~52 giờ → **~12 giờ**
- Bắp: 60 giờ → **15 giờ**
- Nếp: ~58 giờ → **~16 giờ**
- Lúa thơm: ~66 giờ → **~20 giờ**
- Ớt (ươm + 3 lứa): 80 giờ → **24 giờ**

- **Thuê ruộng 10.000 xu được trọn 4 ngày**: gặt xong cứ làm vụ khác trên thửa đó (trước đây gặt xong là trả ruộng). Hết hạn thuê thì cây còn trên thửa sẽ mất — bảng thửa ruộng nhắc trước khi bạn gieo một vụ không kịp chín.
- Mỗi vụ ngắn lại nên **sản lượng mỗi vụ cũng nhỏ lại** (khoai 43 kg, lúa ngắn ngày 27, bắp 49, nếp 27, lúa thơm 23, ớt 23 kg mỗi thửa), nhưng một ngày làm được nhiều vụ: **tính theo ngày, ruộng lời hơn trước một chút**. Giá lúa, hoa màu, giống, phân, thuốc, tiền thuê ruộng giữ nguyên.
- Các mốc bón phân, phơi ruộng, sâu bệnh co lại theo vụ — xem **Sổ tay nhà nông** (mốc giờ tính tới 15 phút). Thời gian được chín quá (8–12 giờ) và nước tự rút 12 giờ một mức vẫn như cũ, nên bận một buổi vẫn kịp gặt.
- **Ruộng đang trồng** được tính tiếp theo giờ mới: cây giữ đúng giai đoạn, phân đã bón đúng lúc vẫn tính đúng lúc, thời gian còn lại rút ngắn theo vụ mới.

## Rừng tràm: Thợ săn và Tiều phu 🪓🏹
- **Đốn cây:** đứng sát cây tràm, bấm **🪓 Đốn (phím G)**, rồi Space đúng nhịp; cây chưa đổ thì bấm **Chặt tiếp**. Gốc cây vừa đốn không còn che mất cây đứng sau.
- **Cung, nồi chảo có tác dụng thật:** cung tốt hơn **săn trúng thêm 5–10 %**, nồi chảo tốt hơn **món thêm 4–8 điểm**. Mua, sửa ở **🪵 Sạp thợ săn** (Bãi đất trống, nút "Gỗ · món · đồ nghề").
- Nút **🏹 Săn** báo trước khi bạn chưa có cung, và cho biết cung đang dùng còn bao nhiêu độ bền.
- **Bán hết** gỗ, món ăn, đồ săn bao nhiêu cũng được (trước đây quá 999 món sẽ bị từ chối).
- Bán gỗ, bán món ăn giờ cũng **tính kinh nghiệm "làm ăn"** như bán cá, bán quặng.
- Chọn nghề Tiều phu / Thợ săn / Đầu bếp: bảng Nghề nghiệp (phím 3) có **hướng dẫn cách làm** và báo khi bạn **nhận đồ nghề tập sự**.
- Nhiệm vụ ngày mới: **"Tiều phu chăm chỉ"** (đốn 10 khúc gỗ) và **"Đi săn"** (săn 2 con).

Chúc cả làng mùa màng bội thu, đi rừng gặp may!
$b$, false, now())
) as v(title, emoji, body, pinned, at)
where not exists (select 1 from public.news_posts p where p.title = v.title);
