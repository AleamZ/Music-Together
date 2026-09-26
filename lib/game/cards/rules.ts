import { caoSettle } from "./cao";
import { cardLabel, cardsOf, type Card, type CardGame } from "./deck";
import { signedXu, xuNum } from "./messages";
import { pkPots } from "./poker";
import { tlSettle, type TlGame } from "./tienlen";

// 📜 Sổ luật (spec §14): the rules of the three games in Vietnamese, as static data. A line is text with card groups
// ("[7♦]" in the source, shown as mini cards). The money examples are computed with tlSettle / caoSettle / pkPots at the
// viewer's table stake (1 000 by default), so the book always matches the engine. Pure.

export type RuleSeg = string | { cards: Card[] };
export type RuleLine = RuleSeg[];
export interface RuleExample { title: string; lines: RuleLine[]; net: Array<{ who: string; xu: number }> }
export interface RuleSection { title: string; lines: RuleLine[]; examples: RuleExample[] }
export interface RulesPage { game: CardGame; header: readonly string[]; sections: RuleSection[] }

export const RULES_TABS: ReadonlyArray<{ game: CardGame; label: string }> = [
  { game: "tienlen", label: "Tiến lên" }, { game: "cao", label: "Cào" }, { game: "poker", label: "Poker" },
];

export const RULES_HEADER: readonly string[] = [
  "🪙 Xu là điểm chơi trong Music Together — kiếm được khi câu cá, làm ruộng, điểm danh và nghe nhạc.",
  "Xu không mua được bằng tiền thật và không đổi ra tiền thật. Mua bán xu hay tài khoản bằng tiền thật bị cấm.",
  "Bàn bài chỉ để giải trí: người thắng nhận đúng phần người thua trả, không ai thu phí.",
];

/** A line from text with card groups in brackets: "Đôi [9♠ 9♥]". */
export function ruleLine(text: string): RuleLine {
  const segs: RuleLine = [];
  let at = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) {
    const i = m.index ?? 0;
    if (i > at) segs.push(text.slice(at, i));
    segs.push({ cards: cardsOf(m[1].split(" ")) });
    at = i + m[0].length;
  }
  if (at < text.length) segs.push(text.slice(at));
  return segs;
}

/** A line as plain text (cards as their labels in brackets). */
export function ruleText(line: RuleLine): string {
  return line.map((s) => (typeof s === "string" ? s : `[${s.cards.map(cardLabel).join(" ")}]`)).join("");
}

const section = (title: string, texts: readonly string[], examples: RuleExample[] = []): RuleSection =>
  ({ title, lines: texts.map(ruleLine), examples });

// ------------------------------------------------------------------ Tiến lên

const TL_PEOPLE = ["A", "B", "C", "D"];

function tlExample(title: string, texts: readonly string[], g: TlGame, stake: number): RuleExample {
  const net = tlSettle(g).net;
  return {
    title, lines: texts.map(ruleLine),
    net: g.order.map((s) => ({ who: TL_PEOPLE[s - 1], xu: (net[s] ?? 0) * stake / 2 })),
  };
}

function tienlen(stake: number): RuleSection[] {
  const x = (units: number) => xuNum(units * stake);
  const S = xuNum(stake);
  const cut = (seat: number, top: number, codes: string[], done = false) =>
    ({ k: "cut" as const, seat, top: { seat: top, cards: cardsOf(codes), done } });
  const out = (seat: number) => ({ k: "out" as const, seat });
  const examples = [
    tlExample(`Ví dụ 1 — chặt chồng (mức ${S}; A, B, C, D)`, [
      "D đánh [2♥]; B chặt bằng 3 đôi thông [5♠ 5♣ 6♠ 6♣ 7♠ 7♣]; C chặt lại B bằng tứ quý [9♠ 9♣ 9♦ 9♥].",
      `Mọi người bỏ lượt: B trả C ${x(2.5)} (${x(1)} cho 2♥ và ${x(1.5)} cho 3 đôi thông).`,
      `Hết ván: A nhất, B nhì, C ba, D bét. D còn [2♠] nên thối ${x(0.5)} cho C.`,
      `D trả A ${x(1)}; C trả B ${x(0.5)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3, 4], hands: { 4: cardsOf(["2S"]) },
      events: [cut(2, 4, ["2H"]), cut(3, 2, ["5S", "5C", "6S", "6C", "7S", "7C"]), { k: "close" }, out(1), out(2), out(3), { k: "end" }],
    }, stake),
    tlExample(`Ví dụ 2 — cóng (mức ${S})`, [
      "A về nhất khi D chưa đánh lá nào: D bị cóng.",
      `D còn [2♦] và tứ quý [9♠ 9♣ 9♦ 9♥] nên thối ${x(1)} + ${x(2)}: D trả A ${x(2)} + ${x(3)} = ${x(5)}.`,
      `B và C đánh tiếp: B về nhì, C về ba trả B ${x(0.5)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3],
      hands: { 4: cardsOf(["2D", "9S", "9C", "9D", "9H", "3S", "5C", "7D", "JH", "KS", "AC", "4D", "6H"]), 3: cardsOf(["8S"]) },
      events: [out(1), out(2), { k: "end" }],
    }, stake),
    tlExample(`Ví dụ 3 — tới trắng (mức ${S})`, [
      `C được chia 6 đôi: tới trắng. A, B và D mỗi người trả C ${x(2)}.`,
    ], { order: [1, 2, 3, 4], played: [], hands: {}, events: [{ k: "trang", seat: 3 }] }, stake),
    tlExample(`Ví dụ 4 — xử thua (mức ${S}; lượt A, B, C, D)`, [
      "A đã về nhất. D rời bàn khi còn [2♥], B và C còn bài.",
      `D trả B và C mỗi người ${x(1)}, rồi thối 2♥ (${x(1)}) cho B — người kế tiếp sau D. D được trả lại ${x(10)} − ${x(3)}.`,
      `B và C chơi tiếp như bàn 3 người (A, B, C): B về nhì, C về bét trả A ${x(1)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3, 4], hands: { 4: cardsOf(["2H", "5S"]), 3: cardsOf(["6S"]) },
      events: [out(1), { k: "forfeit", seats: [4] }, out(2), { k: "end" }],
    }, stake),
  ];
  return [
    section("Mục tiêu", [
      "Mỗi người 13 lá. Ai đánh hết bài trước về nhất; những người còn lại đánh tiếp để phân nhì, ba, bét. Bàn 2–4 người.",
    ]),
    section("Thứ tự bài", [
      "3 < 4 < … < K < A < 2 (heo). Cùng số thì so chất: ♠ bích < ♣ chuồn < ♦ rô < ♥ cơ. Nhỏ nhất 3♠, lớn nhất 2♥.",
    ]),
    section("Các bộ", [
      "Rác [7♦] · Đôi [9♠ 9♥] · Sám cô [Q♣ Q♦ Q♥]",
      "Sảnh ≥ 3 lá liên tiếp, không có heo [5♠ 6♦ 7♣]",
      "Tứ quý [8♠ 8♣ 8♦ 8♥]",
      "Đôi thông ≥ 3 đôi liên tiếp, không có heo [4♠ 4♦ 5♣ 5♥ 6♠ 6♦].",
      "Chặn bằng bộ cùng loại, cùng số lá, lá lớn nhất lớn hơn: [6♠ 7♦ 8♥] chặn [6♦ 7♥ 8♣] vì 8♥ > 8♣.",
    ]),
    section("Lượt chơi", [
      "Ván đầu (bàn mới, sau tới trắng, hoặc khi người về nhất ván trước không còn chơi): ai có lá nhỏ nhất được chia (thường 3♠) đánh trước, phải đánh kèm lá đó.",
      "Ván sau: người về nhất đánh trước.",
      "Lần lượt chặn hoặc Bỏ lượt; đã bỏ lượt thì chờ vòng sau.",
      "Mọi người khác bỏ lượt thì người đánh sau cùng mở vòng mới; người đó đã hết bài thì người kế tiếp mở.",
      "Mỗi lượt 20 giây; hết giờ tự bỏ lượt (đang mở vòng thì tự đánh lá nhỏ nhất); lỡ 2 lượt liên tiếp bị xử thua.",
    ]),
    section("Luật đặc biệt", [
      "Chặt heo: 3 đôi thông chặt 1 heo; tứ quý chặt 1 heo, đôi heo, 3 đôi thông; 4 đôi thông chặt 1 heo, đôi heo, 3 đôi thông, tứ quý — và chặt được cả khi đã bỏ lượt (nút 💣 Chặt!).",
      "Hàng lớn chặt hàng nhỏ cùng loại.",
      "Chặt chồng: người bị chặt sau cùng trả cả chuỗi cho người chặt sau cùng khi hết vòng.",
      "Tới trắng: vừa chia có sảnh rồng (3 → A), 5 đôi thông, tứ quý heo hoặc 6 đôi là thắng ngay.",
      "Cóng: có người về nhất mà bạn chưa đánh lá nào; nhiều người cùng cóng thì ai cách người về nhất xa nhất theo lượt đánh thì về bét.",
      "Thối: hết ván còn heo hoặc hàng trên tay.",
      "Xử thua (rời bàn giữa ván hoặc lỡ 2 lượt liên tiếp): trả ngay 1 mức cho mỗi người còn đang chơi, dù họ còn bao nhiêu lá, rồi tiền thối bài mình cho người kế tiếp trong số đó.",
      "Xử thua không làm ai bị cóng; không còn ai để nhận thì khoản đó không phải trả.",
      "Những người còn lại chơi tiếp như một bàn ít người hơn.",
    ]),
    section("Tính tiền", [
      "Bét trả nhất 1 mức, ba trả nhì ½ mức (3 người: bét trả nhất 1 mức; 2 người: thua trả thắng 1 mức).",
      "Heo đen ½ · heo đỏ 1 · 3 đôi thông 1½ · tứ quý 2 · 4 đôi thông 3 mức, cho cả thối và chặt.",
      "Cóng: trả nhất 2 mức + thối. Tới trắng: mỗi người trả 2 mức.",
      "Thối của người về bét trả người về ngay trên; của người cóng trả người về nhất; của người bị xử thua trả người kế tiếp còn đang chơi.",
      "Xử thua: trả mỗi người còn đang chơi 1 mức.",
      "Mỗi ván giữ tạm 10 mức; không ai thua quá 10 mức một ván.",
    ], examples),
  ];
}

// ------------------------------------------------------------------ Cào

function cao(stake: number): RuleSection[] {
  const S = xuNum(stake);
  const hands = { 1: ["9S", "8C", "2H"], 2: ["KD", "5S", "3C"], 3: ["JS", "QH", "KC"], 4: ["4D", "4C", "4S"], 5: ["7H", "10C", "AD"] };
  const who = ["A", "B", "C", "D", "E"];
  const r = caoSettle({
    dealer: 2, order: [1, 2, 3, 4, 5], left: [],
    hands: Object.fromEntries(Object.entries(hands).map(([s, c]) => [Number(s), cardsOf(c)])),
  });
  const example: RuleExample = {
    title: `Ví dụ (mức ${S}; 5 người, B làm cái)`,
    lines: [
      `B giữ tạm ${xuNum(4 * stake)}; A, C, D và E mỗi người ${S} — cả bàn ${xuNum(8 * stake)}.`,
      "B có [K♦ 5♠ 3♣] = 8 nút, lá lớn nhất K♦.",
      `A [9♠ 8♣ 2♥] 9 nút — thắng ${signedXu(stake)}.`,
      `C [J♠ Q♥ K♣] ba tây — thắng ${signedXu(stake)}.`,
      `D [4♦ 4♣ 4♠] sáp 4 — thắng ${signedXu(stake)}.`,
      `E [7♥ 10♣ A♦] 8 nút, lá lớn nhất 10♣ thua K♦ — thua ${signedXu(-stake)}.`,
      `B: ${signedXu(-3 * stake)} ${signedXu(stake)} = ${signedXu(-2 * stake)}, nhận lại ${xuNum(2 * stake)} trong ${xuNum(4 * stake)} đã giữ.`,
    ].map(ruleLine),
    net: [1, 2, 3, 4, 5].map((s) => ({ who: who[s - 1], xu: (r.net[s] ?? 0) * stake })),
  };
  return [
    section("Mục tiêu", [
      "Mỗi người 3 lá, so với nhà cái: cao hơn cái thì ăn 1 mức, thấp hơn thì chung 1 mức. Bàn 2–6 người; cái xoay vòng mỗi ván.",
    ]),
    section("Tính điểm", [
      "A = 1, 2–9 theo số, 10 · J · Q · K = 10.",
      "Nút là hàng đơn vị của tổng: [7♠ 8♦ 9♣] = 24 → 4 nút.",
      "9 nút cao nhất; tròn chục là bù (0 nút).",
    ]),
    section("Bài đặc biệt", [
      "Sáp: 3 lá cùng số [5♠ 5♦ 5♥] thắng mọi bài khác; sáp lớn thắng sáp nhỏ (K cao nhất, A thấp nhất).",
      "Ba tây: 3 lá hình J/Q/K bất kỳ [J♣ Q♦ Q♠], thắng mọi bài tính nút.",
    ]),
    section("So bằng", [
      "Cùng nút hoặc cùng ba tây: so lá lớn nhất mỗi bên, K > Q > J > 10 > … > 2 > A; cùng số thì so chất ♦ rô > ♥ cơ > ♣ chuồn > ♠ bích.",
      "Không có hai lá giống nhau nên luôn có thắng thua.",
    ]),
    section("Lượt chơi", [
      "Cái bấm 🃏 Chia bài trong 15 giây (quá giờ tự chia). Mọi người có 15 giây nặn bài, rồi cả bàn lật bài.",
      "Nhà con rời bàn giữa ván thì mất 1 mức cho cái; nhà cái chờ lật bài xong mới rời được.",
    ]),
    section("Tính tiền", [
      "Mỗi nhà con thắng hoặc thua cái đúng 1 mức.",
      "Mỗi nhà con giữ tạm 1 mức; nhà cái giữ tạm (số nhà con × mức cược); không đủ thì bỏ qua lượt cái.",
    ], [example]),
  ];
}

// ------------------------------------------------------------------ Poker

/** Each hand rank with a card example (§14), strongest first. */
export const POKER_RANK_EXAMPLES: ReadonlyArray<{ name: string; cards: string[] }> = [
  { name: "Thùng phá sảnh", cards: ["9H", "10H", "JH", "QH", "KH"] },
  { name: "Tứ quý", cards: ["8S", "8C", "8D", "8H", "KS"] },
  { name: "Cù lũ", cards: ["QS", "QD", "QH", "5C", "5D"] },
  { name: "Thùng", cards: ["AC", "JC", "9C", "6C", "3C"] },
  { name: "Sảnh", cards: ["5S", "6D", "7C", "8H", "9S"] },
  { name: "Sám", cards: ["7S", "7D", "7H", "KC", "2D"] },
  { name: "Thú", cards: ["JS", "JH", "4C", "4D", "AS"] },
  { name: "Đôi", cards: ["10S", "10H", "AD", "8C", "3S"] },
  { name: "Mậu thầu", cards: ["AH", "QD", "9C", "7S", "5H"] },
];

function poker(stake: number): RuleSection[] {
  const x = (units: number) => xuNum(units * stake);
  // §9.3: A (the button) 60 S, B (SB) 8 S, C (BB) 40 S; B's flush wins the main pot, A's trips beat C's pair for the side
  const pots = pkPots({
    players: { 1: { put: 18 * stake }, 2: { put: 8 * stake, allin: true }, 3: { put: 18 * stake } },
    keys: { 1: [3, 5, 14, 13], 2: [5, 14, 11, 9, 6, 3], 3: [1, 12, 14, 13, 7] }, button: 1,
  });
  const won = (s: number) => pots.reduce((a, p) => a + (p.shares?.[s] ?? 0), 0);
  const put: Record<number, number> = { 1: 18 * stake, 2: 8 * stake, 3: 18 * stake };
  const example: RuleExample = {
    title: `Ví dụ — pot phụ (mù ${xuNum(stake / 2)}/${xuNum(stake)})`,
    lines: [
      `A (giữ nút D) có ${x(60)}, B (mù nhỏ) ${x(8)}, C (mù lớn) ${x(40)}.`,
      `Trước flop: A tố lên ${x(3)}; B tất tay ${x(8)}; C theo ${x(8)}; A theo.`,
      `Flop: C cược ${x(10)}, A theo. Turn và river: cả hai xem bài.`,
      `Pot chính ${xuNum(pots[0].xu)} (A, B, C); pot phụ ${xuNum(pots[1].xu)} (A, C).`,
      "B thắng pot chính; A thắng C ở pot phụ.",
    ].map(ruleLine),
    net: [{ who: "A", s: 1 }, { who: "B", s: 2 }, { who: "C", s: 3 }].map(({ who, s }) => ({ who, xu: won(s) - put[s] })),
  };
  return [
    section("Mục tiêu", [
      "Mỗi người 2 lá tẩy, bàn có 5 lá chung. Ghép 5 lá tốt nhất từ 7 lá; tay mạnh nhất khi lật bài, hoặc người cuối cùng chưa úp bài, ăn pot.",
    ]),
    section("Thứ tự tay bài", [
      "Thùng phá sảnh [9♥ 10♥ J♥ Q♥ K♥] > Tứ quý > Cù lũ > Thùng > Sảnh (A đứng đầu hoặc cuối: A-2-3-4-5) > Sám > Thú > Đôi > Mậu thầu.",
      ...POKER_RANK_EXAMPLES.slice(1).map((r) => `${r.name} [${cardsOf(r.cards).map(cardLabel).join(" ")}]`),
      "Cùng hạng thì so lá cao và lá phụ (kicker); chất không phân hơn thua.",
    ]),
    section("Lượt chơi", [
      "Nút D xoay vòng. Hai người bên trái nút đặt mù nhỏ (½ mức) và mù lớn (1 mức); bàn 2 người thì người giữ nút đặt mù nhỏ và nói trước ở vòng đầu.",
      "Bốn vòng cược: trước flop, flop (3 lá), turn (1 lá), river (1 lá).",
      "Mỗi lượt 30 giây; hết giờ tự Xem bài nếu được, không thì Úp bài; lỡ 2 lượt liên tiếp thì bị úp bài và rời bàn, chip chưa cược về ví.",
    ]),
    section("Luật cược", [
      "Cược ít nhất 1 mù lớn. Tố phải tăng ít nhất bằng lần cược hoặc tố lớn nhất trước đó trong vòng.",
      "Tất tay lúc nào cũng được; tất tay chưa đủ một lần tố thì người đã nói không được tố lại.",
      "Người tất tay chỉ ăn phần pot mình theo được (pot phụ).",
      "Hoà thì chia đều; 1 xu lẻ cho người thắng ngồi gần bên trái nút nhất.",
    ]),
    section("Tiền", [
      "Mang vào bàn 50–200 lần mù lớn; đứng dậy thì chip về ví. Nạp thêm giữa các ván, tối đa 200 lần mù lớn. Không phí bàn.",
    ], [example]),
  ];
}

/** The rules book's tab for a game, its money examples at this stake. */
export function rulesPage(game: CardGame, stake = 1000): RulesPage {
  const sections = game === "tienlen" ? tienlen(stake) : game === "cao" ? cao(stake) : poker(stake);
  return { game, header: RULES_HEADER, sections };
}
