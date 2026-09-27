/** Bản tin cập nhật 25–28/9 (Báo Làng): one swipeable card per change, static data shown in the news stand. */

export const CHANGELOG_ID = "changelog-2026-09-28";
export const CHANGELOG_TITLE = "Bản tin cập nhật 25–28/9";
/** Folder under `public/` holding the bulletin's pictures. */
export const CHANGELOG_IMG_DIR = "/news/2026-09-28";

export type ChangelogSection =
  | "character" | "fishing" | "farm" | "market" | "survival" | "pets" | "housing" | "fun" | "system";

export const CHANGELOG_SECTIONS: readonly { id: ChangelogSection; label: string }[] = [
  { id: "character", label: "👕 Nhân vật & thời trang" },
  { id: "fishing", label: "🎣 Câu cá" },
  { id: "farm", label: "🌾 Nông trại" },
  { id: "market", label: "🏮 Chợ Lớn & xe" },
  { id: "survival", label: "🌦️ Sinh tồn & thời tiết" },
  { id: "pets", label: "🐾 Thú cưng" },
  { id: "housing", label: "🏠 Nhà ở" },
  { id: "fun", label: "🃏 Giải trí" },
  { id: "system", label: "⚙️ Hệ thống" },
];

interface CardBase {
  id: string;
  section: ChangelogSection;
  emoji: string;
  title: string;
  /** Day(s) it landed, e.g. "27/9". */
  date: string;
  /** Short how-to steps (≤ 4). */
  howTo: string[];
  tags: string[];
}

/** A feature that existed before 25/9 and looks or works differently now. */
export interface ChangedCard extends CardBase {
  kind: "changed";
  /** Heading of the "before" column; default OLD_LABEL. */
  oldLabel?: string;
  oldText: string;
  newText: string;
  /** File names inside CHANGELOG_IMG_DIR. */
  oldImg?: string;
  newImg?: string;
}

/** A feature that did not exist before 25/9. */
export interface NewCard extends CardBase {
  kind: "new";
  purpose: string;
  img?: string;
}

export type ChangelogCard = ChangedCard | NewCard;

/** The first shipped game build (25–26/9) is the "before" of most changed cards. */
export const OLD_LABEL = "Bản đầu (25–26/9)";
export const NEW_LABEL = "Bây giờ";

export function changelogImg(file: string): string {
  return `${CHANGELOG_IMG_DIR}/${file}`;
}

export const CHANGELOG_2026_09_28: readonly ChangelogCard[] = [
  {
    id: "game-mode", section: "system", kind: "changed", emoji: "🎮", title: "Chế độ game", date: "25/9",
    oldLabel: "Trước 25/9",
    oldText: "Chỉ có phòng nghe nhạc: xếp hàng bài, lời bài hát, lịch sử phát.",
    newText: "Nhạc vẫn phát, và cả làng thành thế giới game: sảnh, ao, ruộng, Chợ Lớn, khu nhà.",
    newImg: "new-hall-day.png",
    howTo: ["Trong phòng nhạc, bấm nút 🎮 Chế độ game", "Đi bằng phím mũi tên / WASD hoặc chạm", "Bấm E để tương tác"], tags: ["game"],
  },
  // ── Nhân vật & thời trang ──
  {
    id: "chibi", section: "character", kind: "changed", emoji: "🧑", title: "Nhân vật chibi mới", date: "27/9",
    oldText: "Người que nhỏ, ít chi tiết.",
    newText: "Dáng chibi đầu to, mặt rõ, áo dài; tóc ngắn không còn lắc lư khi đi.",
    oldImg: "old-character-pair.png", newImg: "new-character-pair.png",
    howTo: ["Vào game là thấy ngay", "Mở 👕 Tủ đồ để ngắm dáng mới"], tags: ["nhân vật"],
  },
  {
    id: "wardrobe", section: "character", kind: "changed", emoji: "👕", title: "Tủ đồ & icon đồ", date: "27/9",
    oldText: "Icon đồ đơn giản, khó phân biệt.",
    newText: "Icon vẽ lại theo từng món, xem trước ngay trên người.",
    newImg: "new-garments.png",
    howTo: ["Bấm 👕 Tủ đồ trên HUD", "Chọn món để mặc thử", "Bấm Lưu"], tags: ["tủ đồ"],
  },
  {
    id: "hair-gender", section: "character", kind: "changed", emoji: "💇", title: "Kiểu tóc theo dáng nam / nữ", date: "28/9",
    oldText: "Chọn tóc ngay trong trình tạo nhân vật, kiểu nào cũng được.",
    newText: "Tóc đổi ở Salon Chợ Lớn. Nam: đầu đinh, undercut… Nữ: ngang vai, tóc dài, đuôi ngựa, tết, búi… Chung: ngắn, xoăn, mái bằng.",
    newImg: "new-hair-by-gender.png",
    howTo: ["Ra Chợ Lớn, vào Salon anh Ba", "Chọn kiểu tóc và màu", "Cắt 300 xu, nhuộm 500 xu, cả hai 700 xu"], tags: ["tóc", "salon"],
  },
  {
    id: "fashion2", section: "character", kind: "new", emoji: "💍", title: "Thời trang 2: phụ kiện, mũ, đồ lót", date: "27/9",
    purpose: "Đeo cùng lúc khăn/dây chuyền, vòng tay/đồng hồ và kẹp tóc; thêm 10 kiểu mũ mới.",
    img: "new-accessories.png",
    howTo: ["Vào tiệm quần áo ở Chợ Lớn", "Tab 💍 Phụ kiện hoặc Mũ", "Mua rồi mặc trong 👕 Tủ đồ", "Có thể chọn “Không mặc” áo/quần"], tags: ["thời trang"],
  },

  // ── Câu cá ──
  {
    id: "pond", section: "fishing", kind: "new", emoji: "🎣", title: "Ao câu cá & tiền xu", date: "25/9",
    purpose: "Câu cá miền Tây, bán lấy xu để mua đồ tốt hơn.",
    img: "new-pond.png",
    howTo: ["Đi theo biển bến đò ở sảnh xuống Ao cá", "Đào giun làm mồi", "Quăng cần, giữ để kéo cá", "Bán cá ở Vựa cá cô Ba"], tags: ["ao", "xu"],
  },
  {
    id: "cast-anim", section: "fishing", kind: "changed", emoji: "🪝", title: "Hoạt ảnh câu cá", date: "27/9",
    oldText: "Cần câu đứng yên, không có động tác.",
    newText: "Nhân vật cầm cần, giật cá khi cắn câu; quay lưng thì cần ra phía sau.",
    oldImg: "old-fishing-cast.png", newImg: "new-fishing-cast.png",
    howTo: ["Ra ao và quăng cần như cũ"], tags: ["câu cá"],
  },
  {
    id: "net-arrows", section: "fishing", kind: "changed", emoji: "🥅", title: "Quăng chài: mũi tên kiểu Audition", date: "28/9",
    oldText: "Minigame kéo co.",
    newText: "Bấm theo chuỗi mũi tên đúng nhịp; trượt nhịp thì cá xổng.",
    newImg: "new-fishing-rods-net.png",
    howTo: ["Mua chài ở tiệm chú Tư", "Đứng ở mép ao, quăng chài", "Bấm đúng mũi tên theo nhịp"], tags: ["chài"],
  },
  {
    id: "rods", section: "fishing", kind: "new", emoji: "🛠️", title: "Độ bền cần & lưới", date: "27/9",
    purpose: "Cần câu mòn dần, hỏng thì phải sửa; thêm cần sợi thủy tinh, cần cao thủ, chài và mồi vàng.",
    img: "new-fishing-rods-net.png",
    howTo: ["Xem thanh độ bền trên thẻ cần", "Tiệm chú Tư: “Sửa cần” (30% giá cần)", "Chài nhỏ 20 lần quăng, chài lớn 30 lần"], tags: ["cần", "chài"],
  },
  {
    id: "pond-life", section: "fishing", kind: "new", emoji: "🐟", title: "Ao sống động", date: "27/9",
    purpose: "Câu được từ bờ (cá ít cắn hơn ở bến), cá lớn có thể lôi bạn xuống ao, cá nhảy trên mặt nước.",
    img: "new-swim.png",
    howTo: ["Đứng sát mép nước để câu bờ", "Rơi xuống ao thì bơi vào bờ", "Cá lớn: coi chừng mất cần"], tags: ["ao", "bơi"],
  },

  // ── Nông trại ──
  {
    id: "field", section: "farm", kind: "new", emoji: "🌾", title: "Ruộng lúa & đất", date: "25/9",
    purpose: "Trồng lúa nước đủ vụ (khoảng 3 ngày thật), thuê hoặc mua đất.",
    img: "new-field.png",
    howTo: ["Từ sảnh đi ra Đồng ruộng", "Thuê một thửa đất", "Làm theo Sổ tay nhà nông", "Gặt, phơi và bán lúa"], tags: ["lúa", "đất"],
  },
  {
    id: "tools-crops", section: "farm", kind: "new", emoji: "🌽", title: "Nông cụ & hoa màu", date: "25/9",
    purpose: "Liềm, máy gặt, bình phun và cây hoa màu mới.",
    howTo: ["Mua liềm, bình phun ở tiệm anh Hai", "Thuê máy gặt ở HTX chú Tám", "Gặt lúa bằng minigame liềm"], tags: ["nông cụ"],
  },
  {
    id: "crabs", section: "farm", kind: "new", emoji: "🦀", title: "Bắt cua, nhặt ốc", date: "26/9",
    purpose: "Bắt cua ở hang ven kênh, nhặt ốc; cấy lúa thành minigame.",
    img: "new-crab-minigame.png",
    howTo: ["Ra hang cua / bãi ốc ven kênh", "Chơi minigame bắt cua", "Bán cho cô Út"], tags: ["cua", "ốc"],
  },
  {
    id: "rats", section: "farm", kind: "new", emoji: "🐀", title: "Mùa chuột: ná & chó giữ trại", date: "26/9",
    purpose: "Chuột ra ăn ruộng chín; bắn ná hoặc nhờ chó cỏ đuổi chuột.",
    img: "new-dog-rats.png",
    howTo: ["Mua ná và đạn đất sét", "Nhắm rồi thả để bắn chuột", "Nhận nuôi chó cỏ, cho ăn thức ăn chó"], tags: ["chuột", "ná", "chó"],
  },

  // ── Chợ Lớn & xe ──
  {
    id: "market", section: "market", kind: "new", emoji: "🏮", title: "Chợ Lớn: nhà hàng, tiệm quần áo", date: "27/9",
    purpose: "Ăn uống hồi đói/khát, mua đồ; món cá được giảm giá nếu đưa cá của bạn.",
    img: "new-market.png",
    howTo: ["Từ sảnh đi cổng ra Chợ Lớn", "Nhà hàng: chọn tab Ăn / Uống", "Món 🐟: đưa 1 con cá để giảm 20–80%"], tags: ["chợ", "ăn uống"],
  },
  {
    id: "road", section: "market", kind: "new", emoji: "🛵", title: "Xe cộ & đường ra chợ", date: "27/9",
    purpose: "Đi chợ nhanh hơn bằng xe; vựa chợ mua cá và nông sản giá +20%.",
    img: "new-road-travel.png",
    howTo: ["Mua xe ở quầy Xe cộ (Chợ Lớn)", "Đi bộ 15 s, xe đạp 10 s, xe máy 5 s, xe hơi 2 s", "“Bỏ qua” tốn 20 xu"], tags: ["xe", "vựa"],
  },
  {
    id: "ride", section: "market", kind: "new", emoji: "🚲", title: "Lái xe trong map", date: "27/9",
    purpose: "Chạy xe khắp bản đồ, nhanh hơn đi bộ.",
    img: "new-ride-vehicles.png",
    howTo: ["Bấm 🚲 Lên xe hoặc phím R", "Đang lái thì không tương tác được", "Xe hơi không vào được Ao cá"], tags: ["xe"],
  },
  {
    id: "lift", section: "market", kind: "new", emoji: "🤝", title: "Đi nhờ xe", date: "28/9",
    purpose: "Ngồi sau xe bạn bè để đi cùng.",
    img: "new-passenger.png",
    howTo: ["Đứng sát người đang lái xe", "Xin đi nhờ, chờ họ đồng ý", "Xuống xe khi tới nơi"], tags: ["xe"],
  },
  {
    id: "shops3", section: "market", kind: "new", emoji: "🏪", title: "3 cửa hàng mới ở Chợ Lớn", date: "28/9",
    purpose: "Nội thất cô Năm, Nhà nghỉ Hoa Sen và Tiệm thú cưng thành nhà riêng ở dãy phía bắc.",
    img: "new-market-furniture.png",
    howTo: ["Ra Chợ Lớn, đi về phía đông", "Vào quầy của từng tiệm"], tags: ["chợ"],
  },

  // ── Sinh tồn & thời tiết ──
  {
    id: "vitals", section: "survival", kind: "new", emoji: "🍚", title: "Đói & khát", date: "27/9",
    purpose: "Nhân vật cần ăn uống; về 0 thì đi chậm, 10 phút liền thì ngất.",
    howTo: ["Xem thanh 🍚 / 💧 trên HUD", "Ăn uống ở nhà hàng Chợ Lớn", "Chỉ giảm khi đang online"], tags: ["sinh tồn"],
  },
  {
    id: "weather", section: "survival", kind: "new", emoji: "⛅", title: "Thời tiết thật", date: "27/9",
    purpose: "Nắng, mưa, bão, sương mù, ngày/đêm theo vị trí thật của chủ phòng.",
    img: "new-weather-hall-grid.png",
    howTo: ["Chủ phòng chọn vị trí", "⚙️ Cài đặt cá nhân: hiệu ứng mức 0–4", "Mức thấp nhẹ máy hơn"], tags: ["thời tiết"],
  },
  {
    id: "heat", section: "survival", kind: "new", emoji: "🥵", title: "Sốc nhiệt, bơi, chuột rút", date: "27/9",
    purpose: "Nắng từ 35°C ngoài trời 10 phút sẽ sốc nhiệt; nhảy ao bơi cho mát, nhớ khởi động kẻo chuột rút.",
    img: "new-heat.png",
    howTo: ["Trú trong tiệm / nhà hàng", "Khởi động trước khi nhảy ao", "Chuột rút: bạn bè đến gần bấm E để cứu"], tags: ["nắng", "bơi"],
  },
  {
    id: "rain", section: "survival", kind: "new", emoji: "☂️", title: "Ô dù, mưa, cảm lạnh, sét", date: "28/9",
    purpose: "Mưa mà không che ô sẽ ướt, lâu thì cảm lạnh; sét có thể đánh ngoài trời.",
    img: "new-rain.png",
    howTo: ["Mua ô (giấy 300, vải 800, gập 2000 xu)", "Cầm ô khi trời mưa", "Cảm lạnh: ăn phở, bún bò, canh chua"], tags: ["mưa"],
  },

  // ── Thú cưng ──
  {
    id: "pets", section: "pets", kind: "new", emoji: "🐾", title: "Thú cưng", date: "28/9",
    purpose: "Nuôi thú cưng đi theo bạn, cho ăn, chơi, mặc đồ; vẹt bay theo người.",
    img: "new-pets.png",
    howTo: ["Vào Tiệm thú cưng ở Chợ Lớn", "Mua thú (tối đa 6)", "Cho ăn, chơi, đổi tên, mặc đồ"], tags: ["thú cưng"],
  },

  // ── Nhà ở ──
  {
    id: "motel", section: "housing", kind: "new", emoji: "🛏️", title: "Nhà nghỉ & giấc ngủ", date: "28/9",
    purpose: "Thuê phòng nghỉ để ngủ hồi sức.",
    img: "new-motel.png",
    howTo: ["Vào Nhà nghỉ Hoa Sen ở Chợ Lớn", "Thuê phòng", "Lên giường để ngủ"], tags: ["nhà"],
  },
  {
    id: "apartments", section: "housing", kind: "new", emoji: "🏢", title: "Khu nhà, căn hộ, nội thất", date: "28/9",
    purpose: "Thuê hoặc mua căn hộ, bày nội thất, TV, tủ lạnh cất cá.",
    img: "new-apartments.png",
    howTo: ["Đi đường cuối Chợ Lớn ra Khu nhà", "Thuê hoặc mua một căn", "Mua nội thất ở tiệm cô Năm rồi đặt vào nhà"], tags: ["nhà"],
  },
  {
    id: "land", section: "housing", kind: "new", emoji: "🏗️", title: "Đất & xây nhà, cho thuê", date: "28/9",
    purpose: "Mua lô đất, tự xây nhà, cho người khác thuê phòng.",
    img: "new-land.png",
    howTo: ["Chọn lô đất ở Khu nhà", "Thiết kế và xây nhà", "Đăng phòng cho thuê"], tags: ["đất"],
  },
  {
    id: "estate", section: "housing", kind: "new", emoji: "📈", title: "Sàn bất động sản", date: "28/9",
    purpose: "Rao bán và mua lại nhà, đất giữa người chơi.",
    img: "new-realestate.png",
    howTo: ["Mở sàn bất động sản", "Đăng bán trong khung giá cho phép", "Hoặc mua tin đang rao"], tags: ["nhà", "đất"],
  },

  // ── Giải trí ──
  {
    id: "cards", section: "fun", kind: "new", emoji: "🃏", title: "Góc đánh bài", date: "26/9",
    purpose: "Tiến lên, Cào, Poker, Xì dách: đặt cược bằng xu giữa người chơi với nhau, không thu phế.",
    howTo: ["Tới Góc đánh bài ở sảnh", "Ngồi vào bàn, chọn mức cược", "Xem 📜 Sổ luật nếu chưa rành"], tags: ["bài"],
  },
  {
    id: "hall", section: "fun", kind: "changed", emoji: "🎶", title: "Sảnh nhạc", date: "28/9",
    oldText: "Góc đánh bài 3 bàn, chưa có đèn đêm, võng chỉ để trang trí.",
    newText: "Góc đánh bài rộng thêm bàn, sạp báo, đèn sáng về đêm, võng nằm được.",
    oldImg: "old-hall.png", newImg: "new-hall.png",
    howTo: ["Tới võng, bấm E “Nằm võng”", "Bấm Dậy hoặc đi để đứng lên"], tags: ["sảnh", "võng"],
  },

  // ── Hệ thống ──
  {
    id: "hud", section: "system", kind: "changed", emoji: "🧭", title: "HUD gọn + bản đồ thành phố", date: "28/9",
    oldText: "HUD nhiều nút chữ, chiếm chỗ.",
    newText: "HUD 3 hàng icon gọn; cột bản đồ thành phố ở mỗi map.",
    howTo: ["Rê chuột lên icon để xem tên", "Tới cột bản đồ, bấm “Xem bản đồ thành phố”"], tags: ["HUD", "bản đồ"],
  },
  {
    id: "popups", section: "system", kind: "changed", emoji: "🪟", title: "Popup rộng hơn", date: "28/9",
    oldText: "Cửa sổ hẹp, phải cuộn nhiều.",
    newText: "Cửa sổ tiệm và bảng rộng hơn trên máy tính.",
    howTo: ["Mở bất kỳ tiệm nào để thấy"], tags: ["giao diện"],
  },
  {
    id: "anticheat", section: "system", kind: "new", emoji: "🛡️", title: "Chống gian lận", date: "25/9",
    purpose: "Chặn sửa xu/đồ bằng DevTools; lần đầu cảnh báo và khóa 5 phút, tái phạm bị cấm.",
    howTo: ["Chơi bình thường là không sao"], tags: ["an toàn"],
  },
  {
    id: "news", section: "system", kind: "new", emoji: "📰", title: "Báo Làng", date: "28/9",
    purpose: "Sạp báo đọc thông báo và tin lớn trong làng; tin mới hiện popup trong 24 giờ.",
    howTo: ["Tới sạp báo ở sảnh", "Tab 📢 Thông báo / 🗞️ Tin làng"], tags: ["tin tức"],
  },
];
