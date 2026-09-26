import { lockSeconds, lockText } from "@/lib/anticheat";
import { isMissingRpc } from "@/lib/game/farm/messages";
import { caoName, caoEval } from "./cao";
import { cardLabel, rankOf, type Card, type CardGame } from "./deck";
import type { CardPhase, LobbyTable, TlLastLine } from "./state";
import { tlThoi, type TlTrang } from "./tienlen";

// The card corner's Vietnamese texts (spec §5, §11.5, §13): names, the table and HUD lines, the results and the RPC
// errors. Pure.

export { isMissingRpc };

export const GAME_NAME: Record<CardGame, string> = { tienlen: "Tiến lên", cao: "Cào", poker: "Poker" };
export const TABLE_TITLE: Record<CardGame, string> = { tienlen: "🃏 Bàn Tiến lên", cao: "🃏 Chiếu Cào", poker: "🃏 Bàn Poker" };

export const CARDS_NOT_OPEN = "Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.";
export const CARDS_LOADING = "Đang tải bàn…";
export const CARDS_FAILED = "Chưa tải được bàn — thử lại nhé.";
export const WAITING_PLAYERS = "Chờ người chơi (cần ít nhất 2)";
export const WATCHING = "👀 Đang xem";
export const SIT_HERE = "Ngồi đây";
export const STAND_UP = "Đứng dậy";
export const LEAVE_CONFIRM = "Rời bàn giữa ván sẽ bị xử thua… Hết ván này bạn mới ngồi lại được.";
export const DEALER_WAIT = "Chờ lật bài xong";
export const CANCELLED = "Ván huỷ — đã trả lại tiền giữ";
export const NO_DEALER = "Chưa ai đủ xu làm cái";
export const PLAY_MONEY = "🪙 Xu chỉ là điểm trong trò chơi — không mua bằng tiền thật, không đổi ra tiền thật.";
export const STAKES: readonly number[] = [100, 1000, 10000];

/** "1.000" (vi-VN grouping, no unit). */
export function xuNum(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** "+1.000", "−500" or "0". */
export function signedXu(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${xuNum(Math.abs(n))}`;
}

/** "Mức cược 1.000 xu", or for poker "Mù 500/1.000". */
export function stakeLine(game: CardGame, stake: number): string {
  return game === "poker" ? `Mù ${xuNum(stake / 2)}/${xuNum(stake)}` : `Mức cược ${xuNum(stake)} xu`;
}

/** The hall's label over a table (§5): "Tiến lên · 2/4 · 1.000", "Poker · 5/6 · 500/1.000", or "Trống". */
export function hallLabel(t: LobbyTable): string {
  if (t.seats.length === 0 || t.stake === null) return "Trống";
  const stake = t.game === "poker" ? `${xuNum(t.stake / 2)}/${xuNum(t.stake)}` : xuNum(t.stake);
  return `${GAME_NAME[t.game]} · ${t.seats.length}/${t.max} · ${stake}`;
}

/** The panel's status line (§13.2). `turnName` is null when it is my turn. */
export function statusLine(phase: CardPhase, seats: number, secs: number, turn: { mine: boolean; name: string } | null): string {
  if (phase === "idle" || seats < 2) return WAITING_PLAYERS;
  if (phase === "countdown" || phase === "result") return `Ván mới sau ${secs} giây`;
  if (phase === "peek") return `Lật bài sau ${secs} giây`;
  if (!turn) return "";
  return turn.mine ? `Đến lượt bạn! ${secs}s` : `Lượt ${turn.name} · ${secs}s`;
}

/** The HUD chip while seated (§13.1): "🃏 Tiến lên · Đến lượt bạn! 14s", "· Đang chơi" or "· Chờ ván mới". */
export function seatChipText(game: CardGame, state: "turn" | "playing" | "waiting", secs: number): string {
  const tail = state === "turn" ? `Đến lượt bạn! ${secs}s` : state === "playing" ? "Đang chơi" : "Chờ ván mới";
  return `🃏 ${GAME_NAME[game]} · ${tail}`;
}

/** The toast once per turn while the panel is closed. */
export function turnToast(game: CardGame): string {
  return `🃏 Đến lượt bạn ở bàn ${GAME_NAME[game]}!`;
}

/** The sit dialog's requirement line (§13.2) for Tiến lên and Cào. */
export function holdLine(game: "tienlen" | "cao", stake: number): string {
  return game === "tienlen"
    ? `Mỗi ván giữ tạm ${xuNum(10 * stake)} để trả thua — hết ván trả lại phần dư.`
    : `Mỗi ván giữ tạm ${xuNum(stake)}; khi làm cái giữ ${xuNum(stake)} × số nhà con.`;
}

export const PLACE_NAME: readonly string[] = ["", "Về nhất", "Về nhì", "Về ba", "Về bét"];

/** A Tiến lên seat's place badge: nhất, nhì, then ba or bét (the last of 3 or 2 is bét). */
export function placeBadge(place: number, placed: number): string {
  if (place === 1) return PLACE_NAME[1];
  if (place === placed) return PLACE_NAME[4];
  return PLACE_NAME[place] ?? "";
}

export const TRANG_NAME: Record<TlTrang, string> = {
  sanh_rong: "sảnh rồng", nam_doi_thong: "5 đôi thông", tu_quy_heo: "tứ quý heo", sau_doi: "6 đôi",
};

/** "Thối heo", "Thối hàng" or "Thối heo và hàng", from the cards still held. */
export function thoiName(held: readonly Card[]): string {
  const heo = held.some((c) => rankOf(c) === 12);
  const hang = tlThoi(held.filter((c) => rankOf(c) !== 12)) > 0;
  return heo && hang ? "Thối heo và hàng" : hang ? "Thối hàng" : "Thối heo";
}

/** The result's Tiến lên lines (§13.2), in xu: "Thối heo: D trả C 500", "Cóng: D trả A 5.000", "Tới trắng: 6 đôi",
 *  "Xử thua: D trả mỗi người 1.000". A forfeit's 1 S lines of equal amounts are told once. */
export function tlResultLines(last: { trang: { pattern: TlTrang } | null; lines: readonly TlLastLine[]; hands: Readonly<Record<number, readonly Card[]>> },
  name: (seat: number) => string): string[] {
  const out: string[] = [];
  if (last.trang) out.push(`Tới trắng: ${TRANG_NAME[last.trang.pattern]}`);
  const lines = last.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const pay = `${name(l.from)} trả ${name(l.to)} ${xuNum(l.paid)}`;
    switch (l.why) {
      case "forfeit": {
        let j = i;
        while (j + 1 < lines.length && lines[j + 1].why === "forfeit" && lines[j + 1].from === l.from && lines[j + 1].paid === l.paid) j++;
        out.push(j > i ? `Xử thua: ${name(l.from)} trả mỗi người ${xuNum(l.paid)}` : `Xử thua: ${pay}`);
        i = j;
        break;
      }
      case "bet": out.push(`Về bét: ${pay}`); break;
      case "ba": out.push(`Về ba: ${pay}`); break;
      case "chat": out.push(`Chặt: ${pay}`); break;
      case "thoi": out.push(`${thoiName(last.hands[l.from] ?? [])}: ${pay}`); break;
      case "cong": out.push(`Cóng: ${pay}`); break;
      case "trang": out.push(`Tới trắng: ${pay}`); break;
    }
  }
  return out;
}

/** A Cào hand's name from its cards: "Sáp K", "Ba tây", "7 nút", "Bù". */
export function caoHandName(cards: readonly Card[]): string {
  return caoName(caoEval(cards));
}

/** "💣 C chặt B!" */
export function cutBanner(cutter: string, victim: string): string {
  return `💣 ${cutter} chặt ${victim}!`;
}

/** "Ván đầu phải đánh kèm lá 3♠." */
export function mustText(must: Card | null | undefined): string {
  return `Ván đầu phải đánh kèm lá ${cardLabel(must ?? 0)}.`;
}

/** Vietnamese toast text for a card RPC error (spec §11.5). `must` names the card a first lead must include. */
export function cardErrorMessage(err: unknown, must?: Card | null): string {
  if (isMissingRpc(err)) return CARDS_NOT_OPEN;
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  switch (msg) {
    case "invalid game": return "Bàn bài không hợp lệ.";
    case "invalid seat": return "Ghế không hợp lệ.";
    case "invalid stake": return "Mức cược của bàn không hợp lệ.";
    case "invalid quantity": return "Số xu không hợp lệ.";
    case "invalid cards": return "Lá bài không hợp lệ.";
    case "invalid bet": return "Số tiền cược không hợp lệ.";
    case "stale": return "Bàn vừa thay đổi — xem lại nhé.";
    case "not seated": return "Bạn chưa ngồi bàn này.";
    case "already seated": return "Bạn đang ngồi một bàn khác trong phòng.";
    case "still leaving": return "Ván bạn vừa rời chưa xong — hết ván đó bạn mới ngồi lại được.";
    case "table full": return "Bàn đã đủ người.";
    case "seat taken": return "Ghế này có người rồi.";
    case "stake changed": return "Mức cược vừa đổi — xem lại nhé.";
    case "not enough coins": return "Không đủ xu.";
    case "not your turn": return "Chưa tới lượt bạn.";
    case "invalid play": return "Bộ bài không hợp lệ.";
    case "cannot beat": return "Bài này không chặn được.";
    case "must include": return mustText(must);
    case "must play": return "Bạn đang mở vòng — phải đánh.";
    case "cannot raise": return "Chưa được tố thêm — chỉ theo hoặc úp.";
    case "hand running": return "Đang có ván — chờ hết ván nhé.";
    case "too many chips": return "Trên bàn tối đa 200 lần mù lớn.";
    case "not dealer": return "Chỉ nhà cái được chia bài.";
    case "dealer busy": return "Nhà cái chờ lật bài xong rồi hãy rời bàn.";
    case "wrong phase": return "Chưa tới lúc làm việc này.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
