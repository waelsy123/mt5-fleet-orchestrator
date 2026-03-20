"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Users,
  TrendingUp,
  Copy,
  ScrollText,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vps", label: "VPS Fleet", icon: Server },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/trade", label: "Trade", icon: TrendingUp },
  { href: "/copier", label: "Copy Trading", icon: Copy },
  { href: "/copier/logs", label: "Trade History", icon: ScrollText },
  { href: "/docs", label: "API Docs", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-zinc-700 bg-zinc-900">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-700 px-4">
        <Server className="h-5 w-5 text-blue-500" />
        <span className="text-sm font-semibold text-zinc-100">
          MT5 Fleet Orchestrator
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navLinks.map((link) => {
          // Find if a more specific sibling link matches first
          const moreSpecificMatch = navLinks.some(
            (other) => other.href !== link.href && other.href.startsWith(link.href + "/") && (pathname === other.href || pathname.startsWith(other.href + "/"))
          );
          const isActive =
            link.href === "/"
              ? pathname === "/"
              : !moreSpecificMatch && (pathname === link.href || pathname.startsWith(link.href + "/"));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-500/15 text-blue-500"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
