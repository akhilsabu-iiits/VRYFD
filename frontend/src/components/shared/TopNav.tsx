"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";

export default function TopNav() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const role = user?.role || "attendee";

  const displayName =
    user?.name ||
    user?.ensName ||
    user?.email ||
    (user?.address ? user.address.slice(0, 6) + "..." + user.address.slice(-4) : "User");

  return (
    <header className="fixed top-0 w-full z-50 glass-header shadow-sm border-b border-outline-variant/15">
      <div className="flex justify-between items-center px-8 py-4 max-w-screen-2xl mx-auto">
        <Link href="/dashboard" className="text-2xl font-bold tracking-tighter text-indigo-900 font-headline">
          VRYFD
        </Link>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 prism-gradient text-white px-5 py-2 rounded-lg font-headline font-bold text-sm active:scale-95 duration-150 transition-all"
              >
                <span className="material-symbols-outlined text-lg">person</span>
                <span className="hidden sm:inline">{displayName}</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-ambient-lg border border-outline-variant/20 min-w-[220px] overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-outline-variant/15">
                    <p className="text-xs text-on-surface-variant font-label">Signed in as</p>
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <span
                      className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        role === "admin"
                          ? "bg-red-50 text-red-700"
                          : role === "organizer"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          role === "admin" ? "bg-red-500" : role === "organizer" ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                      ></span>
                      {role}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-error hover:bg-error-container/30 transition-colors flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-base">logout</span>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="prism-gradient text-white px-6 py-2 rounded-lg font-headline font-bold text-sm flex items-center gap-2 active:scale-95 duration-150 transition-all"
            >
              <span className="material-symbols-outlined text-lg">login</span>
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
