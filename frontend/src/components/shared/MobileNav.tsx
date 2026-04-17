"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";

const allMobileItems = [
  { href: "/dashboard", icon: "dashboard", label: "Home", roles: ["attendee", "organizer", "admin"] },
  { href: "/marketplace", icon: "storefront", label: "Events", roles: ["attendee", "organizer", "admin"] },
  { href: "/claim", icon: "redeem", label: "Claim", roles: ["attendee", "organizer", "admin"] },
  { href: "/verify", icon: "verified", label: "Verify", roles: ["attendee", "organizer", "admin"] },
  { href: "/profile", icon: "person", label: "Profile", roles: ["attendee", "organizer", "admin"] },
  { href: "/organizer", icon: "event_note", label: "Organize", roles: ["organizer", "admin"] },
  { href: "/admin", icon: "shield_person", label: "Admin", roles: ["admin"] },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role || "attendee";

  const mobileItems = allMobileItems.filter((item) => item.roles.includes(role));

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-outline-variant/20 shadow-[0_-4px_24px_rgba(0,0,0,0.05)]">
      <div className="flex items-stretch h-16">
        {mobileItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              <span className="text-[10px] font-medium font-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
