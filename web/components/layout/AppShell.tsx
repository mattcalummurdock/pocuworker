"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAgentHome = pathname === "/";
  const [collapsed, setCollapsed] = useState(isAgentHome);

  return (
    <div className="min-h-screen">
      <AppSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-all duration-300 ease-out",
          collapsed ? "ml-[72px]" : "ml-[260px]"
        )}
      >
        <AppHeader />
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            isAgentHome
              ? "bg-[radial-gradient(ellipse_at_top,oklch(0.7_0.18_145/0.06),transparent_50%)] px-4 py-6 sm:px-8"
              : "p-6"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
