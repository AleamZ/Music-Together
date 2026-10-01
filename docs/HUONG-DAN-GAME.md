# Hướng dẫn toàn tập — Làng Sông Nhạc (Music Together)

> Tài liệu cho **người chơi và chủ game**: mô tả mọi tính năng đang có trong game, kèm số liệu thật (giá, tỉ lệ, giới
> hạn, thời gian, phần thưởng). Số liệu được lấy từ **code hiện tại**: định nghĩa mới nhất trong `supabase/migrations`
> (file sau ghi đè file trước, đặc biệt Kinh tế v2 0099–0107, Câu cá v3 0110, Hòm thư 0111, Email 0112, Sửa lỗi 0113,
> Cốt truyện 0114), `lib/game/*`, `components/game/*`, `docs/superpowers/specs/*` và `README.md`.
>
> Chỗ nào ghi **(chưa xác minh)** là chưa đối chiếu được chắc chắn với code — đừng coi là luật.
>
> Đơn vị tiền: **xu**. "Ngày" = **ngày giờ Việt Nam** (reset lúc 0h VN). Chủ game chỉnh được một số "núm" kinh tế trong
> /admin, nên vài con số có thể khác với mặc định ghi ở đây.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Tài khoản & đăng nhập](#2-tài-khoản--đăng-nhập)
3. [Giao diện, HUD, phím tắt, điện thoại](#3-giao-diện-hud-phím-tắt-điện-thoại)
4. [Bản đồ & khu vực](#4-bản-đồ--khu-vực)
5. [Tiền tệ & kinh tế](#5-tiền-tệ--kinh-tế)
6. [Câu cá (chi tiết)](#6-câu-cá-chi-tiết)
7. [Nông trại](#7-nông-trại)
8. [Mỏ đá, rừng, nấu ăn, chế thuốc, nâng cấp](#8-mỏ-đá-rừng-nấu-ăn-chế-thuốc-nâng-cấp)
9. [Nghề nghiệp & cây kỹ năng](#9-nghề-nghiệp--cây-kỹ-năng)
10. [Chiến đấu: võ đài, võ đường, hầm ngầm, boss, hầm ngục, thú cưng](#10-chiến-đấu)
11. [Đời sống: sinh tồn, ăn uống, nhà ở, thời trang, xe cộ, giải trí](#11-đời-sống)
12. [Nhiệm vụ & tiến trình](#12-nhiệm-vụ--tiến-trình)
13. [Hòm thư, code quà, tin tức, góp ý](#13-hòm-thư-code-quà-tin-tức-góp-ý)
14. [Chống gian lận (tóm tắt cho chủ game)](#14-chống-gian-lận-tóm-tắt-cho-chủ-game)
15. [Trang quản trị /admin](#15-trang-quản-trị-admin)

---

## 1. Tổng quan

**Music Together** ban đầu là phòng nghe nhạc YouTube chung. Từ bản v13 mỗi phòng nhạc còn là một **làng game pixel
miền Tây**: đi lại, câu cá, làm ruộng, đào mỏ, đánh võ, nuôi thú, mua nhà… trong khi nhạc của phòng vẫn phát cho mọi người.

- **Chế độ game là mặc định.** Mở phòng là vào làng game; chỉ khi bạn chủ động chọn **🖥️ Giao diện cũ** thì mới thấy phòng
  nhạc kiểu cũ (lựa chọn lưu theo trình duyệt). Nhạc không bị ngắt khi đổi qua lại.
- **Phòng (sảnh):** từ 0093 chỉ còn **3 sảnh công khai** ai cũng vào được, không mật khẩu: **Sảnh Chính**, **Sảnh Chợ Đêm**,
  **Sảnh Sông Quê**. Phòng cũ khác thành phòng riêng (đóng với mọi người trừ root và admin phòng). Tạo phòng mới đang tắt
  (cờ `room_creation_open`), chỉ root tạo được.
- **2D và 3D:** cùng một dữ liệu, hai cách vẽ. Bản 2D chia thành các map nối bằng cổng; bản 3D là một **thế giới liền**
  (4160 × 2240 px) với các khu nằm trên đó, xe chạy trên đường, ghe chèo khắp sông. Luật chơi giống nhau. Phím **8** đổi góc
  nhìn thứ nhất/thứ ba trong 3D.
- **Máy chủ quyết định mọi thứ:** cá gì, nặng bao nhiêu, giá bao nhiêu, có trúng không… đều do server tính và kiểm lại.
  Trình duyệt chỉ hiển thị.

### Phòng nhạc (vẫn dùng trong game)

- Thêm bài bằng link YouTube, link playlist (tối đa 50 bài) hoặc **gõ từ khóa để tìm** ngay trong game.
- Nghe đồng bộ cả phòng; chỉ **DJ** được play/pause/tua/chuyển bài. Mỗi người có âm lượng riêng.
- Luật hàng đợi (Admin/DJ chỉnh): thời lượng tối đa (mặc định 10 phút), chờ duyệt, từ khóa cấm, số bài mỗi người (mặc định 5).
- Trong game: tới **Quầy DJ** ở sảnh bấm **E** (hoặc phím **Q**) để mở hàng đợi.
- **Thưởng bài hát:** bài bạn xếp (≥ 60 s) được phát ≥ 75 % thời lượng thì bạn nhận **+10 xu**, tối đa 10 lần/ngày (theo
  README; thời gian phát do server đo).
- Chat, thả cảm xúc (❤️ 😂 🔥 👏 🎉), tin nhắn hiện thành bong bóng trên đầu nhân vật.

---

## 2. Tài khoản & đăng nhập

| Cách | Mô tả |
|---|---|
| **Email (mới)** | Đăng ký bằng email + mật khẩu, xác nhận qua thư, rồi chọn tên nhân vật. Đăng nhập bằng email. |
| **Tên đăng nhập (cũ)** | Tài khoản cũ dùng tên + mật khẩu vẫn chạy. Chủ game có thể tắt đăng ký kiểu cũ (cờ `legacy_register_open`). |
| **Liên kết email** | Tài khoản cũ có thể gắn email (banner ở sảnh chờ, hoặc Tài khoản). Cần **mật khẩu cũ** (0113). Sau khi gắn, **mật khẩu cũ bị xoá** — từ đó chỉ đăng nhập bằng email. |
| **Quên mật khẩu** | Gửi thư đặt lại về email. Tài khoản cũ chưa gắn email **không khôi phục được**. |
| **Đổi mật khẩu** | Tài khoản email: nhập mật khẩu hiện tại rồi đặt mới. Tài khoản cũ: mật khẩu mới 8–72 ký tự, tối đa 5 lần thử/15 phút; đổi xong các phiên khác bị đăng xuất. |
| **Đổi email** | Chỉ khi đang đăng nhập đúng email của tài khoản; xác nhận qua thư. |

- Tên nhân vật: 2–24 ký tự, không ký tự ẩn, không trùng tên đặt trước (Ao cá, Hợp tác xã, root…). Hai tên chỉ khác hoa/thường,
  khoảng trắng hoặc dạng Unicode coi là trùng.
- Giới hạn chống spam: tạo nhân vật 10 lần/giờ, gắn email 10 lần/giờ, đổi phiên game từ email 60 lần/giờ.
- Tài khoản bị khoá sẽ được báo khi đăng nhập.

---

## 3. Giao diện, HUD, phím tắt, điện thoại

### HUD

- Thanh trên: thẻ người chơi (cấp, danh hiệu, xu), thanh **🍚 đói / 💧 khát / ⚡ thể lực**, thời tiết, số người ở mỗi khu.
- **Menu nhóm** (mỗi lúc mở một nhóm):
  - **⚙️ Cài đặt** — các tab *Chung* (hiệu ứng thời tiết mức 0–4…), *Camera & zoom*, *Phím tắt*, *Bản đồ*.
  - **🎒 Túi đồ** — Giỏ đồ, Tủ đồ, cất/lấy cá, Ô của tôi, Chó của bạn, **📬 Hòm thư** (chấm đỏ khi có thư chưa đọc), Chợ người
    chơi, Trại thú…
  - **🧭 Hoạt động** — Thế giới (săn bắt, tổ đội, boss, hầm ngục), việc đồng áng, chụp ảnh… (chấm đỏ khi ruộng cần làm gấp hoặc
    có lời thách đấu thú).
  - **📜 Nhiệm vụ & tin tức** — nhiệm vụ, hồ sơ, Báo Làng.
- **Theo dõi cốt truyện:** khung nhỏ hiện chương, mục tiêu n/goal và mũi tên/khoảng cách tới NPC (xem §12).
- **Bản đồ nhỏ** và cột **bản đồ thành phố** ở mỗi map (phím **M**).

### Phím tắt

| Phím | Việc | Phím | Việc |
|---|---|---|---|
| WASD / mũi tên | Đi lại (giữ **Shift** để chạy, tốn thể lực) | **E** | Tương tác, cứu người, xin đi nhờ / xuống xe |
| **R** | Lên / xuống xe | **Space** | Giật cần, kéo cá, minigame |
| **Esc** | Thu cần, đóng bảng | **I** | Tủ đồ |
| **B** | Giỏ đồ | **F** | Cất / lấy cá trên tay |
| **U** | Ô của tôi | **P** | Chó của bạn |
| **G** | Việc đồng áng (ở ruộng) | **O** | Cài đặt cá nhân |
| **Z** | Zoom camera | **M** | Bản đồ thế giới |
| **1** | Hồ sơ (cấp, thành tựu, danh hiệu, Fishdex, xếp hạng) | **2** | Nhiệm vụ |
| **3** | Nghề nghiệp & cây kỹ năng | **4** | Chợ người chơi · đấu giá |
| **5** | Trại thú (trứng, nuôi, đấu thú, cá chiến) | **6** | Thế giới (săn bắt, tổ đội, boss, hầm ngục) |
| **7** | Chụp ảnh | **8** | 3D: góc nhìn thứ nhất / thứ ba |
| **J** | Nhảy xuống ao | **K** | Khởi động (trước khi bơi) |
| **L** | Quăng lưới | **T** | Gõ tin nhắn |
| **C** | Mở phòng chat | **X** | Thả cảm xúc |
| **V** | Thành viên | **Y / N** | Đồng ý / từ chối cho đi nhờ (khi có người xin) |
| **Q** | Hàng đợi nhạc | **N** | Bảng tin (khi không có ai xin đi nhờ) |
| **H** hoặc **?** | Bảng phím tắt | | |

### Điện thoại

- Cầm dọc sẽ hiện màn **"Xoay ngang màn hình để chơi"**.
- Cầm ngang: **cần điều khiển ảo** (kéo để đi) + nút lớn **Tương tác** và **␣** (quăng cần, giật, kéo — giữ).
- Bấm/chạm lên mặt đất để nhân vật tự tìm đường.

---

## 4. Bản đồ & khu vực

### Các map

| Map | Có gì | Cấp cần |
|---|---|---|
| **Sảnh (hall)** | Quầy DJ, Bảng tin (xếp hạng), **Báo Làng** (sạp báo), **Bác Ba Làng** (giao nhiệm vụ), **Góc đánh bài** (Tiến lên, Cào, Poker, Xì dách), **Võng** (nằm hồi thể lực ×3), lối ra Bến câu cá / Ra đồng / Chợ Lớn | 1 |
| **Ao cá (pond)** | 6 chỗ câu trên sàn gỗ + câu từ bờ, **Bãi trùn**, **Vựa cá cô Ba**, **Tiệm đồ câu chú Tư**, **Bảng kỷ lục**, **Đấu câu** (thi câu), **Bến ghe** (ra Sông Cái), Cầu khỉ ra đồng | 1 |
| **Đồng ruộng (field)** | 4 thửa riêng (bắc kênh) + 6 thửa làng (nam kênh), **Hợp tác xã chú Tám**, **Tiệm vật tư anh Hai**, **Vựa lúa cô Út**, **Sân phơi**, **Kho máy**, 6 hang cua, 4 bãi ốc | 1 |
| **Chợ Lớn (market)** | **Nhà hàng**, **Tiệm quần áo**, **Salon tóc**, **Xe cộ**, **Sạp ô dù**, **Nội thất cô Năm**, **Nhà nghỉ Hoa Sen**, **Tiệm thú cưng**, **Sạp cho thuê** (chú Bảy), **Vựa cá Chợ Lớn** (chú Hai), **Vựa nông sản**, **Võ đường thầy Lâm**, Bao cát luyện võ, **Nắp cống** (xuống Hầm ngầm), lối ra Khu nhà / Bãi đất trống | 1 (điểm dịch chuyển mở ở cấp 2) |
| **Khu nhà (khu_nha)** | **Chung cư Phú Mỹ** (12 căn), 8 lô đất xây nhà, **Sàn bất động sản** | 1 (điểm dịch chuyển cấp 4) |
| **Bãi đất trống (bai_dat)** | 4 **võ đài**, Bảng thành tích, Bao cát, **sạp thợ săn** (ban đêm thành chợ đêm), **cổng hầm ngục**, đấu trường boss, lối vào **Mỏ đá** và **Rừng tràm** | 1 (điểm dịch chuyển cấp 6) |
| **Mỏ đá (mo_da)** | Mạch quặng 3 vùng + 2 vùng thảo dược, **Lán chú Tám** (cuốc, mua quặng), **Vạc thuốc bà Sáu**, **Đe rèn** | **5** |
| **Rừng tràm (rung_tram)** | Cây để đốn, thú hoang để săn/bẫy/chụp ảnh | 1 |
| **Sông Cái (song_cai)** | Sông lớn chỉ tới được bằng **ghe**; 3 bãi cạn (shoal), đá, cù lao | **3** + có ghe |
| **Hầm ngầm (ham_ngam)** | Anh Tư Sẹo, Lồng đấu, Cửa thách đấu, Bảng xếp hạng ngầm | ẩn, phải mở khoá (§10) |
| **Nhà / căn hộ** | Nội thất của bạn, tivi, tủ lạnh, bể cá | phải thuê/mua |

- Trong **3D**, Mỏ đá thành hang dưới đất có cửa ở đồi phía đông; sông Cái và các kênh là một dòng liền, ghe đi được khắp
  ("sông hoang" — cũng cần cấp 3 và có ghe). Thú hoang chỉ sống trong rừng tràm.

### Đi lại

- **Điểm dịch chuyển:** tới một khu là mở điểm của khu đó; sau đó dịch chuyển nhanh **50 xu** mỗi lần. Điểm: Sảnh, Ao cá,
  Đồng ruộng (cấp 1), Chợ Lớn (cấp 2), Khu nhà (cấp 4), Bãi đất trống (cấp 6).
- **Xe** (xem §11): 2D đi Chợ Lớn mất 15 s đi bộ / 10 s xe đạp / 5 s xe máy / 2 s xe hơi; **xe ôm** bỏ qua chuyến đi tốn 50 xu
  (chỉ bản 2D). 3D: xe chạy nhanh hơn đi bộ 1,77× / 2,54× / 3×.
- **Đi nhờ:** đứng sát người đang lái, bấm E xin, chủ xe bấm Y.
- Server kiểm vị trí: không thể "nhảy" tới nơi xa nhanh hơn tốc độ cho phép (đi bộ 260 px/s, nhân với tốc độ xe).

---

## 5. Tiền tệ & kinh tế

### Xu kiếm từ đâu

Bán cá, cua, ốc, chuột, quặng, gỗ, đồ rừng, món ăn, lúa và hoa màu; thưởng nhiệm vụ, lên cấp, thành tựu, Fishdex; boss,
hầm ngục, kho báu; điểm danh mỗi ngày (+20) và quà đăng nhập; bài hát; thắng bài, thắng võ có cược; bán đồ cho người chơi.
Mọi lần cộng/trừ xu đều ghi vào **sổ cái `coin_ledger`** kèm lý do.

**Thang giá (Kinh tế v2):** một giờ chơi tích cực ≈ **3 000 xu**. Người mới ≈ 1 500–2 000 xu/giờ, đồ tốt nhất ≈ 4 000–7 000
xu/giờ. Ví dụ: bánh mì 150 xu (3 phút chơi), xe hơi 150 000 (≈ 50 giờ), thửa ruộng riêng 800 000 (≈ 250 giờ).

### Thương lái — giới hạn bán hằng ngày

Hàng "cày" bán cho NPC (cá, cua, ốc, chuột, quặng, gỗ, đồ rừng, món ăn) được cộng dồn theo giá gốc trong ngày:

| Tổng giá trị đã bán trong ngày | Thương lái trả |
|---|---|
| 0 → **20 000** xu | **100 %** |
| 20 000 → **40 000** xu | **50 %** |
| trên 40 000 xu | **20 %** |

- **Không tính:** lúa, hoa màu, hàng chế biến (đã bị giới hạn bởi số thửa), kho báu (giới hạn bởi số bản đồ/ngày).
- Quầy bán hiện dòng "Thương lái hôm nay" và số xu bị giữ lại. Qua 0h là reset.

### Các hệ số giá

| Hệ số | Giá trị |
|---|---|
| `fish_mult` — hệ số chung cả server cho cá (cần + lưới), cua, ốc, chuột | **×1,00** (admin chỉnh 0,20–3,00). Thay cho hệ số "theo độ giàu của phòng" cũ |
| Hệ số mùa của từng loài cá | đổi mỗi 3 giờ (00:00, 03:00… giờ VN) |
| **Chợ Lớn** (vựa cá chú Hai, vựa nông sản) | **+10 %** cho cá, lúa, hoa màu (trước là +20 %) |
| Phụ cấp nghề (perk) | tổng tối đa **1 500 xu/ngày** mỗi tài khoản |

### Núm chỉnh của chủ game (`econ_params`, /admin → Kinh tế)

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `fish_mult` | 1,00 | Hệ số giá cá/cua/ốc/chuột |
| `npc_full` | 20 000 | Mốc trả đủ giá của thương lái |
| `npc_half` | 40 000 | Mốc trả 50 % |
| `npc_tail_pct` | 20 | % trả sau mốc `npc_half` |
| `p2p_fee_pct` | 5 | % xu bị **đốt** khi xu chuyển giữa người chơi |
| `trade_daily_in` | 50 000 | Xu tối đa một tài khoản nhận qua giao dịch mỗi ngày |

### Nơi tiêu xu (sink)

Đồ ăn uống, đồ câu, giống/phân/thuốc, máy nông trại, thuê ruộng 10 000/mùa, sửa cần (30 % giá cần), thuốc, phí nâng cấp,
nhà nghỉ 300/đêm – 6 000/tháng, thuê căn hộ 2 000/30 ngày, phí giữ đất nhà 1 500/30 ngày, nội thất, thời trang, salon, xe,
thú cưng, phí võ đường, phí hầm ngục 100, phí dịch chuyển 50, thuê sạp 500/ngày, phí đăng bán ở chợ, phí đổi nghề 2 000 / tẩy
điểm 1 000.

### Giữa người chơi

| Luật | Giá trị |
|---|---|
| Xu trong **giao dịch trực tiếp** | người nhận được **95 %**, 5 % bị đốt |
| Ai được **nhận xu** qua giao dịch | tài khoản **≥ 3 ngày tuổi và cấp ≥ 5**, tối đa **50 000 xu/ngày** |
| Giao dịch | hai người đứng gần nhau (≤ 320 px), tối đa 8 món mỗi bên, hai bên cùng xác nhận; đồ/xu tới qua **Hòm thư** |
| **Chợ người chơi** (phím 4) | đăng bán cá, đồ thời trang, nông sản; giá phải trong **50–300 %** giá NPC; phí đăng 2 % (ít nhất 5 xu), tin đăng 72 giờ, tối đa 20 tin; khi bán **phí 5 %** (nghề Thương nhân giảm, ít nhất còn 2 %); hết hạn hoàn nửa phí đăng |
| **Đấu giá** | món có giá trị ≥ 300 xu; thời hạn 1/6/12/24 giờ; bước giá +5 % (≥ 10 xu); trả giá trong 2 phút cuối thì gia hạn |
| **Sạp thuê** (chú Bảy, Chợ Lớn) | 6 sạp, **500 xu/ngày**, thuê tối đa 7 ngày, 8 ô hàng; bán cả khi bạn offline |
| **Không giao dịch được** | thú cưng, đồ câu/nông cụ, xe, nhà (nhà/đất dùng Sàn bất động sản) |
| Tặng đồ thời trang | chỉ cho người cùng phòng, **5 món/ngày** |
| Mua bán ruộng | 400 000 – 2 400 000; cho thuê lại ≤ 50 000; người bán nhận 95 % |
| Đánh bài | không thu phế (thắng = đúng số người thua trả); **Xì dách** không ai bị âm xu |

- Giao dịch lệch giá lặp lại giữa cùng một cặp (giá ≥ 200 % hoặc ≤ 60 % giá trị, 3 lần trong 7 ngày) bị đánh dấu nghi thông đồng.
- **Danh sách đen** và **điểm bot** (xem §14) làm giảm thu nhập của tài khoản gian lận.

> **Mẹo cho người mới:** Đừng cày một việc quá 20 000 xu/ngày — sau mốc đó thương lái chỉ trả một nửa rồi 20 %. Chia thời gian
> cho ruộng (không bị giới hạn thương lái) và các việc khác. Bán cá ở **Chợ Lớn** để được thêm 10 %.

---

## 6. Câu cá (chi tiết)

### 6.1 Bộ đồ câu (Câu cá v3)

**Cần gỗ** là bộ đủ sẵn (lưỡi nhỏ, dây 3 kg, phao lông gà), không bao giờ gãy — người mới cứ thế câu, chủ yếu cá nhỏ, cá
thường. **Mọi cần khác bán "trơn"**: phải lắp **lưỡi** và **dây** thì mới quăng được (thiếu sẽ báo "Cần này chưa đủ đồ —
lắp lưỡi và dây câu…"). **Máy xoay** và **phao** là tuỳ chọn. Lắp/tháo tự do trong **🎒 Giỏ đồ**.

#### Cần câu

| Cần | Giá | Vùng giữ cá | Cá hiếm | Gãy khi cá nặng hơn | Độ bền |
|---|---:|---:|---|---:|---:|
| Cần gỗ | có sẵn | 25 % | ×1 | không gãy (dây riêng 3 kg) | vô hạn |
| Cần tre | 300 | 30 % | ×1 | 6 kg | 120 lần |
| Cần sợi thủy tinh | 700 | 33 % | ×1,1 | 12 kg | 200 |
| Cần carbon | 1 500 | 36 % | ×1,2 | 30 kg | 300 |
| Cần thủ | 5 000 | 40 % | ×1,4 | 60 kg | 600 |

Cần tốt hơn còn câu được **cá nặng hơn** (hệ số cân nặng k: gỗ 2,0; tre/sợi/carbon 1,5; cần thủ 1,3 — k nhỏ hơn thì cá nặng
hơn). Sửa cần ở chú Tư: **30 % giá cần**.

#### Lưỡi câu (không mòn)

| Lưỡi | Giá | Loại | Ghi chú |
|---|---:|---|---|
| Lưỡi đơn nhỏ | 20 | nhỏ, 1 mũi | |
| Lưỡi đơn lớn | 100 | lớn, 1 mũi | cần cho cá hô, ba ba, cá leo, cá chiên, cá đuối, cá tra dầu, rùa, cá vồ đém |
| Lưỡi tôm | 60 | tôm | bắt buộc với tôm càng xanh |
| Lưỡi câu lươn | 80 | lươn | bắt buộc với lươn đồng, cá chình |
| Lưỡi đôi | 400 | nhỏ, 2 mũi | 12 % dính thêm 1 con |
| Lưỡi ba | 1 500 | lớn, 3 mũi | 15 % thêm 1 con, 6 % thêm 1 con nữa |

#### Dây câu (mỗi dây chịu 3 lần đứt, lần thứ 3 thì hỏng hẳn, không sửa được)

| Dây | Giá | Chịu |
|---|---:|---:|
| Dây cước 0.2 | 40 | 4 kg |
| Dây cước 0.3 | 150 | 12 kg |
| Dây dù bện | 400 | 30 kg |
| Dây PE siêu bền | 1 200 | 60 kg |

#### Máy xoay (không mòn)

| Máy | Giá | Thời gian kéo tối thiểu | Độ khó |
|---|---:|---|---|
| (không có, cần trơn) | — | ×1,15 | +5 |
| Máy xoay 1000 | 150 | ×1,00 | ±0 |
| Máy xoay 3000 | 400 | ×0,90 | −5 |
| Máy xoay 5000 | 1 200 | ×0,80 | −10 |

#### Phao

| Phao | Giá | Thời gian giật cần | Chờ cá cắn | Ghi chú |
|---|---:|---|---|---|
| Phao lông gà | có sẵn | 1,5 s | 3–10 s | |
| Phao xốp | 150 | 2,0 s | 3–10 s | hiện độ hiếm khi cá cắn |
| Phao đèn | 800 | 2,5 s | 2–7 s | hiện độ hiếm |
| (cần trơn không phao) | — | **0,7 s** | | rất dễ trượt |

#### Mồi (hộp mồi chứa 20; **Hộp mồi** 250 xu → 60)

| Mồi | Giá | Hiệu ứng |
|---|---:|---|
| Trùn đất | đào miễn phí ở **Bãi trùn** (1–3 con/45 s) | thường |
| Mồi tép | **1** | cá hiếm/quý/huyền thoại ×1,5 |
| Mồi trùn chỉ | **3** | hiếm ×2, quý ×2, huyền thoại ×3 |
| Mồi vàng | **4** | như trùn chỉ + cá cắn nhanh hơn (×0,6 thời gian chờ) |

#### Thính (rải ở chỗ câu, mua theo bịch, tối đa 99/loại)

| Thính | Giá/bịch |
|---|---:|
| Thính cám gạo | 10 |
| Thính tôm khô | 15 |
| Thính thơm | 20 |
| Thính tanh | 30 |

Rải thính (nút **🌾 Rải thính** ở mép ao, hoặc từ ghe): trong **10 phút**, bán kính **48 px**, các loài thích loại thính đó
được **×3** cơ hội — **chỉ cho chính bạn** (cần và lưới của bạn). Thính chỉ đổi loài *trong cùng độ hiếm*, không đổi độ hiếm.

#### Xô, thùng, bộ kit, sổ tay

| Món | Giá | Chứa |
|---|---:|---|
| (tay không) | — | cầm 1 con trên tay |
| Xô nhỏ | 200 | 5 |
| Xô vừa | 450 | 10 |
| Xô lớn | 800 | 15 |
| Thùng xốp | 2 000 | 30 |
| Thùng đá | 5 000 | 50 |
| **Bộ câu cá** (kit) | 50 000 | Hộp mồi 100 + Thùng cá 100 |
| **Sổ tay câu cá** | 500 | Mở bảng tra mọi loài: lưỡi, mồi, thính, giờ cắn (🟢 đang cắn) |

Sức chứa lấy theo đồ chứa tốt nhất bạn có (chưa xác minh có cộng dồn hay không). Xô đầy thì cá câu thêm bị thả.

> **Mẹo cho người mới:** Bộ "giữa" đáng tiền: **Cần carbon + Lưỡi đơn lớn + Dây dù bện + Máy xoay 3000 + Phao xốp ≈ 2 550 xu**.
> Đừng lắp dây yếu hơn cần: cá nặng hơn **phần yếu nhất** của bộ đồ sẽ làm đứt dây (hoặc gãy cần).

### 6.2 Độ hiếm và các loài cá

Độ hiếm cá: **1 Thường · 2 Khá · 3 Hiếm · 4 Quý · 5 Huyền thoại**. Tỉ lệ gốc mỗi lần quăng: Huyền thoại 0,3 %, Quý 2,7 %,
Hiếm 9 %, Khá 28 %, Thường ≈ 60 %. Nhân thêm theo mồi, cần (rare), thời tiết (mưa to "cá lớn"), **ban đêm** (quý & huyền
thoại ×1,5). Ngoài ra mỗi lần quăng có **một lần "nâng hạng"** (lên 1 bậc) từ thuốc may mắn, cấp nâng cấp cần (+3 %/cấp), kỹ
năng Ngư dân và buff món ăn — tổng tối đa **20 %**.

**Giá cá = cân nặng (kg) × giá/kg × `fish_mult` × hệ số mùa.** Cân nặng ngẫu nhiên trong khoảng, cần tốt nghiêng về phía nặng.

#### Cá ao (pond)

| Loài | Hiếm | Cân nặng | Giá/kg | Lưỡi | Thích mồi · thính | Giờ cắn |
|---|---:|---|---:|---|---|---|
| Cá rô | 1 | 50–300 g | 40 | bất kỳ | trùn · cám | luôn |
| Cá sặc | 1 | 50–250 g | 38 | bất kỳ | trùn, trùn chỉ · cám | luôn |
| Cá mè vinh | 1 | 100–500 g | 30 | bất kỳ | trùn · cám, thơm | luôn |
| Cá lóc | 2 | 0,3–2,5 kg | 10 | bất kỳ | tép, vàng · tôm | luôn |
| Cá trê | 2 | 0,2–1,2 kg | 15 | bất kỳ | trùn, trùn chỉ · tanh | luôn |
| Cá chép | 2 | 0,5–3 kg | 9 | bất kỳ | trùn, vàng · cám, thơm | luôn |
| Lươn đồng | 2 | 100–600 g | 35 | **lươn** | trùn · tanh | 18h–6h |
| Cá tra | 3 | 1–6 kg | 8 | bất kỳ | tép · tanh, thơm | luôn |
| Cá thát lát | 3 | 0,3–1,5 kg | 27 | bất kỳ | tép · tôm | luôn |
| Tôm càng xanh | 3 | 50–300 g | 129 | **tôm** | trùn chỉ · tôm | luôn |
| Cá bông lau | 4 | 1–5 kg | 16 | bất kỳ | tép, vàng · tanh | luôn |
| Cá he vàng | 4 | 0,3–1,5 kg | 45 | bất kỳ | vàng · thơm | 6h–18h |
| Cá tai tượng | 4 | 0,8–4 kg | 18 | bất kỳ | tép · thơm | 5h–10h |
| Cá hô | 5 | 10–40 kg | 21 | **lớn** | vàng · thơm | luôn |
| Ba ba gai | 5 | 3–15 kg | 60 | **lớn** | vàng · tôm | 20h–4h |

#### Cá sông / nước sâu (deep — câu từ ghe trên Sông Cái hoặc sông hoang)

| Loài | Hiếm | Cân nặng | Giá/kg | Lưỡi | Thích mồi · thính | Giờ cắn |
|---|---:|---|---:|---|---|---|
| Cá leo | 3 | 1–8 kg | 9 | **lớn** | tép · tanh | luôn |
| Cá bống tượng | 3 | 0,3–2,5 kg | 27 | bất kỳ | trùn chỉ · tôm | luôn |
| Cá lăng | 3 | 0,8–6 kg | 12 | bất kỳ | trùn · tanh | luôn |
| Cá ngát | 3 | 0,6–4 kg | 16 | bất kỳ | trùn · tanh | 18h–7h |
| Cá chiên | 4 | 2–15 kg | 8 | **lớn** | tép · tanh | luôn |
| Cá đuối sông | 4 | 3–20 kg | 6 | **lớn** | trùn chỉ · tanh | luôn |
| Cá dứa | 4 | 1,5–10 kg | 12 | bất kỳ | tép · tôm | luôn |
| Cá anh vũ | 4 | 0,5–3,5 kg | 35 | bất kỳ | vàng · thơm | luôn |
| Cá chình | 4 | 1–8 kg | 16 | **lươn** | trùn chỉ · tanh | 19h–5h |
| Cá tra dầu | 5 | 12–45 kg | 28 | **lớn** | vàng / trùn chỉ · thơm / tanh | luôn |
| Rùa mai vàng | 5 | 5–30 kg | 49 | **lớn** | (như trên) | luôn |
| Cá vồ đém | 5 | 10–35 kg | 36 | **lớn** | (như trên) | luôn |

Trên sông, cá Thường/Khá (cá ao) có thể "nâng" thành Hiếm: **5 %** (bãi cạn trên Sông Cái: **10 %**). Sông trả khoảng
**1,5×** ao với cùng bộ đồ. Mồi khách thích ×2, thính khách thích ×3 (trong cùng độ hiếm); loài không cắn vào giờ đó hoặc
không hợp lưỡi thì không ra — hết loài thì rơi xuống độ hiếm thấp hơn (Thường luôn có).

Giá trung bình một con với cần gỗ (×1,00): Thường 4–7 xu, Khá 8–12, Hiếm 17–21 (sông 28–30), Quý 31–37 (sông 51–53),
Huyền thoại ≈ 420 (sông 644–660).

### 6.3 Một lần câu, từng bước

1. **Đứng ở chỗ câu** (6 chỗ trên sàn gỗ; câu từ mép bờ cũng được nhưng cá ít cắn hơn) và bấm **E** / chạm mặt nước.
   Mỗi lần quăng tốn **3 thể lực**, **0,35 đói và 0,45 khát**, và 1 mồi. Bão (gió ≥ 60 km/h) thì đóng bến.
2. **Server chọn sẵn** con cá (độ hiếm → loài → cân nặng → nâng hạng → cá phụ của lưỡi nhiều mũi), độ khó và thời gian kéo
   tối thiểu. Bạn không thấy trước (trừ phao xốp/đèn hiện độ hiếm lúc cắn).
3. **Chờ cá cắn** (theo phao, thời tiết có thể làm cá cắn nhanh/chậm). Khi hiện **❗**, bấm **Space** / chạm / nút
   **❗ Giật cần!** trong cửa sổ của phao (0,7–2,5 s). Trễ là cá đi mất.
4. **Kéo cá** (minigame kiểu Stardew): giữ Space/chuột/ngón tay để nâng **vùng xanh**, thả ra để nó rơi; giữ cá trong vùng
   xanh cho tới khi thanh đầy. Thanh bắt đầu ở 30 %. Kích thước vùng xanh = % của cần.
   - **Độ khó** = độ khó của loài + máy xoay (1…100).
   - **Thời gian kéo tối thiểu** = (2 000 + 40 × độ khó) ms × hệ số máy xoay. Không ai thắng nhanh hơn mốc này.
   - Tối đa 60 s; **Thu cần / Esc** để bỏ.
5. **Kết quả:** server **chạy lại** toàn bộ thao tác kéo của bạn để quyết định thắng/thua (không tin kết quả trình duyệt gửi).
   - Thắng mà cá nặng hơn **dây** → **đứt dây** (`line_snap`, mất 1/3 lần chịu của dây, lần 3 là mất dây).
   - Nặng hơn **cần** → **gãy cần** (`rod_snap`: độ bền về 0, tự đổi về Cần gỗ, sửa ở chú Tư).
   - Ngược lại cá vào tay/xô; **lưỡi nhiều mũi** có thể dính thêm 1–2 con (nếu xô còn chỗ).
6. Cá Hiếm trở lên được loa báo trong chat phòng. Kỷ lục từng loài ghi ở **Bảng kỷ lục**.

- **Cá lớn có thể lôi bạn xuống ao** — bơi vào bờ (đói −5). Xem thêm bơi lội ở §11.
- **Bán cá:** Vựa cá cô Ba (ao) hoặc Vựa cá Chợ Lớn (+10 %). Bán / Bán hết. Cá trên tay ai cũng thấy.

### 6.4 Lưới (chài)

| Lưới | Giá | Số lần quăng | Bán kính | Cá hiếm |
|---|---:|---:|---:|---|
| Lưới nhỏ | 50 | 20 | 24 | ×1 |
| Lưới lớn | 120 | 30 | 36 (≥ 32 px thêm 1 con) | ×1 |
| Lưới rê | 300 | 30 | 30 | ×1,5 |
| Lưới chài cước | 800 | 40 | 36 | ×2 |

- Đứng ở mép ao, phím **L** / nút **Quăng lưới**, rồi chơi minigame **mũi tên theo nhịp** (kiểu Audition): trượt nhịp là cá xổng.
- Lưới chỉ ra cá Thường/Khá; lưới rê và chài cước có thêm cơ hội Hiếm (10 % × (rare − 1)) và Quý (2 % × (rare − 1)). Không bao
  giờ ra loài cần lưỡi riêng.
- Mỗi mẻ lưới tốn **5 thể lực**, đói/khát như một lần câu.

### 6.5 Ghe, Sông Cái, sông hoang

- **Ghe** giá **25 000 xu**; cần **cấp 3**. Lên ghe ở **Bến ghe** (ao), chơi minigame **chèo ghe** (4 thể lực) để ra Sông Cái;
  chèo hụt thì trôi về, chèo về luôn tới bến.
- Trên sông: câu cá nước sâu (bảng 6.2); 3 bãi cạn tăng cơ hội cá Hiếm. Bản 3D: ghe đi khắp sông và kênh (sông hoang, không có
  bãi cạn).

### 6.6 Bản đồ kho báu

| Mục | Giá trị |
|---|---|
| Rơi khi | câu ao hoặc lưới **1 %**, câu nước sâu **2 %**, đào trùn **0,5 %** |
| Tối đa | **3 bản đồ tìm được mỗi ngày** |
| Cách đào | đi tới vùng gợi ý, dùng **máy dò kim loại** (báo nóng/ấm/lạnh 0–7), đứng đúng chỗ thì đào bằng minigame xẻng (3 thể lực) |
| Phần thưởng | **150–800 xu** (đào sạch không trượt +10 %, tối đa 800); 2 % trúng lớn **3 000 xu** |
| Đào hỏng | vẫn giữ bản đồ |

### 6.7 Thi câu (Đấu câu)

- Ở ao, chủ trận đặt phí **100–10 000 xu** và thời lượng **3 / 5 / 10 phút**; người chơi góp phí vào quỹ.
- Điểm = tổng giá trị cá câu được **trong giờ thi, trong phòng đó**. Người cao nhất ăn quỹ (trừ **10 %** đốt); hoà thì chia;
  không ai câu được thì hoàn phí.

### 6.8 Sổ tay, Fishdex, sửa đồ

- **Sổ tay câu cá** (500 xu): thói quen từng loài; không mua thì server không gửi thông tin này.
- **Fishdex** (trong Hồ sơ): sưu tầm loài, có thưởng (§12).
- Sửa cần: 30 % giá cần (kỹ năng Thợ rèn giảm). Dây không sửa; lưỡi, máy, sổ tay không mòn. Lưới hết lần quăng thì mua mới.

> **Mẹo cho người mới:** Mua **Sổ tay câu cá** sớm để biết giờ cắn — ví dụ ba ba gai chỉ cắn **20h–4h**, cá tai tượng
> **5h–10h**. Đêm (18h–6h) cá quý/huyền thoại ra nhiều hơn 1,5×.

---

## 7. Nông trại

### 7.1 Đất

| Mục | Giá trị |
|---|---|
| Mỗi đồng ruộng | 4 thửa riêng + 6 thửa làng |
| Thuê thửa làng | **10 000 xu / mùa 96 giờ** (gặt xong là hết hợp đồng) |
| Mua thửa riêng | **800 000 xu**, +10 % sản lượng, không phải thuê |
| Bán lại cho làng | 400 000 |
| Bán cho người chơi | 400 000 – 2 400 000 (đề nghị mua có hạn 24 giờ); người bán nhận 95 % |
| Cho thuê lại 1 mùa | ≤ 50 000; chủ nhận 95 % |
| Giới hạn | **2 thửa đang trồng + 1 thửa riêng trên toàn server** mỗi tài khoản |
| Thu hồi | chủ rời phòng hoặc vắng 14 ngày |
| Quà tân nông | lần đầu: 1 bịch giống lúa ngắn ngày + 1 bao urê |

### 7.2 Lúa

| Giống | Giá giống | Sản lượng gốc | Giá/kg (khô) | Ghi chú |
|---|---:|---:|---:|---|
| Lúa ngắn ngày | 600 | 90 kg | 710 | |
| Nếp | 900 | 75 kg | 950 | |
| Lúa thơm | 1 500 | 60 kg | 1 350 | dễ đạo ôn hơn (×1,3) |

Quy trình (≈ 2–3 ngày thật): làm đất → bón lót → ngâm → gieo mạ → **cấy** (minigame: tay quét theo hàng, bấm trúng 12 khóm,
6 điểm là qua) → bón thúc 2 lần → phơi ruộng → giữ nước đúng mức (nước tụt 1 mức mỗi 12 giờ) → trị ốc bươu vàng, sâu cuốn lá,
rầy, đạo ôn → rút nước → **gặt** → **phơi** trên sân 3 giờ (4 ô, mỗi người 2) → bán cho **cô Út** (lúa ướt chỉ được 70 %).
Sổ tay nhà nông (handbook) giải thích từng bước. Phím **G** mở danh sách việc.

- **Gặt bằng liềm** (1 500 xu): 6 phần, mỗi phần là một vòng giữ-thả trong dải (8 bó, 4 điểm là qua). Hỏng thì làm lại ngay.
- **Máy gặt** HTX chú Tám: **500 xu/phần chưa gặt**, gặt nốt trong 30 s.
- **Bình phun** 5 000 xu: một chai thuốc = 3 lần phun.

| Vật tư | Giá |
|---|---:|
| Phân chuồng hoai / lân / urê / kali / NPK | 400 / 500 / 600 / 600 / 900 |
| Thuốc trừ sâu / trừ rầy / trừ bệnh | 700 / 800 / 900 |

### 7.3 Hoa màu (luống)

Lúc làm đất chọn **Lên luống** thay cho ruộng lúa.

| Cây | Giống | Sản lượng gốc | Giá/kg | Thời gian | Đặc điểm |
|---|---:|---:|---:|---|---|
| Khoai lang | 800 | 200 kg | 265 | ≈ 48 h (trồng dây) | luống ngập nước thì thối củ |
| Bắp | 1 000 | 150 kg | 460 | ≈ 60 h (gieo thẳng) | 2 đợt sâu keo |
| Ớt | 1 500 | 60 kg | 1 590 | ươm 10 h, rồi trồng | **3 lứa hái** cách 12 h (40 % / 35 % / 25 %) |

### 7.4 Máy nông trại (Kho máy)

| Máy | Giá | Tác dụng |
|---|---:|---|
| Máy tưới | 6 000 | chỉnh mực nước một bước (giới hạn như tưới tay: 6 lần/giờ, 60 lần/vụ) |
| Máy gặt riêng | 15 000 | gặt thửa của mình miễn phí |
| Máy chế biến | 50 000 | biến lúa khô/hoa màu thành hàng giá ≈ 1,15× |

| Công thức chế biến | Đầu vào | Giá trị | Thời gian |
|---|---|---:|---:|
| Gạo trắng đóng bao | 10 kg lúa ngắn ngày | 8 150 | 4 phút |
| Bánh tét nếp | 10 kg nếp | 10 900 | 6 phút |
| Gạo thơm đặc sản | 10 kg lúa thơm | 15 500 | 6 phút |
| Khoai lang sấy | 10 kg khoai | 3 050 | 3 phút |
| Bột bắp | 10 kg bắp | 5 300 | 4 phút |
| Tương ớt | 5 kg ớt | 9 150 | 5 phút |

Minigame phân loại cho thêm **+1 %** (điểm ≥ 8) hoặc **+2 %** (≥ 11).

### 7.5 Cua, ốc

- **6 hang cua** ven kênh: minigame bắt cua (càng mở/đóng nhanh dần, 3 lần chụp). Mỗi lần trúng là **cua đồng**, 1/10 là **cua gạch**.
- **4 bãi ốc**: giữ 3 giây được 1–3 ốc (ốc đồng hoặc ốc bươu vàng). Bắt ốc bươu vàng hại lúa trên ruộng cũng vào giỏ.
- Mỗi chỗ nghỉ **20 phút**/người (mọi phòng tính chung); tối đa **200 lượt/ngày**.
- Tay cầm được 3 con; **Xô nhựa** +15 (1 500 xu), **Giỏ tre** +30 (6 000 xu), mỗi loại mua 1 lần.

| Con | Giá gốc |
|---|---:|
| Cua đồng | 12 |
| Cua gạch | 45 |
| Ốc đồng | 8 |
| Ốc bươu vàng | 2 |

Giá chốt lúc bắt (× `fish_mult`), bán cho cô Út qua thương lái.

### 7.6 Chuột đồng, cái ná, chó cỏ

- Khi lúa/khoai/bắp chín, cứ **10–20 phút** có một con chuột ra ăn (tối đa 3 con cùng lúc). Mỗi con ăn **2 % sản lượng/giờ**,
  tổng tối đa **10 %** một vụ.
- **Ná** 3 000 xu, **đạn đất** 10 xu/viên: tới gần chuột bấm E, nhắm, giữ để kéo dây vào vùng xanh rồi thả; nạp đạn 2 s.
- **Chó cỏ** (chú Tám): **20 000 xu**, mỗi người 1 con, chọn màu vàng/mực/vện/đốm, đặt tên. Theo bạn mọi map. Cho ăn
  **Thức ăn chó** (150 xu/bịch, no 24 giờ) thì cứ **5 phút** vồ một con chuột gần bạn. Vuốt ve ra tim.
- Chuột bán **150 xu × `fish_mult`**; tối đa **6 con/giờ, 24 con/ngày**.

> **Mẹo cho người mới:** Ruộng **không bị thương lái giới hạn** — một vụ chăm tốt cho khoảng 20 000–25 000 xu/thửa/ngày. Đặt
> lịch xem ruộng (nước tụt mỗi 12 giờ) và nuôi chó để khỏi mất 10 % vì chuột.

---

## 8. Mỏ đá, rừng, nấu ăn, chế thuốc, nâng cấp

### 8.1 Mỏ đá (cấp 5)

- Vào qua khe tường phía đông **Bãi đất trống** (3D: cửa hang trên đồi phía đông). Mua cuốc ở **Lán chú Tám**.
- Đào = minigame gõ theo nhịp; mỗi lần đào tốn **3 thể lực** (đói/khát giảm 3 lần so với trước). Tối đa **200 lượt đào/ngày**.
  **Thuốc thợ mỏ** cho +1 quặng mỗi lần đào.

| Cuốc | Bậc | Giá | Độ bền |
|---|---:|---:|---:|
| Cuốc chim đá | 1 | 150 | 60 |
| Cuốc chim sắt | 2 | 900 | 150 |
| Cuốc chim thép | 3 | 3 500 | 300 |
| Cuốc chim kim cương | 4 | 12 000 | 600 |

| Quặng | Hiếm | Giá | Cuốc tối thiểu | Hồi lại |
|---|---:|---:|---:|---:|
| Đá | 1 | 1 | 1 | 30 s |
| Than | 1 | 3 | 1 | 45 s |
| Quặng đồng | 2 | 6 | 1 | 90 s |
| Quặng sắt | 2 | 10 | 2 | 120 s |
| Quặng bạc | 3 | 20 | 2 | 180 s |
| Quặng vàng | 3 | 40 | 3 | 300 s |
| Ngọc lục bảo | 4 | 80 | 3 | 420 s |
| Kim cương | 5 | 175 | 4 | 600 s |
| Tinh thể lửa | 6 | 500 | 4 | 900 s |

Vùng 1 nhiều đá/than, vùng 2 đồng/sắt, vùng 3 bạc/vàng/ngọc/kim cương (1 % tinh thể lửa). Vùng 4–5 là **thảo dược**:

| Thảo dược | Giá | Hồi lại |
|---|---:|---:|
| Nấm hang | 3 | 60 s |
| Rêu phát sáng | 8 | 90 s |
| Nấm linh chi | 30 | 180 s |

Hái thảo dược tốn **1 thể lực**. Quặng bán cho chú Tám (qua thương lái).

### 8.2 Chế thuốc (Vạc thuốc bà Sáu)

| Thuốc | Phí | Nguyên liệu | Tác dụng |
|---|---:|---|---|
| Cháo nấm bồi bổ | 60 | 2 nấm hang | +40 no |
| Nước rêu mát lành | 25 | 2 rêu | +40 khát |
| Canh cá hồi sức | 120 | 1 cá bất kỳ + 1 nấm hang | +60 no và khát |
| Thuốc giải cảm | 30 | linh chi + rêu + than | hết cảm lạnh, hết say nắng |
| Thuốc thợ mỏ | 300 | linh chi + 2 sắt + 1 bạc | +1 quặng/lần đào trong 10 phút |
| Thuốc may mắn | 150 | 2 linh chi + 1 vàng | may mắn ×1 trong 10 phút (cá dễ lên hạng) |
| Tiên dược vận may | 600 | 3 linh chi + ngọc + kim cương | may mắn ×2 trong 30 phút |

### 8.3 Nâng cấp đồ (Đe rèn)

- Nâng cần câu, lưới, cuốc từ **+1 → +5**. Tốn xu: **max(200 × (cấp + 1), giá món × (cấp + 1) / 4)** + quặng:

| Lên | Quặng | Tỉ lệ thành công |
|---|---|---:|
| +1 | 3 đồng | 90 % |
| +2 | 3 sắt | 75 % |
| +3 | 3 bạc | 60 % |
| +4 | 3 vàng + 1 ngọc | 45 % |
| +5 | 1 kim cương + 2 ngọc | 30 % |

- Hiệu ứng: độ bền +20 %/cấp; cần +3 %/cấp cơ hội cá lên hạng; cuốc vùng trúng +12 ‰/cấp.

### 8.4 Rừng tràm — đốn gỗ (Tiều phu)

- Ai có rìu đều đốn được; kỹ năng là của nghề Tiều phu. Mỗi nhát: **4 thể lực**, cách nhau 1,5 s, minigame 3 nhịp (trúng
  nhịp = sức rìu, trượt = 1).
- **30 khúc/ngày đủ giá**, sau đó nửa giá, tối đa **150 khúc/ngày**. Bán ở sạp thợ săn (Bãi đất) qua thương lái.

| Cây | Số nhát | Mọc lại | Khúc | Giá/khúc |
|---|---:|---:|---:|---:|
| Tre | 3 | 2 phút | 2 | 4 |
| Keo | 4 | 3 | 2 | 6 |
| Thông | 5 | 5 | 2 | 9 |
| Sồi | 7 | 8 | 2 | 15 |
| Gõ đỏ | 9 | 15 | 2 | 25 |
| Trầm hương | 12 | 45 | 1 | 73 |
| Thần mộc | 16 | 120 | 1 | 160 |

| Rìu | Giá | Sức | Độ bền |
|---|---:|---:|---:|
| Rìu tập sự (quà nghề) | — | 1 | 60 |
| Rìu sắt | 300 | 2 | 80 |
| Rìu thép | 900 | 3 | 140 |
| Rìu thép tôi | 1 900 | 4 | 220 |
| Rìu tinh luyện | 4 500 | 4 | 300 |

### 8.5 Săn bắt thú hoang (Thợ săn)

- Thú **chỉ sống trong rừng tràm** (tối đa 24 con). Ba cách: **săn**, **bẫy**, **chụp ảnh** (tầm 64 px; chụp 140 px).
- Tối đa **40 con/ngày**. Ban đêm (18h–6h) sạp thợ săn thành **chợ đêm: +10 %**.
- Săn hụt sói/gấu có thể bị hất văng (đói/khát −8, có thể ngất).

| Thú | Hoạt động | Săn % | Bẫy % | Rơi | Giá |
|---|---|---:|---:|---|---:|
| Chuột đồng | cả ngày | 85 | 80 | Thịt chuột đồng ×1–2 | 35 |
| Gà rừng | ngày | 80 | 60 | Thịt gà rừng ×1–2 | 85 |
| Rắn ri cá | cả ngày | 75 | — | Thịt rắn ri cá | 100 |
| Cầy hương | đêm | — | — | (chỉ chụp ảnh) | — |
| Cò trắng | ngày | — | — | (chỉ chụp ảnh) | — |
| Rùa hộp lưng đen | cả ngày | — | — | (chỉ chụp ảnh, hiếm) | — |

Các loài cũ (thỏ, chim sẻ, hươu, cáo, sói, gấu, đom đóm) và đồ rơi của chúng (thịt thỏ 25, lông vũ 12, sừng hươu 90, da cáo 70,
da sói 120, vuốt gấu 220, hũ đom đóm 15) vẫn có trong bảng giá; từ 0096 chúng không còn sinh ở đồng/ao/bãi đất (còn sinh ở
rừng hay không: chưa xác minh). Cung: tập sự, Cung tre 280, Cung gỗ tràm 850, Cung gỗ cứng 1 800.

### 8.6 Nấu ăn (chỉ Đầu bếp)

- Chỉ người có nghề chính **Đầu bếp** mới nấu được. Mỗi lần nấu **2 thể lực**; phí nguyên liệu trả lúc bắt đầu.
- Minigame 2–3 bước: **thái** (2 nhịp), **khuấy** (giữ, thả đúng điểm), **canh lửa** (dừng trong dải). Điểm trung bình quyết định
  chất lượng: **Hỏng** (0–39: 20 % giá, không hồi thể lực), **Đạt** (40–69: 100 %), **Ngon** (70–89: 110 %), **Tuyệt phẩm**
  (90–100: 125 %).
- Ăn món tự nấu hồi một nửa số thể lực của món (theo chất lượng); bán qua thương lái.

| Món | Nguyên liệu | Phí | Giá bán (Đạt) | Thể lực | Buff |
|---|---|---:|---:|---:|---|
| Cá lóc nướng trui | 1 cá lóc | 10 | 43 | 12 | — |
| Canh chua cá lóc | 1 cá lóc | 10 | 43 | 16 | hồi thể lực +20 % 10 phút |
| Cá rô kho tiêu | 2 cá rô | 10 | 44 | 11 | cá hiếm +5 % 12 phút |
| Bông súng xào tỏi | — | 80 | 64 | 9 | tốc độ +5 % 10 phút |
| Gỏi bông điên điển | — | 120 | 96 | 13 | sức mạnh +10 % 12 phút |
| Chuột đồng nướng sả | 2 thịt chuột | 10 | 121 | 15 | săn trúng +3 % 12 phút |
| Cơm tấm sườn | — | 120 | 96 | 18 | — |
| Lẩu mắm cá linh | 2 cá sặc | 26 | 58 | 22 | cá hiếm +10 % 15 phút |
| Cháo gà rừng | 1 thịt gà rừng | 13 | 144 | 20 | hồi thể lực +30 % 12 phút |
| Cháo rắn đậu xanh | 1 thịt rắn | 16 | 166 | 21 | săn trúng +5 % 15 phút |

Món chỉ tốn phí bán lỗ (≈ 0,8× phí) — để ăn lấy buff và thể lực, không phải để buôn. Vị trí bếp: (chưa xác minh).

---

## 9. Nghề nghiệp & cây kỹ năng

- Phím **3**. Chọn **nghề chính** lần đầu miễn phí (kèm **dụng cụ tập sự** của nghề, mỗi nghề tặng 1 lần duy nhất). Đổi nghề
  **2 000 xu** (chờ 24 giờ giữa hai lần đổi), tẩy điểm **1 000 xu**.
- Mọi nghề đều lên cấp từ đúng việc của nó; nghề chính được **×1,5 XP**; tối đa 2 000 XP/nghề/ngày. Tổng XP để đạt cấp L =
  50·L·(L+1). **Mỗi cấp nghề = 1 điểm kỹ năng.**
- Tiền thưởng từ kỹ năng (perk) tổng cộng tối đa **1 500 xu/ngày**.

| Nghề | Lên cấp nhờ | Kỹ năng (điểm) |
|---|---|---|
| 🎣 **Ngư dân** | câu cá (10), kho báu (20) | Tay quen: câu ít đói 15 % (1) · Mối quen: bán cá +5 % (1) · Dẻo dai: câu ít tốn thể lực 25 % (2) · Chợ cá: bán cá +5 % (2) · Mắt tinh: cá hiếm +4 % (2) · Lão ngư: cá hiếm +6 % (3) |
| 🌾 **Nông dân** | thu hoạch, bán lúa/nông sản, hái thảo dược | Hàng ngon +5 % (1) · Hít thở: hồi thể lực +15 % (1) · Được mùa +5 % (2) · Giống rẻ −10 % (2) · Khỏe như trâu: thể lực tối đa +15 (2) · Bội thu +5 % (3) |
| ⛏️ **Thợ mỏ** | đào quặng, ngọc, bán quặng | Tay búa: đào ít tốn thể lực 20 % · Biết quặng +5 % · Mối lái đá +5 % · Lưng sắt +20 thể lực · Giữ đồ nghề (cuốc rẻ 10 %) · Mắt ngọc +5 % |
| 🍳 **Đầu bếp** | nấu ăn, chế thuốc, chế biến | Nấu kỹ / Hầm lâu: buff lâu hơn 25 % mỗi cái · Gia vị bí truyền: buff mạnh +20 % · Đi chợ khéo / Khách quen: bữa ăn rẻ 10 % mỗi cái · Pha chế: thuốc rẻ 10 % |
| 💰 **Thương nhân** | bán ở chợ/sạp/đấu giá | Mồm mép / Buôn có bạn: **giảm phí chợ** 3 % mỗi cái (phí tối thiểu 2 %) · Trả giá / Mua sỉ: mua rẻ 5 % · Buôn cá: bán cá +3 % · Chỗ quen: thuê sạp rẻ 15 % |
| ⚒️ **Thợ rèn** | nâng cấp, sửa, rèn | Tay nghề / Lò rèn riêng: nâng cấp rẻ 10 % · Sửa khéo / Như mới: sửa rẻ 20 % · Tự rèn cuốc −10 % · Vai rộng +15 thể lực |
| 🪚 **Thợ mộc** | đốn gỗ, mua nội thất, xây nhà | Tay chai: hồi thể lực +10 % · Đồ gỗ / Chạm trổ: nội thất rẻ 10 % · Dựng nhà −5 % · Gân guốc +15 thể lực · Nghỉ tay: hồi +20 % |
| 🥋 **Võ sĩ** | đánh võ, học phí, thi đai | Hơi dài / Mình đồng: đánh ít tốn thể lực 25 % · Môn sinh / Đệ tử ruột: học phí võ đường rẻ 10 % · Thân thép +20 thể lực · Điều tức: hồi +25 % |
| 🏹 **Thợ săn** | săn (10), bẫy (8) | 6 kỹ năng về tỉ lệ trúng, săn đêm, thêm đồ rơi, thêm đồ từ sói/gấu, ít tốn thể lực. Nghề chính: +(5 + cấp) điểm % trúng (≤ 95 %), thêm 1 đồ rơi 10–25 % theo cấp |
| 🪓 **Tiều phu** | đốn gỗ (8) | 6 kỹ năng: thêm sức khi trượt nhịp, cửa sổ nhịp rộng hơn, ít tốn thể lực, giữ độ bền rìu, thêm khúc gỗ, bán gỗ đắt hơn (≤ 20 %) |

### Thể lực ⚡

- Tối đa **100** (+ kỹ năng, ≤ +60). Hồi **100 mỗi 10 phút** × (1 + % hồi từ kỹ năng/buff), ×1,2 khi "Ngủ ngon", **×3 khi nằm võng**.
- Tốn: câu 3, lưới 5, đào mỏ 3 (theo 0101), đốn gỗ 4, chèo ghe 4, đào kho báu 3, nấu 2, hái thảo dược 1, mỗi trận võ 8; chạy
  (Shift) tốn liên tục.

---

## 10. Chiến đấu

### 10.1 Võ đài — đánh tay đôi

- Trò đánh đối kháng 1v1 (võ sĩ chibi mặc võ phục theo môn và đai). Chiêu: **↓ → + đấm**, **↓ ← + nút**, **→ ↓ + đấm** (hất lên),
  **↓ → ↓ → + nút** (tuyệt chiêu); "→" luôn là hướng về phía đối thủ. Phím chéo kiểu cũ vẫn dùng được.
- **Bao cát · Luyện võ** (Chợ Lớn, Bãi đất): tập với bot.
- **4 võ đài ở Bãi đất trống:** chiếm đài, ra kèo cược, người kia nhận. Người thắng nhận **2 × cược − 5 %** (5 % bị đốt); hoà
  hoàn tiền. Giới hạn **2 trận cùng lúc mỗi phòng, 4 trên toàn server**. Mỗi trận 8 thể lực; mỗi hiệp 2 đói + 3 khát.
- Trận được server **phát lại từng khung hình** để xác định thắng thua; hai bên lệch nhau thì trận bị huỷ và hoàn tiền.
- **Bảng thành tích** ở Bãi đất. Thắng chỉ tính thành tựu/nhiệm vụ khi **có cược** hoặc là trận xếp hạng/thi đai.

### 10.2 Võ đường thầy Lâm (Chợ Lớn) — thi đai

- **7 môn:** Vovinam, Muay Thai, Karate, Taekwondo, Quyền Anh, Judo, Vịnh Xuân — mỗi môn một thầy và một bộ võ phục (được tặng
  khi nhập môn, không mua bán được).
- **Nhập môn: 2 000 xu.** Thi đai: bài **kata** (bấm theo nhịp, đạt % yêu cầu) rồi **đấu với võ sư bot**; thắng thì lên đai, thua
  thì chờ.

| Đai | Lệ phí | Học tối thiểu | Chờ sau khi trượt | Kata cần đạt |
|---:|---:|---:|---:|---:|
| 1 | 1 000 | 2 giờ | 30 phút | 60 % |
| 2 | 2 500 | 24 giờ | 2 giờ | 65 % |
| 3 | 5 000 | 48 giờ | 6 giờ | 70 % |
| 4 | 10 000 | 96 giờ | 24 giờ | 75 % |

### 10.3 Hầm ngầm (giải ngầm)

Vào bằng **Nắp cống** ở Chợ Lớn sau khi mở khoá (thầy Lâm có gợi ý; điều kiện mở khoá cụ thể: chưa xác minh). Gặp **Anh Tư Sẹo**.

| Chế độ | Luật |
|---|---|
| **Kèo ngầm** (xếp hạng) | mức cược 500 / 2 000 / 5 000; tối đa **10 trận/ngày**, cùng một đối thủ tối đa 2 trận/ngày; chờ ghép 5 phút, sẵn sàng 30 s |
| **Tầng hầm** | thang 10 tầng đấu bot, tối đa **6 lượt/ngày**, thưởng lần đầu vượt tầng |
| **Giải đêm** | cúp 4 người, mức 1 000 / 5 000; **3 giải/ngày** |
| Phí | 5 % tiền cược bị đốt |
| Điểm Elo | bắt đầu 1 000, sàn 800; K = 40 (10 trận đầu), sau đó 24 |
| Hạng | 🦐 Tép riu < 1 100 ≤ 🐟 Cá rô < 1 250 ≤ 🐠 Cá lóc < 1 400 ≤ 🦈 Cá mập < 1 550 ≤ 🐉 Thủy quái |
| Mùa | 28 ngày; danh hiệu mùa hiện dưới tên |
| Xem đấu | tối đa 6 người xem quanh Lồng đấu |

### 10.4 Đấu đội 2v2

Lập đội 2 người, thách đội khác: **best-of-3** trận PvP thường. Hai đội cùng đặt cược; người thắng nhận **cược × 0,95**; hết hạn
thì hoàn. Điểm đội ±16.

### 10.5 Boss

Đánh boss bằng nhịp: đòn cách nhau **≥ 0,9 s**; đánh trong 0,9–2 s sau đòn trước thì cộng combo (tối đa 5, +15 %/bậc). Sát
thương do server tính (40–60 ± combo); mỗi người chỉ được gây tối đa một % máu boss (nên phải đông người). Thưởng chia theo
công sức khi boss chết.

| Boss | Loại | Ở đâu / khi nào | Máu | Trần mỗi người | Quỹ | XP |
|---|---|---|---:|---:|---:|---:|
| Trâu Tinh | thế giới | Bãi đất, **12:00 và 20:00** | 40 000 | 20 % | 3 000 | 120 |
| Sói Ma | đêm | Bãi đất, **22:00** | 30 000 | 25 % | 2 000 | 100 |
| Vua Heo Rừng | tổ đội | Bãi đất, **≥ 3 người trong tổ đội** triệu hồi ở đấu trường; chờ 1 giờ **mỗi thành viên** | 24 000 | 25 % | 1 200 | 90 |
| Thủy Quái | mưa | Ao, khi phòng có mưa | 15 000 | 34 % | 900 | 70 |
| Người Tuyết | tuyết | Ao, khi có tuyết / đợt tuyết | 15 000 | 34 % | 900 | 70 |

- **Vua Heo Rừng: tối đa 2 lần có xu/ngày**; Thủy Quái + Người Tuyết chung **2 lần có xu/ngày**. Sau đó chỉ có XP. Boss giờ
  cố định không giới hạn.
- **Tổ đội** (phím 6): tối đa 4 người, chat nhóm, thấy nhau trên bản đồ nhỏ.

### 10.6 Hầm ngục (dungeon)

- Cổng ở **Bãi đất trống**, cho tổ đội. **Phí 100 xu.** 4 phòng: Dơi hang (300 máu ×3) → Rắn hang (450 ×3) → Nhện độc (700 ×2)
  → **Dơi Chúa** (3 000).
- Thưởng mỗi người được trả = **50 + 250 × số người được trả × phần sát thương của bạn** (đi nhóm không thiệt so với đi một
  mình). Tối đa **3 lần có thưởng/ngày**.

### 10.7 Thú cưng chiến đấu & cá chiến (Trại thú, phím 5)

| Mục | Giá trị |
|---|---|
| Máy ấp trứng | **1 500 xu/quả**; quả thứ 40 không ra Huyền thoại trở lên thì chắc chắn ra |
| Tỉ lệ | Thường 60 % (hamster, thỏ) · Hiếm 27 % (sóc, mèo) · Sử thi 10 % (chó, vẹt) · Huyền thoại 2,5 % · Thần thoại 0,5 % (mọi loài) |
| Nuôi | tối đa 12 thú; cấp tối đa 50; XP chăm sóc + đi theo tối đa 300/ngày; vuốt ve chờ 60 s, huấn luyện chờ 20 s (phí 100 + 50 × điểm) |
| Tiến hoá | lần 1: cấp 10 + thân thiết 40; lần 2: cấp 25 + thân thiết 80 (màu và hào quang mới) |
| Chiêu (mua) | Húc (miễn phí), Quẫy nước (cá), Thủ thế 250, Cắn 300, Liếm vết thương 500, Cuồng nộ 1 200, Tuyệt kỹ 3 000 |
| Đấu theo lượt | tối đa 30 lượt; đánh NPC tối đa 40 trận/ngày, **5 trận thắng có thưởng** |
| Thưởng NPC | Mèo hoang 24 · Chó cỏ 42 · Sóc núi 54 · Thầy Tư 90 · Cô Bảy 150 · Hổ thần 270 |
| PvP | cược tối đa 1 000; người thắng lấy quỹ trừ **5 %** |
| Cá chiến | cá từ **Hiếm (3)** trở lên giữ làm võ sĩ dưới nước, tối đa 6 con |

---

## 11. Đời sống

### 11.1 Sinh tồn

| Chỉ số | Luật |
|---|---|
| 🍚 Đói | giảm từ 100 về 0 sau **24 giờ online** (≈ 4,2/giờ), cộng thêm khi câu/đào/đánh |
| 💧 Khát | về 0 sau **16 giờ online** (≈ 6,25/giờ); nắng nóng ×2 |
| Chỉ giảm khi online | đúng |
| Dưới 25 | cảnh báo; ≤ 20 nhân vật than mỗi 10 s |
| Về 0 | đi chậm (×0,6), không câu/đào được ("too hungry/thirsty"); **10 phút liền thì ngất** |
| Ngất | lần thứ 1/2/3/4 trong ngày: **10 s / 5 phút / 15 phút / 1 giờ**; lần thứ 5: **kiệt sức tới 0h** (vẫn nghe nhạc được). Tỉnh dậy với 30 đói/30 khát |

- **Nắng nóng:** ≥ **35 °C** ngoài trời **10 phút** liền → sốc nhiệt. Trú trong tiệm/nhà hoặc nhảy ao bơi cho mát (miễn 10 phút).
- **Bơi:** phím **J** nhảy xuống ao, bơi chậm 0,5×. Phải **khởi động (K, 10 s)** — có hiệu lực 5 phút — nếu không có thể bị
  **chuột rút** 10 s; bạn bè tới gần (28 px) bấm E để cứu, không thì có thể ngất (đuối nước).
- **Mưa:** không che ô thì bị **ướt**; ướt lâu → **cảm lạnh 30 phút** (đi chậm 0,5×, cá ít cắn ×0,3). Cảm lạnh: ăn phở, bún bò,
  canh chua hoặc Thuốc giải cảm. **Sét**: ngoài trời lúc mưa bão 1 %/phút (chờ 30 phút giữa hai lần).
- **Ô dù** (Sạp ô dù, Chợ Lớn): giấy 300, vải 800, gập 2 000; tối đa 6 cái; bão làm ô mòn nhanh. Phím **U**.
- **Thời tiết thật** theo vị trí chủ phòng chọn (nắng, mưa, bão, sương mù, tuyết, ngày/đêm 18h–6h). Bão đóng bến câu.

### 11.2 Ăn uống — Nhà hàng Chợ Lớn

| Món | Giá | No | Khát | Buff |
|---|---:|---:|---:|---|
| Bánh mì thịt | 150 | 25 | — | tốc độ +5 % 15 phút |
| Cơm tấm sườn | 300 | 45 | — | sức mạnh +15 % 30 phút |
| Phở bò | 400 | 55 | 10 | hồi thể lực +30 % 30 phút |
| Bún bò Huế | 450 | 60 | 10 | sức mạnh +20 % 30 phút |
| Canh chua cá 🐟 | 500 | 40 | 25 | cá hiếm +6 % 30 phút |
| Cá chiên giòn 🐟 | 550 | 65 | — | cá hiếm +5 % 20 phút |
| Cá kho tộ 🐟 | 600 | 70 | — | cá hiếm +4 % 30 phút |
| Trà đá | 50 | — | 25 | hồi thể lực +10 % 15 phút |
| Nước mía | 120 | — | 40 | tốc độ +8 % 15 phút |
| Cà phê sữa đá | 150 | 5 | 35 | tốc độ +10 %, hồi thể lực +20 % 20 phút |
| Nước dừa | 180 | — | 55 | hồi thể lực +25 % 20 phút |
| Sinh tố bơ | 200 | 10 | 50 | cá hiếm +2 % 20 phút |

- Món 🐟: đưa **1 con cá của bạn** để giảm 20–80 %, nhưng giảm tối đa **3 × giá con cá**.
- Buff đang chạy giữ sức mạnh tới khi hết.

### 11.3 Nhà ở

| Chỗ ở | Giá | Ghi chú |
|---|---|---|
| **Nhà nghỉ Hoa Sen** | **300 xu/đêm, 6 000 xu/tháng** (trả trước tối đa 60 ngày) | Lên giường ngủ: hồi đầy thể lực; **"Ngủ ngon"** (1 lần/ngày) 24 giờ: đói/khát giảm chậm 30 %, đi nhanh +7 %, hồi thể lực ×1,2 |
| **Chung cư Phú Mỹ** | thuê **2 000 xu/30 ngày** hoặc mua **25 000** (bán lại cho thành phố 70 % = 17 500) | 12 căn; 60 món nội thất; khách gõ cửa được vào 3 giờ; quá hạn có 7 ngày ân hạn |
| **Lô đất + tự xây nhà** | đất **40 000** | 8 lô; vẽ thiết kế (sàn 10, tường 20, cửa 150, ô khác 100 xu/ô); tối đa 6 phòng, 80 món; **phí giữ đất 1 500/30 ngày**; trả lại đất được 20 000; bỏ phí 60 ngày bị thu hồi, chỉ hoàn 10 000 |
| **Cho thuê phòng** | 300–5 000 xu/30 ngày | chủ nhận 95 % |
| **Sàn bất động sản** | | rao bán nhà/đất giữa người chơi trong 50–300 % giá thẩm định, tin 14 ngày, phí 5 % |

- **Nội thất cô Năm**: giường (1 000–2 600), bàn, ghế, sofa, đèn, cây cảnh, thảm, kệ, tủ, tranh, **tivi 3 000** (phát hàng đợi
  riêng tới 30 bài), **tủ lạnh nhỏ 2 500 (cất 20 cá)**, **tủ lạnh lớn 6 000 (50 cá)**, sơn tường/sàn 300–400, **bể cá** (thả cá câu
  được, trang trí tối đa 4 món 100–400 xu; khách xem được).

### 11.4 Thời trang, salon

- **Tạo nhân vật** lần đầu (da, dáng nam/nữ, kiểu cơ thể…), sửa sau trong **👕 Tủ đồ (I)**. Nhân vật chibi.
- **Tiệm quần áo** (Chợ Lớn): áo, quần, mũ (thêm 10 kiểu), **phụ kiện** (khăn/dây chuyền, vòng tay/đồng hồ, kẹp tóc đeo cùng
  lúc), đồ truyền thống như áo bà ba, áo dài, kimono… (danh mục đầy đủ và giá từng món: chưa xác minh). Có thể chọn "Không mặc"
  áo/quần. Bán lại đồ thời trang được hoàn một phần (tỉ lệ: chưa xác minh).
- **Salon anh Ba**: cắt **300**, nhuộm **500**, cả hai **700**. Kiểu tóc theo dáng nam/nữ.
- Tặng đồ: chỉ người cùng phòng, 5 món/ngày.

### 11.5 Thú cưng đi theo (Tiệm thú cưng)

| Thú | Giá | Buff |
|---|---:|---|
| Hamster | 800 | buồn chậm gấp đôi |
| Thỏ | 1 500 | đi nhanh +3 % |
| Sóc | 2 500 | nhặt 5–30 xu mỗi 10 phút **khi chủ đang đi lại**, tối đa **150 xu/ngày** |
| Mèo | 3 000 | chủ đói/khát chậm 10 % |
| Chó | 3 500 | đi nhanh +5 % |
| Vẹt | 5 000 | thỉnh thoảng nhại câu chat |

Tối đa 6 thú; thức ăn 10–30 xu/bữa, đồ chơi 200–300, phụ kiện cho thú 150–400. (Thú từ máy ấp trứng: xem §10.7.)

### 11.6 Xe cộ (quầy Xe cộ, Chợ Lớn)

| Xe | Giá | 2D: đi Chợ Lớn | 3D: tốc độ |
|---|---:|---:|---:|
| Đi bộ | — | 15 s | ×1 |
| Xe đạp | 5 000 | 10 s | ×1,77 |
| Xe máy | 30 000 | 5 s | ×2,54 |
| Xe hơi | 150 000 | 2 s | ×3 |

Phím **R** lên/xuống xe (đang lái không tương tác được; xe hơi không vào Ao cá). Xe ôm 50 xu (chỉ 2D). Đi nhờ bạn bè.

### 11.7 Giải trí

- **Góc đánh bài** (sảnh): **Tiến lên** miền Nam (2–4 người, 20 s/lượt), **Chiếu Cào** (ba cây, cào cái, 2–17 người), **Poker**
  Texas Hold'em (2–6, 30 s/lượt), **Sòng Xì Dách**. Người ngồi đầu chọn mức **100 / 1 000 / 10 000 xu**. Không thu phế. **📜 Sổ
  luật** giải thích luật và tiền. Xì dách: thua tối đa bằng số đã giữ trên bàn.
- **Chụp ảnh** (phím 7): ẩn giao diện, tải về hoặc lưu album (tối đa 24 ảnh).
- **Võng** ở sảnh: nằm hồi thể lực ×3.
- Xu là **tiền chơi**: không mua bằng tiền thật, không đổi ra tiền thật.

---

## 12. Nhiệm vụ & tiến trình

### 12.1 Cốt truyện "Chuyện làng Sông Nhạc" (người mới)

Nhận việc trong hội thoại với NPC, làm xong quay lại báo. Server tự đếm từ dữ liệu có sẵn (chỉ tính việc làm **sau khi nhận**).
Một bước một lúc, theo thứ tự; báo xong phải đứng gần NPC. **Chị Hoa 🌸** dẫn đường trong hội thoại.

| # | Chương | Bước | Nhận ở | Việc | Báo ở | Thưởng |
|---|---|---|---|---|---|---|
| 1 | 1 · Về làng | Chào làng | Bác Ba Làng (Sảnh) | xuống Ao cá | cô Ba | 20 xu, 20 KN |
| 2 | 2 · Cần câu đầu tiên | Cần câu đầu tiên | cô Ba | ghé tiệm | chú Tư | 20 xu, 20 KN |
| 3 | 2 | Mua mồi | chú Tư | mua mồi ở tiệm | chú Tư | 20 xu, 20 KN, 2 thính cám |
| 4 | 2 | Con cá đầu tiên | chú Tư (dạy quăng & kéo) | câu 1 con | cô Ba | 30 xu, 30 KN |
| 5 | 3 · Phiên chợ bên ao | Bán cá cho cô Ba | cô Ba (giải thích thương lái) | bán ở Vựa cá ao | cô Ba | 30 xu, 30 KN, Xô nhỏ |
| 6 | 3 | Xô đầy cá | cô Ba | câu 3 con | cô Ba | 30 xu, 40 KN |
| 7 | 4 · Lá thư | Lá thư của bác Ba | Bác Ba Làng | đọc thư trong 📬 (có 2 thính) | Bác Ba | 30 xu, 30 KN |
| 8 | 5 · Ra đồng | Ra đồng | Bác Ba Làng | ra Đồng ruộng | anh Hai | 20 xu, 30 KN |
| 9 | 5 | Quà nhà nông | anh Hai | nhận quà tân nông | anh Hai | 30 xu, 40 KN |
| 10 | 6 · Lên Chợ Lớn | Lên Chợ Lớn | anh Hai | bán cá ở Vựa cá Chợ Lớn | chú Hai | 50 xu, 50 KN |
| 11 | 6 | Người làng thứ thiệt | chú Hai | về Sảnh | Bác Ba Làng | 50 xu, 60 KN |

Tổng: **330 xu + 370 KN + 4 thính cám + Xô nhỏ**. Người chơi cũ (đã xong n_lang_1 hoặc ≥ 10 lần câu) được đóng chuỗi, không
nhận thưởng.

### 12.2 Nhiệm vụ ngày / tuần / NPC / khám phá (phím 2)

- **Ngày:** 4 nhiệm vụ mỗi ngày (làm mới 0h), rút từ: câu 5 con (40 xu), câu 12 con (80), bán cá 150 xu (40), bán lúa 5 000 xu (50),
  bán nông sản 5 000 xu (50), bán cua ốc 300 xu (40), đánh 2 trận (40), ăn ở quán Chợ Lớn (25).
- **Tuần:** 3 nhiệm vụ (làm mới thứ Hai): 10 nhiệm vụ ngày (300), câu 60 con (300), thắng 5 trận (350), bán cá 2 000 xu (300),
  quà đăng nhập 5 ngày (250).
- **Chuỗi NPC của Bác Ba** (cũ, vẫn còn): "Chuyện làng" n_lang_1…6 (60–250 xu) và "Nghề mới" n_nghe_1…5: thu hoạch 5 lần (100),
  đào 10 quặng (150), chế tạo 1 món (150), pha 2 lọ thuốc (200), đánh trúng boss 20 lần (300).
- **Khám phá:** lần đầu tới Ao (20), Đồng (20), Chợ Lớn (30), Khu nhà (40), Bãi đất (40), Hầm ngầm (60); đủ 6 vùng (200).
- **Cả làng (company):** một mục tiêu chung (câu 500 cá, kiếm 20 000 xu bán cá, 10 000 xu bán lúa, 150 trận võ…). Khi đầy:
  **3 000 xu chia theo công sức** — ai góp ≥ 1 % mục tiêu nhận phần của mình, tối đa **300 xu/người**.

### 12.3 Cấp độ, XP, thưởng lên cấp

| Mục | Giá trị |
|---|---|
| Cấp tối đa | 99 |
| XP để đạt cấp L | 100·(L−1) + 25·(L−1)·(L−2) |
| Thưởng lên cấp | **20 × L** xu; cấp chia hết cho 5: **60 × L** (cấp 1→99 tổng ≈ 137 000 xu) |
| Trần XP/ngày | câu cá 1 500 · kiếm tiền 400 · đánh nhau 400 · thưởng 1 500 |
| Bảng xếp hạng | Cấp độ, Giàu nhất, Nhiều cá nhất, Cá to nhất, Nhà nông, Thắng đấu |

"Kiếm bằng sức lao động" **không tính** điểm danh, quà đăng nhập, thưởng bài hát, sóc nhặt, và bán lại xe/thời trang.

### 12.4 Quà đăng nhập & điểm danh

- **Chuỗi 7 ngày:** 20 → 30 → 40 → 50 → 60 → 80 → **150 xu**.
- Điểm danh lần vào game đầu tiên trong ngày: +20 xu.

### 12.5 Thành tựu & bộ sưu tập (Hồ sơ, phím 1)

| Thành tựu | Điều kiện | Thưởng | Danh hiệu |
|---|---|---:|---|
| Mẻ cá đầu tiên | 1 cá | 50 | |
| Tay câu khá | 100 cá | 500 | Thợ câu |
| Lão ngư | 1 000 cá | 5 000 | Lão ngư |
| Biết mặt cá | 6 loài | 300 | |
| Nhà sưu tầm | 12 loài | 2 000 | Nhà sưu tầm cá |
| Cá to | cá ≥ 5 kg | 500 | |
| Thủy quái | cá ≥ 20 kg | 3 000 | Săn thủy quái |
| Có của ăn của để | kiếm 10 000 xu | 300 | |
| Đại gia | kiếm 1 000 000 xu | 5 000 | Đại gia |
| Lão nông | bán nông sản 50 000 xu | 2 000 | Lão nông |
| Trận thắng đầu | 1 trận thắng | 100 | |
| Võ sĩ | 50 trận thắng | 2 000 | Võ sĩ |
| Vô địch | 500 trận thắng | 5 000 | Vô địch |
| Dân làng | cấp 10 | 1 000 | Dân làng kỳ cựu |
| Huyền thoại | cấp 30 | 3 000 | Huyền thoại |

Danh hiệu hiện dưới tên: `Lv12 Tên «Danh hiệu»`.

**Fishdex:** đủ cá Thường (200 xu), cá Khá (500), cá Hiếm (1 000), cá Quý + Huyền thoại (3 000), **trọn bộ** (5 000).

---

## 13. Hòm thư, code quà, tin tức, góp ý

### Hòm thư 📬

- Đồ và xu từ **giao dịch**, **chợ người chơi / sạp**, **đấu giá**, **quà admin** và **code quà** đều tới hòm thư; bấm **Nhận**
  (hoặc **Nhận tất cả**). Hết chỗ chứa (xô đầy, hộp mồi đầy, quá 99, đã có đồ thời trang đó) thì thư nằm lại.
- Cá trong thư được giữ hộ (không bán/dùng được cho tới khi nhận).
- **Hết hạn 30 ngày:** thư giao dịch chưa nhận trả về người gửi một lần (5 % đã đốt vẫn mất); thư khác bị huỷ.

### Code quà

- Ô nhập code trong hòm thư. Mỗi code mỗi tài khoản 1 lần, có giới hạn lượt và thời gian. Quà tới bằng thư.
- Sai **10 lần trong 1 giờ** → khoá ô nhập tới hết giờ đó.

### Báo Làng & tin tức

- **Sạp báo** ở sảnh: tab 📢 Thông báo / 🗞️ Tin làng; tin mới hiện popup trong 24 giờ. Bản tin thay đổi dạng thẻ (trước/sau).

### Góp ý

- Nút **💬 Góp ý** (lỗi / đề xuất / khác), tối đa 10 lần/giờ; chủ game đọc trong /admin.

---

## 14. Chống gian lận (tóm tắt cho chủ game)

| Lớp | Cách làm |
|---|---|
| **Server quyết định** | Mọi kết quả (cá, cân nặng, giá, sâu bệnh, sản lượng, bài, xu) do server tính. |
| **Phát lại (replay)** | Kéo cá, quăng lưới, gặt lúa, bắt cua, bắn ná, chèo ghe, đào kho báu, đào mỏ, đốn gỗ, nấu ăn, kata, trận võ: trình duyệt chỉ gửi các lần bấm; server chạy lại với cùng hạt ngẫu nhiên để xác định kết quả. |
| **Thời gian tối thiểu** | Không thắng nhanh hơn mốc (vd. thời gian kéo cá tối thiểu). |
| **`client_tamper`** | Trình duyệt báo thông số minigame (vùng xanh, độ khó, thời gian) khác với server → lỗi nặng, mất lượt câu. |
| **Vị trí** | Server ghi vị trí; tương tác phải đứng gần; di chuyển nhanh hơn cho phép bị từ chối. |
| **Giới hạn lượt gọi** | > 900 lệnh/phút: ghi nhận; ≥ 1 200/phút: chặn tới hết phút (admin chỉnh được). |
| **Điểm bot (im lặng)** | Chơi ≥ 6 giờ liền không nghỉ 15 phút (+2, ≥ 10 giờ +4), hoạt động ≥ 16/24 giờ (+2, ≥ 20 +4), nhịp bấm quá đều (+2/+3), hay vượt rate (+1), im lặng 7 ngày mà online nhiều (+1). Điểm ≥ 6 → chỉ nhận **50 %** thu nhập từ game; ≥ 9 → **20 %**. Người chơi không thấy; admin xem và miễn trừ 7 ngày được. |
| **Gậy (strike)** | Chế độ **Chỉ ghi nhận** (mặc định) hoặc **Thi hành**. Thi hành: lỗi nặng lần 1 → cảnh báo + **khoá 5 phút** câu cá/ruộng/chợ/tiệm; lần 2 trong 30 ngày → **cấm vĩnh viễn**. Root không bao giờ bị. |
| **Xoá dữ liệu** | Admin xoá dữ liệu game của tài khoản bị cấm (xu, đồ, cá, đất…). |
| **Danh sách đen** | Vẫn chơi bình thường nhưng **mỗi lần được cộng xu chỉ +1**. **Tự động**: 8 lỗi nặng trong 30 ngày trên ≥ 2 ngày khác nhau. |
| **Khác** | Thông đồng giao dịch, kèo võ một chiều, thống kê thắng/hoàn hảo bất thường, phiên bản client tối thiểu. Không lưu IP. |

---

## 15. Trang quản trị /admin

Chỉ tài khoản **root**. Các tab:

| Tab | Dùng để |
|---|---|
| **Thống kê** | Số phòng, tài khoản, góp ý mới… |
| **Phòng** | Xem, xoá phòng |
| **Tài khoản** | Xem, khoá/mở khoá, xoá tài khoản (không hiện email) |
| **Hòm thư** | Hộp góp ý của người chơi (tên tab: chưa xác minh là góp ý hay thư) |
| **Bản tin** | Đăng/sửa tin Báo Làng |
| **Kinh tế** | Tổng xu lưu hành và thay đổi theo ngày, xu vào/ra theo lý do, phân vị ví, top 10 ví, thương lái hôm nay, **các núm `econ_params`** (đổi có hiệu lực ngay) |
| **Chống gian lận** | Chế độ ghi nhận/thi hành, hồ sơ vi phạm, bằng chứng, xoá dữ liệu, danh sách đen, điểm bot, giới hạn lượt gọi, thống kê bất thường, replay trận võ, cờ bất động sản |
| **Quà & code** | Gửi quà (≤ 1 000 000 xu + tối đa 8 món) cho danh sách tên hoặc mọi người; tạo, xem, tắt code quà |

> **Mẹo cho chủ game:** Mục tiêu là dòng xu ròng mỗi ngày khoảng **0–1 %** tổng xu lưu hành. Người chơi thường kiếm quá ít →
> tăng `fish_mult` hoặc `npc_full` 10–20 %; tổng xu tăng hơn 2 %/ngày → giảm xuống.
