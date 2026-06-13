"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { PocuLogo } from "@/components/PocuLogo";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

const navItems = [
  { href: "/", label: "Agent", icon: Bot },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
];

export function AppSidebar({ collapsed, onCollapsedChange }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-out",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      <Link
        href="/"
        className="flex h-16 items-center border-b border-sidebar-border px-4"
      >
        <div className="flex items-center gap-3">
          <PocuLogo size={36} className="shrink-0 shadow-[0_0_12px_oklch(0.7_0.18_145/0.25)]" />
          <span
            className={cn(
              "whitespace-nowrap text-lg font-semibold text-sidebar-foreground transition-all duration-300",
              collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
            )}
          >
            POCU
          </span>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-hidden px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-all duration-300",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-transform duration-200",
                  isActive ? "text-accent" : "group-hover:scale-110"
                )}
              />
              <span
                className={cn(
                  "whitespace-nowrap transition-all duration-300",
                  collapsed ? "w-0 overflow-hidden opacity-0" : "opacity-100"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <>
              <ChevronLeft className="h-5 w-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
