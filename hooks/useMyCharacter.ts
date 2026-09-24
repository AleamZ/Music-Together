"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOOK, fetchCharacters } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";

export interface MyCharacter {
  /** null while loading. */
  look: Look | null;
  /** false = no saved character yet → the editor opens in create mode. */
  exists: boolean;
  /** Call after a successful save. */
  setSaved: (look: Look) => void;
}

export function useMyCharacter(accountId: string): MyCharacter {
  const [state, setState] = useState<{ id: string; look: Look | null; exists: boolean }>({ id: accountId, look: null, exists: true });

  useEffect(() => {
    let active = true;
    fetchCharacters([accountId])
      .then((found) => {
        if (active) setState({ id: accountId, look: found.get(accountId) ?? DEFAULT_LOOK, exists: found.has(accountId) });
      })
      // We can't tell whether a row exists → play with the default look rather than forcing the editor.
      .catch(() => {
        if (active) setState({ id: accountId, look: DEFAULT_LOOK, exists: true });
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const setSaved = useCallback((look: Look) => setState({ id: accountId, look, exists: true }), [accountId]);
  const mine = state.id === accountId;
  return { look: mine ? state.look : null, exists: mine ? state.exists : true, setSaved };
}
