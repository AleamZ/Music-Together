"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useCardLobby } from "@/hooks/useCardLobby";
import { useCardTable, type CardTable } from "@/hooks/useCardTable";
import type { CardGame } from "@/lib/game/cards/deck";
import { CARDS_NOT_OPEN, hallLabel, turnToast } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import { mySeat, type CardAnswer, type CardLobby, type CardState } from "@/lib/game/cards/state";
import type { Interactable, MapId } from "@/lib/game/maps/types";

export interface CardsControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The map I am on: the lobby is polled only on the hall. */
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  isMember: (accountId: string) => boolean;
  /** My wallet changed at a table (the HUD reads the fishing state: fetch it again). */
  onCoinsChanged: () => void;
}

export interface CardsController {
  lobby: CardLobby | null;
  notOpen: boolean;
  /** The table panel's game; null = closed. */
  panel: CardGame | null;
  openPanel: (game: CardGame) => void;
  closePanel: () => void;
  /** 📜 Sổ luật: open on a game's tab, its examples at a stake. */
  rules: { game: CardGame; stake: number } | null;
  openRules: (game?: CardGame) => void;
  closeRules: () => void;
  /** The table the panel shows. */
  table: CardTable;
  /** Where I sit (a seat that is not leaving), and that table's hook. */
  seated: CardGame | null;
  seatTable: CardTable;
  /** A write at the panel's table; sitting and standing up refresh the hall's labels. */
  act: (a: CardAction) => Promise<CardAnswer | null>;
  /** Handles the card corner's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
}

/** My turn at this state, once per turn: the hand and the action count; null when it is not my turn. */
function turnKey(s: CardState | null, accountId: string): string | null {
  if (!s || s.turn === null || (s.phase !== "playing" && s.phase !== "deal_wait")) return null;
  const seat = mySeat(s, accountId);
  return seat && !seat.leaving && seat.seat === s.turn ? `${s.handNo}:${s.seq}` : null;
}

/** The card corner for the game shell (spec §13.1): the lobby and the hall's labels, the open panel and the rules book,
 *  the table I sit at (kept while the panel is closed) and the one I watch, and a toast once per turn while the panel
 *  is closed. */
export function useCardsController({ token, roomId, accountId, mapId, canvas, toast, isMember, onCoinsChanged }: CardsControllerOptions): CardsController {
  const [seatGame, setSeatGame] = useState<CardGame | null>(null);
  const [panel, setPanel] = useState<CardGame | null>(null);
  const [rules, setRules] = useState<{ game: CardGame; stake: number } | null>(null);

  // --- where I sit follows every state I see, and the lobby after a reload
  const onState = useCallback((g: CardGame, s: CardState) => {
    const seat = mySeat(s, accountId);
    if (seat && !seat.leaving) setSeatGame(g);
    else setSeatGame((cur) => (cur === g ? null : cur));
  }, [accountId]);
  const onLobby = useCallback((l: CardLobby) => {
    const t = l.tables.find((x) => x.seats.some((s) => s.id === accountId));
    if (t) setSeatGame((cur) => cur ?? t.game);
  }, [accountId]);
  const { lobby, notOpen, reload } = useCardLobby(roomId, token, mapId === "hall", onLobby);

  // --- two tables at most: the one I sit at (or else the panel's), and the panel's when it is another
  const primary = seatGame ?? panel;
  const secondary = panel !== null && panel !== primary ? panel : null;
  const common = { roomId, token, accountId, isMember, onError: toast, onCoins: onCoinsChanged, onState };
  const first = useCardTable({ ...common, game: primary, active: primary !== null });
  const second = useCardTable({ ...common, game: secondary, active: secondary !== null });
  const table = panel !== null && panel === secondary ? second : first;

  // --- the hall's labels over the tables
  useEffect(() => {
    if (!lobby) return;
    canvas()?.setCardTables(Object.fromEntries(lobby.tables.map((t) => [t.game, hallLabel(t)])));
  }, [lobby, canvas]);

  // --- a toast once per turn while that table's panel is closed
  const seatState = seatGame !== null && first.game === seatGame ? first.state : null;
  const myTurn = turnKey(seatState, accountId);
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!myTurn || !seatGame || panel === seatGame || toasted.current === myTurn) return;
    toasted.current = myTurn;
    toast(turnToast(seatGame));
  }, [myTurn, seatGame, panel, toast]);

  const act = useCallback(async (a: CardAction) => {
    const r = await table.act(a);
    if (r && (a.kind === "sit" || a.kind === "leave")) void reload();
    return r;
  }, [table, reload]);

  const stakeOf = useCallback((g: CardGame) => lobby?.tables.find((t) => t.game === g)?.stake ?? 1000, [lobby]);
  const openRules = useCallback((g?: CardGame) => {
    const game = g ?? seatGame ?? "tienlen";
    setRules({ game, stake: stakeOf(game) });
  }, [seatGame, stakeOf]);

  const interact = useCallback((it: Interactable): boolean => {
    if (it.kind !== "card_table" && it.kind !== "card_rules") return false;
    if (notOpen) {
      toast(CARDS_NOT_OPEN);
      return true;
    }
    if (it.kind === "card_table") {
      if (it.game) setPanel(it.game);
    } else {
      openRules();
    }
    return true;
  }, [notOpen, toast, openRules]);

  return useMemo(() => ({
    lobby, notOpen, panel, openPanel: setPanel, closePanel: () => setPanel(null), rules, openRules, closeRules: () => setRules(null),
    table, seated: seatGame, seatTable: first, act, interact,
  }), [lobby, notOpen, panel, rules, openRules, table, seatGame, first, act, interact]);
}
