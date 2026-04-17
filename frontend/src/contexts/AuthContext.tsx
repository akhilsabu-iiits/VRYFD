"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface User {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  address?: string;
  walletAddress?: string;
  ensName?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name?: string, inviteToken?: string) => Promise<void>;
  loginWithWallet: (address: string, name: string, ensName?: string) => Promise<void>;
  linkWallet: (address: string, ensName?: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginWithEmail: async () => {},
  registerWithEmail: async () => {},
  loginWithWallet: async () => {},
  linkWallet: async () => {},
  logout: () => {},
  error: null,
  clearError: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("vryfd_token");
    const walletUser = localStorage.getItem("vryfd_wallet_user");
    if (token) {
      fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          setUser({ ...data.user, address: data.user.walletAddress });
        })
        .catch(() => {
          localStorage.removeItem("vryfd_token");
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else if (walletUser) {
      try {
        setUser(JSON.parse(walletUser));
      } catch {
        localStorage.removeItem("vryfd_wallet_user");
      }
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, []);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    setError(null);
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    localStorage.setItem("vryfd_token", data.token);
    setUser({ ...data.user, address: data.user.walletAddress });
  }, []);

  const registerWithEmail = useCallback(async (email: string, password: string, name?: string, inviteToken?: string) => {
    setError(null);
    const body: Record<string, string> = { email, password };
    if (name) body.name = name;
    if (inviteToken) body.inviteToken = inviteToken;
    const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    localStorage.setItem("vryfd_token", data.token);
    setUser({ ...data.user, address: data.user.walletAddress });
  }, []);

  const loginWithWallet = useCallback(async (address: string, name: string, ensName?: string) => {
    // Ask the backend whether this wallet is registered as an admin or
    // bound to an existing user. The response either issues a JWT (for
    // admins / linked accounts) or tells us to proceed as a wallet-only
    // attendee (which is what the old behavior did).
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/wallet-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, name, ensName }),
      });
      const data = await res.json();
      if (res.ok && data.token && data.user) {
        // Admin or linked user — store JWT and use server-issued role
        localStorage.setItem("vryfd_token", data.token);
        localStorage.removeItem("vryfd_wallet_user");
        setUser({
          ...data.user,
          address,
          walletAddress: address,
          ensName: ensName || undefined,
        });
        return;
      }
    } catch (err) {
      console.warn("[auth] wallet-login failed, falling back to attendee:", err);
    }
    // Fallback: wallet-only attendee
    const walletUser: User = { address, walletAddress: address, name, ensName: ensName || undefined, role: "attendee" };
    localStorage.setItem("vryfd_wallet_user", JSON.stringify(walletUser));
    setUser(walletUser);
  }, []);

  const linkWallet = useCallback(async (address: string, ensName?: string) => {
    const token = localStorage.getItem("vryfd_token");
    if (!token) return;
    const res = await fetch(`${BACKEND_URL}/api/auth/link-wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ walletAddress: address, ensName }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser((prev) => (prev ? { ...prev, address, walletAddress: address, ensName: ensName || undefined } : prev));
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("vryfd_token");
    localStorage.removeItem("vryfd_wallet_user");
    setUser(null);
  }, []);

  // Keep the app's "current user" in lockstep with MetaMask's selected account.
  // Any time the user switches accounts (or disconnects all of them) in MetaMask
  // we throw away the cached JWT / wallet-user so the stale role / identity
  // can't leak into a different wallet's session.
  useEffect(() => {
    const eth = (globalThis as { ethereum?: { on?: (e: string, fn: (a: string[]) => void) => void; removeListener?: (e: string, fn: (a: string[]) => void) => void } }).ethereum;
    if (!eth?.on) return;
    const handler = (accounts: string[]) => {
      const current = accounts?.[0]?.toLowerCase();
      const bound = (user?.address || "").toLowerCase();
      if (!current) {
        // Disconnected all accounts — log out.
        logout();
      } else if (bound && current !== bound) {
        // Switched to a different wallet — drop the stale session.
        console.warn(`[auth] MetaMask account changed (${bound} → ${current}); clearing session`);
        logout();
      }
    };
    eth.on("accountsChanged", handler);
    return () => eth.removeListener?.("accountsChanged", handler);
  }, [user?.address, logout]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{ user, loading, loginWithEmail, registerWithEmail, loginWithWallet, linkWallet, logout, error, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
