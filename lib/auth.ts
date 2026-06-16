import { supabase } from "@/lib/supabase";

export interface Account { accountId: string; username: string; }
export interface AuthResult extends Account { token: string; }

function row<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

export async function registerAccount(username: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.rpc("register", { p_username: username, p_password: password });
  if (error) throw error;
  const r = row<{ account_id: string; username: string; token: string }>(data);
  return { accountId: r.account_id, username: r.username, token: r.token };
}
export async function loginAccount(username: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.rpc("login", { p_username: username, p_password: password });
  if (error) throw error;
  const r = row<{ account_id: string; username: string; token: string }>(data);
  return { accountId: r.account_id, username: r.username, token: r.token };
}
export async function fetchMe(token: string): Promise<Account | null> {
  const { data, error } = await supabase.rpc("me", { p_token: token });
  if (error) return null;
  const r = row<{ account_id: string; username: string }>(data);
  return r?.account_id ? { accountId: r.account_id, username: r.username } : null;
}
export async function logoutAccount(token: string): Promise<void> {
  await supabase.rpc("logout", { p_token: token });
}
