"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { registerAccount, loginAccount, fetchMe, logoutAccount, type Account, type AuthResult } from "@/lib/auth";
import { saveSession, loadSession, clearSession } from "@/lib/session";
import { joinLobby, type LobbyHandle } from "@/lib/lobby";
import { resumeEmailSession, signInEmail, signOutEmail } from "@/lib/email-auth";

interface AuthState {
  account: Account | null;
  token: string | null;
  loading: boolean;
  lobby: LobbyHandle | null;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  /** Email login (0112). False: the email user has no game account yet (the /auth/callback page creates it). */
  loginWithEmail: (email: string, password: string) => Promise<boolean>;
  /** Takes a game session obtained elsewhere (the /auth pages). */
  adoptSession: (r: AuthResult) => Promise<void>;
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

  const adopt = useCallback(async (r: AuthResult) => {
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    const acct = (await fetchMe(r.token)) ?? { accountId: r.accountId, username: r.username, isRoot: false };
    setAccount(acct); setToken(r.token); startLobby(acct);
  }, [startLobby]);

  useEffect(() => {
    let active = true;
    (async () => {
      const s = loadSession();
      const me = s ? await fetchMe(s.token) : null;
      if (!active) return;
      if (s && me) { setAccount(me); setToken(s.token); startLobby(me); setLoading(false); return; }
      if (s) clearSession();
      // no (valid) game session: a still signed-in email user gets a fresh one
      try {
        const r = await resumeEmailSession();
        if (active && r) await adopt(r);
      } catch { /* not signed in by email, or refused: the login screen */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; lobbyRef.current?.unsubscribe(); lobbyRef.current = null; };
  }, [startLobby, adopt]);

  const login = useCallback(async (u: string, p: string) => {
    await adopt(await loginAccount(u, p));
  }, [adopt]);

  const register = useCallback(async (u: string, p: string) => {
    await adopt(await registerAccount(u, p));
  }, [adopt]);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    const r = await signInEmail(email, password);
    if (!r) return false;
    await adopt(r);
    return true;
  }, [adopt]);

  const logout = useCallback(async () => {
    if (token) await logoutAccount(token);
    await signOutEmail();
    lobbyRef.current?.unsubscribe(); lobbyRef.current = null; setLobby(null);
    clearSession(); setAccount(null); setToken(null);
  }, [token]);

  return (
    <Ctx.Provider value={{ account, token, loading, lobby, login, register, loginWithEmail, adoptSession: adopt, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
