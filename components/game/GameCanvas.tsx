"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { GameEngine, type RosterEntry } from "@/lib/game/engine";
import { buildHallMap } from "@/lib/game/maps/hall";
import { paintHall } from "@/lib/game/maps/hall-art";
import type { Interactable } from "@/lib/game/maps/types";
import { joinGameChannel } from "@/lib/game/net/channel";
import { createReplyScheduler, replyWindowMs } from "@/lib/game/net/replies";
import type { Look } from "@/lib/game/types";

export interface GameCanvasHandle {
  setRoster: (entries: RosterEntry[]) => void;
  setLocal: (info: { name: string; badges: string; look: Look }) => void;
  showBubble: (accountId: string, text: string) => void;
  showReaction: (accountId: string | null, emoji: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  interact: () => void;
  /** Tell everyone my character changed (they re-fetch it). */
  announceLook: () => void;
}

export interface GameCanvasProps {
  ref?: Ref<GameCanvasHandle | null>;
  roomId: string;
  localId: string;
  /** Used once when the world starts; later changes go through the handle's setLocal. */
  initial: { name: string; badges: string; look: Look };
  /** Is this account a current room member? Game messages from anyone else are dropped (spec §8.3). */
  isMember: (accountId: string) => boolean;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onLookChanged: (accountId: string) => void;
  /** The browser has no usable 2D canvas. */
  onUnsupported: () => void;
}

/** The game world: one engine + one broadcast channel per room visit. */
export default function GameCanvas({ ref, roomId, localId, ...rest }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const announceRef = useRef<(() => void) | null>(null);
  const propsRef = useRef(rest);
  useEffect(() => {
    propsRef.current = rest;
  });

  useImperativeHandle(ref, () => ({
    setRoster: (entries) => engineRef.current?.setRoster(entries),
    setLocal: (info) => engineRef.current?.setLocal(info),
    showBubble: (id, text) => engineRef.current?.showBubble(id, text),
    showReaction: (id, emoji) => engineRef.current?.showReaction(id, emoji),
    setInputEnabled: (enabled) => engineRef.current?.setInputEnabled(enabled),
    interact: () => engineRef.current?.interact(),
    announceLook: () => announceRef.current?.(),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = buildHallMap();
    const init = propsRef.current.initial;
    let engine: GameEngine;
    try {
      const art = paintHall(map);
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-vt323").trim();
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => channel.send({ t: "mv", id: localId, ...m }),
        onLocalPath: (m) => channel.send({ t: "pa", id: localId, ...m }),
        onInteract: (id) => propsRef.current.onInteract(id),
        onPromptChange: (id) => propsRef.current.onPromptChange(id),
        onActorClick: (id) => propsRef.current.onActorClick(id),
      }, {
        localId,
        name: init.name,
        badges: init.badges,
        look: init.look,
        fontFamily: fontVar ? `${fontVar}, monospace` : "monospace",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    } catch {
      propsRef.current.onUnsupported();
      return;
    }

    // One answer (my state) serves every `hello` that arrives before it goes out; answers are spread over a window
    // that grows with the world, because each one reaches every player.
    const replies = createReplyScheduler({
      send: () => channel.send(engine.snapshot()),
      windowMs: () => replyWindowMs(engine.walkers() + 1),
    });
    const channel = joinGameChannel(roomId, map, {
      onMessage: (msg) => {
        if (msg.id === localId) {
          // Another tab of my account left the world and everyone just dropped my character: tell them where I am.
          if (msg.t === "bye") channel.send(engine.snapshot());
          return;
        }
        if (!propsRef.current.isMember(msg.id)) return;
        switch (msg.t) {
          case "hello":
            engine.noteHello(msg.id);
            replies.onHello();
            break;
          case "lk":
            propsRef.current.onLookChanged(msg.id);
            break;
          case "bye":
            engine.removeActor(msg.id);
            break;
          default:
            engine.applyMessage(msg);
        }
      },
      onStatus: (connected) => {
        propsRef.current.onConnectionChange(connected);
        if (!connected) return;
        // (Re)entering: ask for everyone's state and announce mine — after a reconnect I may have moved.
        channel.send({ t: "hello", id: localId });
        channel.send(engine.snapshot());
      },
    });

    engineRef.current = engine;
    announceRef.current = () => channel.send({ t: "lk", id: localId });
    engine.start();
    return () => {
      replies.dispose();
      announceRef.current = null;
      engineRef.current = null;
      channel.leave({ t: "bye", id: localId });
      engine.destroy();
    };
  }, [roomId, localId]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới game" />;
}
