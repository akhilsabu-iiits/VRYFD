"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";

const allSidebarItems = [
  { href: "/dashboard", icon: "dashboard", label: "Dashboard", roles: ["attendee", "organizer", "admin"] },
  { href: "/marketplace", icon: "storefront", label: "Marketplace", roles: ["attendee", "organizer", "admin"] },
  { href: "/profile", icon: "person", label: "Profile", roles: ["attendee", "organizer", "admin"] },
  { href: "/claim", icon: "redeem", label: "Claim Center", roles: ["attendee", "organizer", "admin"] },
  { href: "/verify", icon: "verified", label: "Verify", roles: ["attendee", "organizer", "admin"] },
  { href: "/organizer", icon: "event_note", label: "Organizer", roles: ["organizer", "admin"] },
  { href: "/admin", icon: "admin_panel_settings", label: "Admin", roles: ["admin"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role || "attendee";

  const sidebarItems = allSidebarItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-[73px] bottom-0 w-64 bg-surface-container-lowest border-r border-outline-variant/15 py-6 px-4 z-40">
      <nav className="flex flex-col gap-1 flex-1">
        {sidebarItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-primary-fixed/30 text-primary border-l-[3px] border-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-low hover:translate-x-0.5"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-4 border-t border-outline-variant/15">
        <div className="px-4 py-3 bg-surface-container-low rounded-lg">
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Role</p>
          <p className="text-sm font-medium text-on-surface mt-1 flex items-center gap-2 capitalize">
            <span className={`w-2 h-2 rounded-full inline-block ${
              role === "admin" ? "bg-red-500" : role === "organizer" ? "bg-amber-500" : "bg-emerald-500"
            }`}></span>
            {role}
          </p>
        </div>
      </div>
    </aside>
  );
}
