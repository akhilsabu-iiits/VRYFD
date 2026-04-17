"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import { useAccount, useEnsName } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams?.get("invite") || null;

  const { user, loginWithEmail, registerWithEmail, loginWithWallet } = useAuth();
  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address });
  const { openConnectModal } = useConnectModal();

  const [isRegister, setIsRegister] = useState(!!inviteToken);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ email: string; role: string } | null>(null);

  // Wallet name prompt
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletName, setWalletName] = useState("");

  useEffect(() => {
    if (!inviteToken) return;
    fetch(`${BACKEND_URL}/api/auth/invite/${inviteToken}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        setInviteInfo(data);
        setEmail(data.email || "");
        setIsRegister(true);
      })
      .catch(() => {
        setError("This invite link is invalid or has already been used.");
      });
  }, [inviteToken]);

  useEffect(() => {
    if (user) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  // When wallet connects, show name prompt instead of auto-login
  useEffect(() => {
    if (isConnected && address && !user) {
      setWalletConnected(true);
    }
  }, [isConnected, address, user]);

  const handleWalletLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletName.trim() || !address) return;
    loginWithWallet(address, walletName.trim(), ensName || undefined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isRegister && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (isRegister && !fullName.trim()) {
      setError("Full name is required");
      return;
    }
    setLoading(true);
    try {
      if (isRegister) {
        await registerWithEmail(email, password, fullName.trim(), inviteToken || undefined);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  if (user) return null;

  // Wallet name prompt screen
  if (walletConnected && !user) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-extrabold font-headline text-primary tracking-tight">VRYFD</h1>
            <p className="text-on-surface-variant text-sm mt-1">Almost there!</p>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-600">check_circle</span>
              </div>
              <div>
                <p className="font-bold font-headline text-on-surface text-sm">Wallet Connected</p>
                <p className="text-xs text-on-surface-variant font-mono">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
              </div>
            </div>

            <form onSubmit={handleWalletLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Your Name *
                </label>
                <input
                  type="text"
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3.5 px-6 rounded-xl prism-gradient text-white font-headline font-bold text-sm active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">login</span>
                Continue
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Left panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 prism-gradient relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="mb-8">
            <h1 className="text-5xl font-extrabold font-headline tracking-tight mb-4">VRYFD</h1>
            <p className="text-xl font-headline text-white/80 leading-relaxed">
              Decentralized Event Attendance & Certification
            </p>
          </div>
          <div className="space-y-6">
            {[
              { icon: "verified", text: "Soulbound attendance certificates on-chain" },
              { icon: "emoji_events", text: "Earn VRYF tokens and milestone rewards" },
              { icon: "qr_code_scanner", text: "QR check-in with wallet verification" },
              { icon: "groups", text: "Join virtual and in-person events seamlessly" },
            ].map((item) => (
              <div key={item.icon} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-white/90">{item.icon}</span>
                </div>
                <p className="text-white/80 text-sm font-body">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5" />
      </div>

      {/* Right panel - Auth forms */}
      <div className="flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-10">
            <h1 className="text-3xl font-extrabold font-headline text-primary tracking-tight">VRYFD</h1>
            <p className="text-on-surface-variant text-sm mt-1">Decentralized Attendance</p>
          </div>

          {inviteToken && inviteInfo && (
            <div className="mb-6 p-4 rounded-xl bg-primary-fixed/30 border border-primary/20">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-2xl">celebration</span>
                <div>
                  <p className="font-bold font-headline text-on-surface text-sm">
                    You&apos;ve been invited as an Organizer
                  </p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Create your account to start managing events on VRYFD
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-2xl font-bold font-headline text-on-surface">
              {inviteToken
                ? "Accept your invitation"
                : isRegister
                ? "Create your account"
                : "Welcome back"}
            </h2>
            <p className="text-on-surface-variant mt-2 text-sm">
              {inviteToken
                ? "Set up your organizer account below"
                : isRegister
                ? "Sign up to start attending events"
                : "Sign in to your VRYFD account"}
            </p>
          </div>

          {!inviteToken && (
            <>
              <button
                onClick={openConnectModal}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-xl border-2 border-outline-variant/30 bg-surface-container-lowest hover:border-primary/30 hover:bg-primary-fixed/10 transition-all duration-200 mb-6 group"
              >
                <span className="material-symbols-outlined text-primary text-xl">account_balance_wallet</span>
                <span className="font-headline font-bold text-sm text-on-surface group-hover:text-primary transition-colors">
                  Connect Wallet
                </span>
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-outline-variant/30" />
                <span className="text-xs text-on-surface-variant font-label uppercase tracking-wider">
                  or continue with email
                </span>
                <div className="flex-1 h-px bg-outline-variant/30" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                readOnly={!!inviteToken && !!inviteInfo?.email}
                className={`w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline ${
                  inviteToken && inviteInfo?.email ? "bg-surface-container-low text-on-surface-variant" : ""
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  minLength={6}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error-container/30 border border-error/20 text-error text-sm">
                <span className="material-symbols-outlined text-lg">error</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-6 rounded-xl prism-gradient text-white font-headline font-bold text-sm active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="spinner text-white" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">
                    {isRegister ? "person_add" : "login"}
                  </span>
                  {inviteToken ? "Create Organizer Account" : isRegister ? "Create Account" : "Sign In"}
                </>
              )}
            </button>
          </form>

          {!inviteToken && (
            <p className="text-center text-sm text-on-surface-variant mt-6">
              {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError("");
                }}
                className="text-primary font-bold hover:underline"
              >
                {isRegister ? "Sign In" : "Sign Up"}
              </button>
            </p>
          )}

          <p className="text-center text-xs text-outline mt-8">
            By continuing, you agree to our terms of service
          </p>
        </div>
      </div>
    </div>
  );
}
