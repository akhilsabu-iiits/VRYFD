"use client";

import React from "react";
import TopNav from "../../components/shared/TopNav";
import Sidebar from "../../components/shared/Sidebar";
import MobileNav from "../../components/shared/MobileNav";
import { useAuth } from "../../contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";

// Routes available to anonymous visitors (per PRD §6.4.3 — verify + cert view are public)
const PUBLIC_PATHS = ["/verify", "/marketplace", "/certificate"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const publicAccess = isPublicPath(pathname);

  React.useEffect(() => {
    if (loading) return;
    if (!user && !publicAccess) {
      router.replace("/login");
    }
  }, [user, loading, publicAccess, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl prism-gradient flex items-center justify-center">
            <div className="spinner text-white"></div>
          </div>
          <p className="text-on-surface-variant text-sm font-label">Loading VRYFD...</p>
        </div>
      </div>
    );
  }

  // For authenticated users: show full chrome (sidebar + top nav + mobile nav)
  if (user) {
    return (
      <>
        <TopNav />
        <Sidebar />
        <main className="pt-[73px] lg:pl-64 pb-20 lg:pb-8 min-h-screen">
          <div className="max-w-screen-xl mx-auto px-6 py-8">{children}</div>
        </main>
        <MobileNav />
      </>
    );
  }

  // For anonymous users on a public route: show TopNav + content (no sidebar)
  if (publicAccess) {
    return (
      <>
        <TopNav />
        <main className="pt-[73px] pb-8 min-h-screen">
          <div className="max-w-screen-xl mx-auto px-6 py-8">{children}</div>
        </main>
      </>
    );
  }

  return null;
}
