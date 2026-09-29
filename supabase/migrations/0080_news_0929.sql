-- 0080 — Tin tức cập nhật 29/9/2026 (owner asked for a news set). Data only; re-runnable (skips a title already posted).

insert into public.news_posts (title, emoji, body, pinned, created_at)
select v.title, v.emoji, v.body, v.pinned, v.at
from (values
('Cập nhật lớn 29/9: Làng mở rộng!', '🎉', $b$
Chào cả làng! Bản cập nhật hôm nay là bản **lớn nhất từ trước tới giờ**. Tóm tắt nhanh:

- ⭐ **Cấp độ, thành tựu, danh hiệu, bảng xếp hạng, Fishdex** — mở bảng **Hồ sơ** bằng nút ⭐ trên HUD.
- 📜 **Nhiệm vụ** ngày, tuần, nhiệm vụ chung cả làng, nhiệm vụ khám phá và **bác Ba Làng** ở Sảnh.
- 🎁 **Quà đăng nhập 7 ngày** liên tiếp.
- ⛏️ **Mỏ đá** (từ cấp 5), **nấu thuốc**, **nâng cấp đồ** +1 → +5.
- 🏪 **Chợ người chơi**, **đấu giá**, **giao dịch** trực tiếp và **thuê sạp** ở Chợ Lớn.
- 🥚 **Trại thú**: ấp trứng thú cưng, nuôi lên cấp, tiến hoá, **đấu thú** và **cá chiến**; **bể cá** trong nhà.
- ❄️ **Tuyết**, thú hoang, **party**, **boss thế giới**, boss đêm và **dungeon**.
- 🚣 **Ghe câu nước sâu**, **thi câu**, **bản đồ kho báu**, **máy nông trại**.
- 🛠️ **Nghề nghiệp + cây kỹ năng**, **thanh thể lực** và **buff đồ ăn**.
- 🥋 Võ đài: **nhân vật chibi**, ra chiêu **không cần phím chéo**.
- 📷 **Chụp ảnh** và **album**.

Xem các tin bên dưới để biết chi tiết. Nếu gặp lỗi, cứ gửi góp ý nhé!
$b$, true, now()),

('Võ đài: chibi lên sàn, chiêu dễ bấm hơn', '🥋', $b$
## Ra chiêu không cần phím chéo
Bàn phím chỉ có ↑↓←→ nên giờ các chiêu bấm thẳng:

- **↓ → + đấm** (S rồi D, rồi U/I) — thay cho ↓↘→
- **↓ ← + nút** — thay cho ↓↙←
- **→ ↓ + đấm** — chiêu hất lên (thay cho →↓↘)
- **↓ → ↓ → + nút** — tuyệt chiêu

→ luôn là hướng **về phía đối thủ**. Cách bấm cũ có phím chéo vẫn dùng được.

## Võ sĩ chibi
Võ sĩ giờ là **chibi** giống nhân vật của bạn ngoài làng: đúng mặt, tóc, màu da, mặc võ phục theo môn và đai.

## Tầm đòn mới
Vùng trúng đòn được đo lại theo hình chibi: **tầm đấm, đá ngắn hơn** — phải áp sát mới trúng, lùi lại có thể né đòn chậm. Sát thương và tốc độ ra đòn giữ nguyên.
$b$, false, now() + interval '1 second'),

('Cấp độ, nhiệm vụ và quà mỗi ngày', '⭐', $b$
## Cấp độ & thành tựu
Câu cá, bán hàng, thắng trận, làm nhiệm vụ… đều cho **EXP**. Lên cấp có **thưởng xu**. Hoàn thành **thành tựu** để mở **danh hiệu** hiện dưới tên: `Lv12 Tên «Danh hiệu»`.

Một số khu cần cấp để vào: **Chợ Lớn cấp 2**, **Khu nhà cấp 4**, **Mỏ đá cấp 5**, **Bãi đất trống cấp 6**.

**Điểm dịch chuyển**: tới một khu là mở điểm của khu đó, sau đó dịch chuyển nhanh với **20 xu**.

## Nhiệm vụ (nút 📜)
- **Nhiệm vụ ngày** (4 cái, làm mới lúc 0h) và **nhiệm vụ tuần** (3 cái, làm mới thứ Hai).
- **Cả làng**: một mục tiêu chung, ai góp sức cũng nhận thưởng khi đầy thanh.
- **Bác Ba Làng** ở Sảnh giao chuỗi nhiệm vụ.
- **Khám phá**: lần đầu tới một khu mới cũng có thưởng.

## Quà đăng nhập
Vào game mỗi ngày: **20 → 30 → 40 → 50 → 60 → 80 → 150 xu** cho chuỗi 7 ngày liên tiếp.

## Bảng xếp hạng & Fishdex
Trong **Hồ sơ**: cấp cao nhất, giàu nhất, câu nhiều nhất, cá to nhất, nông dân giỏi nhất, võ sĩ thắng nhiều nhất; Fishdex đủ bộ có thưởng.
$b$, false, now() + interval '2 seconds'),

('Mỏ đá, nấu thuốc và nâng cấp đồ', '⛏️', $b$
## Mỏ đá (từ cấp 5)
Đi qua **khe tường phía đông Bãi đất trống**. Mua **cuốc** ở chỗ **chú Tám** (4 loại, có độ bền), canh nhịp gõ để đào **đá, than, đồng, sắt, vàng, kim cương** và cả **tinh thể lửa** cực hiếm. Quặng bán lại cho chú Tám.

## Nấu thuốc
**Bà Sáu** có nồi thuốc với **7 công thức** từ thảo dược trong mỏ, quặng và cá: hồi đói/khát, chữa cảm lạnh, sốc nhiệt, hoặc **buff may mắn** (cá dễ lên độ hiếm) và **buff thợ mỏ**.

## Nâng cấp đồ
Cần câu, lưới, cuốc nâng được **+1 → +5** bằng xu + quặng ở đe rèn. Có tỉ lệ thất bại — càng lên cao càng khó!

## Độ hiếm
Mọi thứ giờ theo 6 bậc: **Thường · Khá · Hiếm · Sử thi · Huyền thoại · Thần thoại**.
$b$, false, now() + interval '3 seconds'),

('Chợ người chơi, đấu giá và giao dịch', '🏪', $b$
- **Chợ người chơi** (nút 🏪): tự đăng bán cá, đồ thời trang, nông sản với giá của bạn (trong khoảng 50–300% giá NPC). Có phí đăng tin, mỗi lần bán **đốt 5%**.
- **Đấu giá**: đồ hiếm lên sàn có hẹn giờ; trả giá phút chót sẽ được gia hạn thêm.
- **Giao dịch trực tiếp**: bấm **🤝 Giao dịch** trên thẻ người chơi, hai bên phải **đứng gần nhau** và cùng xác nhận.
- **Sạp thuê**: thuê sạp ở quầy đèn lồng **chú Bảy (Chợ Lớn)**, bày hàng bán cả khi bạn offline.

Thú cưng, cần câu, xe và nhà không giao dịch được.
$b$, false, now() + interval '4 seconds'),

('Trại thú, đấu thú, bể cá và nội thất mới', '🥚', $b$
- **Máy ấp trứng**: 5 độ hiếm, quả thứ 40 chắc chắn ra hàng hiếm.
- **Nuôi thú**: vuốt ve, cho ăn, chơi cùng để lên cấp (tối đa 50); thú đi theo bạn cũng được EXP. **Tiến hoá 2 lần** với màu và hào quang mới.
- **Đấu thú theo lượt**: đánh thú hoang, người huấn luyện, hoặc thách đấu người khác cùng phòng (có cược).
- **Cá chiến**: cá 3 sao trở lên có thể thành võ sĩ dưới nước!
- **Bể cá**: đặt trong nhà, thả cá câu được vào bơi; khách tới chơi xem được cá hiếm.
- **15 món nội thất mới**; nhà riêng giờ cũng **gõ cửa** xin vào được như căn hộ.
$b$, false, now() + interval '5 seconds'),

('Tuyết, thú hoang, party, boss và dungeon', '🐺', $b$
- **Tuyết** ❄️ theo thời tiết thật, thỉnh thoảng có **đợt tuyết** đặc biệt.
- **Ngày & đêm**: có thú chỉ ra ban đêm; **chợ đêm** mua đồ săn đắt hơn **30%**.
- **Thú hoang**: săn, bẫy hoặc chụp ảnh. Cẩn thận **sói, gấu ban đêm** — săn hụt có thể bị hất văng!
- **Party** tối đa 4 người, có chat nhóm và thấy nhau trên bản đồ nhỏ.
- **Boss thế giới** lúc **12:00** và **20:00**, **boss đêm** lúc **22:00**, boss mưa/tuyết, và boss do party triệu hồi. Boss rất trâu — phải đông người mới hạ được, thưởng theo công sức.
- **Dungeon** cho party ở cổng trên **Bãi đất trống**.
$b$, false, now() + interval '6 seconds'),

('Câu cá: ghe nước sâu, thi câu, kho báu, máy nông trại', '🚣', $b$
- **Ghe câu** (4.000 xu) neo ở chỗ nước sâu của ao: 6 loài cá sâu, toàn hàng hiếm.
- **Thi câu**: góp phí vào quỹ, ai câu được **tổng giá trị cá** cao nhất trong giờ thi thì ăn quỹ. Có bảng điểm trực tiếp.
- **Bản đồ kho báu**: rơi ra khi câu cá hoặc đào giun. Đi tới chỗ gợi ý rồi đào — nóng, ấm hay lạnh?
- **Máy nông trại**: máy tưới, máy gặt riêng, và **máy chế biến** giúp nông sản bán được giá ~1,4–1,5 lần.
$b$, false, now() + interval '7 seconds'),

('Nghề nghiệp, thể lực và buff đồ ăn', '🛠️', $b$
## Nghề nghiệp
Chọn nghề chính: **Ngư dân, Nông dân, Thợ mỏ, Đầu bếp, Thương nhân, Thợ rèn, Võ sĩ**… Nghề lên cấp từ đúng việc của nó và mở **cây kỹ năng** riêng (ví dụ bán cá đắt hơn, câu ít đói hơn). Đổi nghề/tẩy điểm có phí.

## Thanh thể lực ⚡
Câu cá, đào mỏ, đánh võ đều tốn thể lực. Giữ **Shift** để **chạy nhanh** (tốn thể lực). Hết thể lực thì nghỉ một chút — **nằm võng** ở Sảnh hồi nhanh gấp 3.

## Buff đồ ăn
Món ăn giờ cho buff có thời hạn: **tốc độ, may mắn câu cá hiếm, hồi thể lực**…

## Chụp ảnh 📷
Nút 📷 ẩn giao diện và chụp khoảnh khắc của bạn; tải về hoặc lưu vào **album** (tối đa 24 ảnh).
$b$, false, now() + interval '8 seconds')
) as v(title, emoji, body, pinned, at)
where not exists (select 1 from public.news_posts p where p.title = v.title);

-- the older pinned posts step aside for this one
update public.news_posts set pinned = false
 where pinned and title <> 'Cập nhật lớn 29/9: Làng mở rộng!';
