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
  const lobbyRef = useRef<LobbyHandle | null>(null);

  const startLobby = useCallback((a: Account) => {
    lobbyRef.current?.unsubscribe();
    lobbyRef.current = joinLobby({ accountId: a.accountId, username: a.username });
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
    return () => { active = false; lobbyRef.current?.unsubscribe(); };
  }, [startLobby]);

  const login = useCallback(async (u: string, p: string) => {
    const r = await loginAccount(u, p);
    const a = { accountId: r.accountId, username: r.username };
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    setAccount(a); setToken(r.token); startLobby(a);
  }, [startLobby]);

  const register = useCallback(async (u: string, p: string) => {
    const r = await registerAccount(u, p);
    const a = { accountId: r.accountId, username: r.username };
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    setAccount(a); setToken(r.token); startLobby(a);
  }, [startLobby]);

  const logout = useCallback(async () => {
    if (token) await logoutAccount(token);
    lobbyRef.current?.unsubscribe(); lobbyRef.current = null;
    clearSession(); setAccount(null); setToken(null);
  }, [token]);

  /* eslint-disable react-hooks/refs */
  return (
    <Ctx.Provider value={{ account, token, loading, lobby: lobbyRef.current, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
  /* eslint-enable react-hooks/refs */
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
