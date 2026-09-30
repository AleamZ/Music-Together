// "Chuyện làng Sông Nhạc" — the story chain's dialogue (0114_story_quests.sql). Pure data: per step what its giver says
// when offering it, what the NPCs say while it is under way, and what the turn-in NPC says when it is handed in; per NPC
// a little idle chatter. tests/unit/story-scripts.test.ts checks every step has all three and every speaker exists.
import type { SpeakerId, StoryNpcId } from "./npcs";

export interface DialogueLine {
  speaker: SpeakerId;
  text: string;
}

export interface StoryStepDef {
  id: string;
  chapter: number;
  /** Lines the giver says to offer it; the last one gets the choice "Nhận lời" / "Để sau". */
  offer: DialogueLine[];
  /** Said by the giver or the turn-in NPC while it is under way (a hint of how). */
  progress: DialogueLine[];
  /** Said by the turn-in NPC when it is handed in. */
  turnIn: DialogueLine[];
  /** The tracker's "how" line under the objective. */
  hint: string;
  /** s09: accepting (or talking while it is under way) claims the farm's newcomer gift (claim_farm_gift, 0013). */
  claimFarmGift?: true;
}

export const CHAPTERS: Readonly<Record<number, string>> = {
  1: "Chương 1 · Về làng",
  2: "Chương 2 · Cần câu đầu tiên",
  3: "Chương 3 · Phiên chợ bên ao",
  4: "Chương 4 · Lá thư",
  5: "Chương 5 · Ra đồng",
  6: "Chương 6 · Lên Chợ Lớn",
};

const L = (speaker: SpeakerId, text: string): DialogueLine => ({ speaker, text });

export const STORY_STEPS: readonly StoryStepDef[] = [
  {
    id: "s01_chao", chapter: 1,
    offer: [
      L("hoa", "A, bạn mới về làng hả? Mình là Hoa, ở làng Sông Nhạc này từ nhỏ. Để mình dẫn bạn đi một vòng nha!"),
      L("hoa", "Trước tiên phải chào bác Ba Làng — bác là trưởng làng đó."),
      L("bac_ba_lang", "Ồ, người mới! Chào cháu, chào cháu. Làng mình nghèo mà vui: có ao cá, có đồng lúa, có Chợ Lớn."),
      L("bac_ba_lang", "Muốn sống được ở đây thì phải biết câu cá trước. Cháu xuống Ao cá chào cô Ba giùm bác nhé."),
      L("hoa", "Đi bằng phím mũi tên hoặc W A S D (trên điện thoại thì kéo cần điều khiển). Tới gần ai thì bấm E hoặc chạm vào họ để nói chuyện."),
    ],
    progress: [
      L("hoa", "Ao cá ở phía nam Sảnh — đi xuống biển \"Bến câu cá\". Cô Ba đứng ở Vựa cá, góc trên bên phải ao."),
    ],
    turnIn: [
      L("co_ba", "Ủa, mặt lạ quá! Bác Ba gửi con xuống hả? Chào con, cô là cô Ba, cô thu mua cá ở cái vựa này."),
      L("co_ba", "Ở làng này ai cũng câu cá hết trơn. Vậy mà con chưa có cần hả? Để cô tính."),
    ],
    hint: "Đi tới Ao cá (phía nam Sảnh), bấm E cạnh cô Ba ở Vựa cá.",
  },
  {
    id: "s02_can", chapter: 2,
    offer: [
      L("co_ba", "Chú Tư ở tiệm đồ câu ngay dưới đây nè. Người mới tới làng, chú cho mượn cây cần gỗ không lấy tiền."),
      L("co_ba", "Con ghé chú Tư lấy cần đi, rồi quay lại đây cô chỉ cách bán cá."),
    ],
    progress: [
      L("hoa", "Tiệm đồ câu của chú Tư ở ngay phía dưới Vựa cá, cùng bờ ao."),
    ],
    turnIn: [
      L("chu_tu", "Người mới hả? Nè, cây cần gỗ này chú để sẵn cho người mới — có lưỡi, có dây, có phao lông gà, xài liền được."),
      L("chu_tu", "Cần gỗ không cần gắn đồ, nó nằm sẵn trong túi con rồi. Mai mốt khá hơn thì mua cần tre, cần carbon, gắn lưỡi với dây riêng."),
      L("hoa", "Túi đồ mở bằng phím B (hoặc nút 🎒). Cần gỗ đã được gắn sẵn rồi đó!"),
    ],
    hint: "Tiệm đồ câu chú Tư ở ngay dưới Vựa cá. Bấm E cạnh chú.",
  },
  {
    id: "s03_moi", chapter: 2,
    offer: [
      L("chu_tu", "Có cần mà không có mồi thì cá nó cười cho. Trùn đất thì con tự đào được, nhưng cá kén ăn lắm."),
      L("chu_tu", "Mua thử ít mồi tép ở tiệm chú đi — rẻ thôi. Cá lóc, cá tra khoái mồi tép lắm."),
    ],
    progress: [
      L("chu_tu", "Bấm E ở quầy tiệm chú, chọn mục Mồi, mua một ít mồi tép hay mồi nào cũng được."),
    ],
    turnIn: [
      L("chu_tu", "Được rồi đó! Mồi xài hết thì cứ ghé chú."),
      L("chu_tu", "Chú tặng thêm hai bao thính cám gạo: rải xuống chỗ mình câu, cá kéo tới đông hơn."),
    ],
    hint: "Bấm E ở quầy chú Tư, mở mục Mồi và mua một ít mồi (mồi tép chỉ vài xu).",
  },
  {
    id: "s04_cau", chapter: 2,
    offer: [
      L("chu_tu", "Giờ ra bờ ao thử tay nghề coi. Đứng sát mép nước hoặc trên bến, bấm E để quăng cần."),
      L("chu_tu", "Thấy phao chìm, có dấu ❗ là bấm Space liền! Rồi tới lúc kéo: giữ Space để quay máy, thả ra khi dây căng quá."),
      L("chu_tu", "Thanh kéo mà vô vùng đỏ là đứt dây đó nghen. Kéo tới khi cá lên bờ thì thôi."),
      L("hoa", "Câu được con đầu tiên thì mang cho cô Ba coi nha — cô Ba mừng lắm!"),
    ],
    progress: [
      L("hoa", "Đứng ở bờ ao, bấm E quăng cần. Phao chìm (❗) → Space. Giữ Space để kéo, nhả ra khi thanh gần đỏ."),
    ],
    turnIn: [
      L("co_ba", "Trời, con cá đầu tiên của con đó hả? Được lắm! Ai mới tập cũng sẩy vài con, con vậy là giỏi rồi."),
    ],
    hint: "Ra bờ ao, bấm E quăng cần; phao chìm (❗) thì bấm Space, giữ Space để kéo cá lên.",
  },
  {
    id: "s05_ban", chapter: 3,
    offer: [
      L("co_ba", "Cá câu được thì bán cho cô, khỏi đi đâu xa. Cô trả đúng giá chợ."),
      L("co_ba", "Có điều thương lái mỗi ngày chỉ gom một số tiền cá nhất định cho mỗi người. Bán quá mức đó thì họ trả rẻ dần — qua ngày mới là lại như cũ."),
      L("co_ba", "Bấm E ở vựa của cô, chọn cá rồi bấm Bán nghen."),
    ],
    progress: [
      L("co_ba", "Bấm E ở Vựa cá, chọn con cá rồi bấm Bán là xong."),
    ],
    turnIn: [
      L("co_ba", "Xu nóng hổi đó! Làm ăn vậy là được rồi."),
      L("co_ba", "Mà để một con cá trong người thì chật lắm. Nè, cô cho con cái xô nhỏ — đựng được 5 con, khỏi chạy tới chạy lui."),
    ],
    hint: "Bấm E ở Vựa cá cô Ba (ngay đây, bên ao), chọn cá và bấm Bán.",
  },
  {
    id: "s06_xo", chapter: 3,
    offer: [
      L("co_ba", "Có xô rồi thì câu một mạch mấy con cho đã tay. Con câu thêm 3 con rồi mang lại cô coi."),
      L("hoa", "Mẹo nè: sáng sớm và chiều tối cá cắn nhiều hơn. Mỗi loài cá thích một loại mồi riêng đó."),
    ],
    progress: [
      L("co_ba", "Câu đủ 3 con rồi quay lại đây. Xô đầy thì bán bớt cho cô cũng được."),
    ],
    turnIn: [
      L("co_ba", "Ba con ngon lành! Con thành dân câu thứ thiệt rồi."),
      L("co_ba", "Hồi nãy bác Ba Làng có nhắn: câu xong thì lên Sảnh gặp bác, bác có cái này cho con."),
    ],
    hint: "Câu thêm 3 con cá ở Ao cá, rồi quay lại gặp cô Ba.",
  },
  {
    id: "s07_thu", chapter: 4,
    offer: [
      L("bac_ba_lang", "Về rồi hả cháu? Cô Ba khen cháu dữ lắm."),
      L("bac_ba_lang", "Bác vừa gửi cho cháu một lá thư. Làng mình có hòm thư: quà của làng, tiền bán hàng ở chợ, đồ người ta gửi… đều tới đó."),
      L("hoa", "Hòm thư là nút 📬 trên màn hình. Có số đỏ là có thư mới. Trong đó còn có ô nhập mã quà (gift code) nữa!"),
    ],
    progress: [
      L("hoa", "Bấm nút 📬 Hòm thư trên màn hình, mở lá thư của bác Ba. Có quà thì bấm Nhận."),
    ],
    turnIn: [
      L("bac_ba_lang", "Đọc rồi hả? Mấy bao thính đó xài từ từ. Làng hay phát mã quà dịp lễ, nhớ canh nghen."),
    ],
    hint: "Bấm nút 📬 Hòm thư, mở thư của bác Ba, rồi quay lại Sảnh gặp bác.",
  },
  {
    id: "s08_dong", chapter: 5,
    offer: [
      L("bac_ba_lang", "Làng mình không chỉ có cá đâu. Ngoài đồng có ruộng lúa, rau màu — anh Hai giữ tiệm vật tư ngoài đó."),
      L("bac_ba_lang", "Cháu ra đồng chào anh Hai một tiếng nhé."),
    ],
    progress: [
      L("hoa", "Đồng ruộng ở phía tây Sảnh, theo biển \"Ra đồng\". Tiệm vật tư của anh Hai ở phía nam đồng."),
    ],
    turnIn: [
      L("anh_hai", "Chào em! Bác Ba có nói trước rồi. Làm ruộng thì chậm mà chắc, lúa chín là có tiền."),
    ],
    hint: "Ra Đồng ruộng (biển \"Ra đồng\" phía tây Sảnh) và bấm E ở tiệm anh Hai.",
  },
  {
    id: "s09_qua", chapter: 5,
    offer: [
      L("anh_hai", "Người mới ra đồng được HTX tặng một phần quà tân nông: hạt giống lúa và một bao phân."),
      L("anh_hai", "Em nhận lời là anh đưa liền: một gói giống lúa ngắn ngày với một bao phân urê, bỏ vô giỏ đồ luôn."),
    ],
    progress: [
      L("anh_hai", "Nè, quà tân nông của em đây. Cầm lấy rồi nói chuyện với anh lần nữa nghen."),
    ],
    claimFarmGift: true,
    turnIn: [
      L("anh_hai", "Có giống có phân rồi đó. Muốn trồng thì thuê một thửa ở HTX chú Tám, làm đất, gieo giống, nhớ tưới nước."),
      L("hoa", "Lúa cần vài ngày mới chín, cứ trồng rồi đi câu, lâu lâu ghé thăm là được."),
    ],
    hint: "Nói chuyện với anh Hai (E ở tiệm vật tư) để nhận quà tân nông, rồi nói lại lần nữa.",
  },
  {
    id: "s10_cho", chapter: 6,
    offer: [
      L("anh_hai", "Em biết Chợ Lớn chưa? Ở đó chú Hai cũng mua cá, mà trả hơn cô Ba chừng 10% lận."),
      L("anh_hai", "Đường xa hơn thôi. Em câu vài con, mang lên Chợ Lớn bán cho chú Hai thử coi."),
      L("hoa", "Bán gần thì nhanh, đi xa thì lời hơn — tùy bạn chọn. Chợ Lớn ở phía đông Sảnh."),
    ],
    progress: [
      L("hoa", "Câu cá ở Ao cá rồi đi Chợ Lớn (biển phía đông Sảnh). Vựa cá của chú Hai ở góc tây nam chợ."),
    ],
    turnIn: [
      L("chu_hai_ca", "Cá tươi ha! Chú trả thêm 10% so với dưới ao — nhưng thương lái cũng gom có mức mỗi ngày như cô Ba vậy."),
      L("chu_hai_ca", "Chợ Lớn còn quán ăn, tiệm quần áo, xe cộ… con đi dạo cho biết."),
    ],
    hint: "Mang cá lên Chợ Lớn, bấm E ở Vựa cá Chợ Lớn (chú Hai, góc tây nam chợ) và bán.",
  },
  {
    id: "s11_ve", chapter: 6,
    offer: [
      L("chu_hai_ca", "Bác Ba Làng dặn chú: con đi đủ một vòng thì về báo bác một tiếng."),
    ],
    progress: [
      L("hoa", "Về Sảnh chính (biển \"Về sảnh\" ở mép tây chợ) gặp bác Ba Làng."),
    ],
    turnIn: [
      L("bac_ba_lang", "Cháu đi đủ một vòng rồi! Câu cá, bán cá, hòm thư, ruộng đồng, Chợ Lớn — giờ cháu là người làng Sông Nhạc thứ thiệt."),
      L("bac_ba_lang", "Bác vẫn còn nhiều việc nhờ. Bấm 📜 Sổ nhiệm vụ để nhận việc mỗi ngày, mỗi tuần nhé."),
      L("hoa", "Vui quá! Có gì cứ hỏi mình nha. Chúc bạn ở làng vui vẻ! 🌸"),
    ],
    hint: "Về Sảnh chính gặp bác Ba Làng.",
  },
];

/** Idle chatter: an NPC with nothing of the story to say. */
export const IDLE: Readonly<Record<StoryNpcId, DialogueLine[]>> = {
  bac_ba_lang: [L("bac_ba_lang", "Làng mình dạo này đông vui ghê. Cần việc thì mở Sổ nhiệm vụ nghen cháu.")],
  co_ba: [L("co_ba", "Cá hôm nay tươi không con? Mang lại đây cô mua.")],
  chu_tu: [L("chu_tu", "Cần gãy thì mang lại chú sửa. Muốn câu cá to thì lên đời lưỡi với dây nghe.")],
  anh_hai: [L("anh_hai", "Trời này mà có mưa thì lúa lên đẹp lắm.")],
  chu_hai_ca: [L("chu_hai_ca", "Chợ Lớn trả hơn 10% nè, có cá cứ mang lên.")],
};

export const STEP_BY_ID: ReadonlyMap<string, StoryStepDef> = new Map(STORY_STEPS.map((s) => [s.id, s]));
