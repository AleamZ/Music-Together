-- 0107 — Tin tức: Kinh tế v2 (docs/superpowers/specs/2026-09-30-economy-v2-design.md). Data only; re-runnable (skips a
-- title already posted). Run after 0106.

insert into public.news_posts (title, emoji, body, pinned, created_at)
select v.title, v.emoji, v.body, v.pinned, v.at
from (values
('Kinh tế v2: giá cả làng được cân lại', '⚖️', $b$
Chào cả làng! Làng mình lớn nhanh quá nên **giá cả bị lệch**: có việc kiếm vài chục nghìn xu một giờ, có việc chỉ vài trăm, và phòng càng giàu thì cá càng đắt. Để làng chơi được lâu dài, mọi thứ giờ về **một thang giá chung**. **Xu bạn đang có vẫn giữ nguyên.**

## Thương lái 🧺
Mỗi ngày, thương lái mua **đủ giá 20.000 xu hàng đầu tiên** của bạn (cá, cua ốc, chuột, quặng, gỗ, đồ rừng, món ăn). Sau đó trả **50 %** tới 40.000 xu, rồi **20 %**. Lúa và hoa màu không tính. Quầy bán có dòng "Thương lái hôm nay" để bạn biết mình đang ở đâu.

## Câu cá 🎣
- Giá cá **không còn nhân theo độ giàu của phòng**: cả server chung một hệ số (×1,00), vẫn lên xuống theo mùa mỗi 3 giờ.
- Giá từng loài được tính lại: cần xịn và câu sông vẫn lời hơn, nhưng không còn chênh gấp mấy chục lần.
- Câu một lần **đói, khát ít hơn nhiều** (ăn uống rẻ hơn hẳn cho người mới). Mồi rẻ: tôm 1, trùn huyết 3, mồi vàng 6 xu; lưới 50 / 120 xu.
- **Ghe 25.000 xu**, sông hoang cần cấp 3 như Sông Cái.
- **Bản đồ kho báu** ít rơi hơn, rương 150–800 xu (hiếm khi 3.000), mỗi ngày đào tối đa **3 rương**.
- Vựa Chợ Lớn trả **+10 %** (trước +20 %).

## Nông trại 🌾
- Mỗi người **tối đa 2 thửa đang trồng và 1 thửa riêng trên toàn server** (không còn nhân theo số sảnh). Ai đang giữ nhiều hơn vẫn giữ, chỉ không nhận thêm.
- Máy chế biến **50.000 xu**, hàng chế biến ≈ 1,15 lần giá lúa, hoa màu; thưởng phân loại +1 / +2 %.
- Mua bán ruộng giữa người chơi: giá **400.000–2.400.000**, cho thuê lại tối đa **50.000**; **5 % bị đốt**.
- Thu hoạch xong một mùa giờ **tính cho nhiệm vụ "Nghề mới"**.

## Mỏ, rừng, bếp ⛏️🪓🍳
- Quặng giá chia 4, **200 lượt đào/ngày**. Gỗ giá chia 3, **30 khúc đủ giá, tối đa 150 khúc/ngày**. Săn **40 con/ngày**, chợ đêm +10 %.
- Nấu ăn: món chỉ tốn phí không còn lời (để ăn lấy buff, thể lực); món có nguyên liệu lời khoảng 30 %. Nấu tốn **2 thể lực**.
- Thuốc: đói 60, khát 25, canh 120 xu; hái thảo dược tốn 1 thể lực. Đổi nghề 2.000, tẩy điểm 1.000.
- Chế tạo, nâng cấp, nấu ăn giờ **tính cho nhiệm vụ "Thử chế tạo"**.

## Phần thưởng ⭐
- Lên cấp thưởng **20 × cấp** (cấp chia hết cho 5: 60 × cấp). Cấp và thành tựu đã nhận vẫn giữ.
- Boss đột kích và boss mưa, tuyết: **mỗi ngày nhận thưởng 2 lần** (vẫn được EXP). Hầm ngục: phí 100, thưởng 50 + 250 × số người × phần sát thương, **3 lần/ngày** — đi nhóm giờ không thiệt.
- Nhiệm vụ cả làng: **3.000 xu chia theo công sức** (góp ít nhất 1 %, tối đa 300 xu/người).
- Sóc nhặt tối đa **150 xu/ngày** và chỉ khi bạn đang chơi. Đấu thú với NPC: 5 trận có thưởng/ngày.
- Thắng võ chỉ tính cho thành tựu khi **có đặt cược hoặc đấu xếp hạng**. Dịch chuyển, xe ôm: **50 xu**.

## Tiêu xu 🏠
- Buff đồ ăn nhẹ hơn (cá hiếm +2–6 %, thể lực +10–30 %), ngủ ngon hồi thể lực ×1,2. Nhà nghỉ 300 xu/đêm, 6.000 xu/tháng.
- Đổi cá lấy món cá ở quán: vẫn giảm 20–80 %, nhưng **bớt tối đa gấp 3 giá con cá**.
- Phí giữ đất nhà 1.500 xu/30 ngày, thuê căn hộ 2.000 xu/30 ngày.

## Giữa người chơi 🤝
- Giao dịch: **5 % số xu trao tay bị đốt**; chỉ tài khoản **từ 3 ngày tuổi và cấp 5** mới nhận xu, tối đa **50.000 xu/ngày**.
- Tặng đồ thời trang: chỉ cho người cùng phòng, **5 món/ngày**. Thuê sạp 500 xu/ngày.
- Thương nhân: nghề giờ **giảm phí chợ** (tối thiểu còn 2 %) thay vì cộng thêm xu.
- Xì dách: **không ai bị âm xu nữa** — thua nhiều nhất bằng số xu đã giữ trên bàn.

Nếu thấy chỗ nào còn lệch, cứ gửi góp ý nhé — ban quản trị sẽ theo dõi và chỉnh dần từng chút.
$b$, true, now())
) as v(title, emoji, body, pinned, at)
where not exists (select 1 from public.news_posts p where p.title = v.title);

-- the older pinned posts step aside for this one
update public.news_posts set pinned = false
 where pinned and title <> 'Kinh tế v2: giá cả làng được cân lại';
