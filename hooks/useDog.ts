"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import { DOG, dogStatus, type DogAnswer, type DogCoat, type DogView } from "@/lib/game/dog";
import { FOOD_DOG } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import { dogFedText, dogRenamedText, dogWelcomeText, farmErrorMessage } from "@/lib/game/farm/messages";
import { adoptDog, dogState, feedDog, renameDog } from "@/lib/game/farm/rpc";
import type { FieldState } from "@/lib/game/farm/state";
import type { PresenceDog } from "@/lib/presence-modes";

export interface DogController {
  /** My dog (null: none, or not known yet). */
  dog: DogView | null;
  /** My food_dog bịch. */
  food: number;
  /** The dog is hungry now (the HUD's "!", the drooping sit). */
  hungry: boolean;
  /** A dog call is in flight. */
  busy: boolean;
  adopt: (name: string, coat: DogCoat) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  feed: () => Promise<boolean>;
  /** "🤚 Vuốt ve": at most one every 3 s (D27); false while too soon, or without a dog. */
  pet: () => boolean;
}

export interface DogOptions {
  token: string;
  /** The field's state, whose account part carries my dog and my food (the newest answer wins). */
  field: FieldState | null;
  /** My dog on the canvas (petting). */
  petDog: () => void;
  setPresenceDog: (d: PresenceDog | null) => void;
  toast: (text: string) => void;
  /** An adoption paid: the HUD's wallet fetches again. */
  onCoinsChanged: () => void;
}

/** My dog in game mode (v17 §7.3, §12.3): dog_state once on entering it, then every dog answer and the field's `mine.dog`,
 *  whichever is newer on the server's clock. It publishes {name, coat} to presence; the shell passes it to the canvas. */
export function useDog({ token, field, petDog, setPresenceDog, toast, onCoinsChanged }: DogOptions): DogController {
  const [own, setOwn] = useState<DogAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef({ toast, onCoinsChanged });
  useEffect(() => {
    live.current = { toast, onCoinsChanged };
  });

  // entering game mode: dog_state (before 0019 it is missing, and there is no dog)
  useEffect(() => {
    let on = true;
    dogState(token).then((a) => { if (on) setOwn(a); }, () => {});
    return () => { on = false; };
  }, [token]);

  // the newest of my own answers and the field's
  const fromField = field !== null && (own === null || field.serverNow > own.serverNow);
  const dog = fromField ? field.mine.dog : own?.dog ?? null;
  const food = fromField ? field.mine.items[FOOD_DOG] ?? 0 : own?.food ?? 0;
  const hungry = dog !== null && !dogStatus(dog, serverNow()).fed;

  const name = dog?.name ?? null, coat = dog?.coat ?? null;
  useEffect(() => {
    setPresenceDog(name !== null && coat !== null ? { name, coat } : null);
  }, [name, coat, setPresenceDog]);

  const call = useCallback(async (job: () => Promise<DogAnswer>, rpc: string, done: (a: DogAnswer) => string): Promise<boolean> => {
    setBusy(true);
    try {
      const a = await job();
      setOwn(a);
      live.current.toast(done(a));
      return true;
    } catch (err) {
      // a strike shows its modal instead
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.toast(farmErrorMessage(err, undefined, rpc));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const lastPet = useRef(-Infinity);
  return {
    dog, food, hungry, busy,
    adopt: useCallback(async (n: string, c: DogCoat) => {
      const ok = await call(() => adoptDog(token, n, c), "adopt_dog", (a) => dogWelcomeText(a.dog?.name ?? n));
      if (ok) live.current.onCoinsChanged();
      return ok;
    }, [call, token]),
    rename: useCallback((n: string) => call(() => renameDog(token, n), "rename_dog", (a) => dogRenamedText(a.dog?.name ?? n)), [call, token]),
    feed: useCallback(() => call(() => feedDog(token), "feed_dog", (a) => dogFedText(a.dog?.name ?? "")), [call, token]),
    pet: useCallback(() => {
      const t = Date.now();
      if (name === null || t - lastPet.current < DOG.petEveryMs) return false;
      lastPet.current = t;
      petDog();
      return true;
    }, [name, petDog]),
  };
}
