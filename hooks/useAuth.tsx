"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { registerAccount, loginAccount, fetchMe, logoutAccount, type Account } from "@/lib/auth";
import { saveSession, loadSession, clearSession } from "@/lib/session";
import { joinLobby, type LobbyHandle } from "@/lib/lobby";

interface AuthState {
  account: Account | null;
  token: string | null;
  loading: boolean;
  lobby: LobbyHandle | null;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // `lobby` is exposed reactively via state; lobbyRef holds the same handle for
  // imperative cleanup (unsubscribe the previous one without reading state).
  const lobbyRef = useRef<LobbyHandle | null>(null);
  const [lobby, setLobby] = useState<LobbyHandle | null>(null);

  const startLobby = useCallback((a: Account) => {
    lobbyRef.current?.unsubscribe();
    lobbyRef.current = joinLobby({ accountId: a.accountId, username: a.username });
    setLobby(lobbyRef.current);
  }, []);

  useEffect(() => {
    const s = loadSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!s) { setLoading(false); return; }
    let active = true;
    fetchMe(s.token).then((me) => {
      if (!active) return;
      if (me) { setAccount(me); setToken(s.token); startLobby(me); }
      else clearSession();
      setLoading(false);
    });
    return () => { active = false; lobbyRef.current?.unsubscribe(); lobbyRef.current = null; };
  }, [startLobby]);

  const login = useCallback(async (u: string, p: string) => {
    const r = await loginAccount(u, p);
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    const acct = (await fetchMe(r.token)) ?? { accountId: r.accountId, username: r.username, isRoot: false };
    setAccount(acct); setToken(r.token); startLobby(acct);
  }, [startLobby]);

  const register = useCallback(async (u: string, p: string) => {
    const r = await registerAccount(u, p);
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    const acct = (await fetchMe(r.token)) ?? { accountId: r.accountId, username: r.username, isRoot: false };
    setAccount(acct); setToken(r.token); startLobby(acct);
  }, [startLobby]);

  const logout = useCallback(async () => {
    if (token) await logoutAccount(token);
    lobbyRef.current?.unsubscribe(); lobbyRef.current = null; setLobby(null);
    clearSession(); setAccount(null); setToken(null);
  }, [token]);

  return (
    <Ctx.Provider value={{ account, token, loading, lobby, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
