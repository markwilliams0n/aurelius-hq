"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";
import {
  MessageSquare,
  Brain,
  Activity,
  Inbox,
  CheckSquare,
  Archive,
  Settings,
  Bell,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryDebug } from "./memory-debug-provider";

const navItems = [
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/triage", icon: Inbox, label: "Triage" },
  { href: "/actions", icon: Bell, label: "Actions" },
  { href: "/tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/vault", icon: Archive, label: "Vault" },
  { href: "/memory", icon: Brain, label: "Memory" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/config", icon: Settings, label: "Cortex" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { debugMode } = useMemoryDebug();
  const [mounted, setMounted] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch("/api/action-cards/pending");
      if (res.ok) {
        const { cards } = await res.json();
        setPendingCount(Array.isArray(cards) ? cards.length : 0);
      }
    } catch {
      // Silently fail — badge just won't update
    }
  }, []);

  useEffect(() => {
    fetchPendingCount();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchPendingCount();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchPendingCount]);

  const cycleTheme = () => {
    if (theme === "dark") {
      setTheme("light");
    } else if (theme === "light") {
      setTheme("system");
    } else {
      setTheme("dark");
    }
  };

  function getThemeIcon() {
    switch (theme) {
      case "dark": return Moon;
      case "light": return Sun;
      default: return Monitor;
    }
  }

  function getThemeLabel(): string {
    switch (theme) {
      case "dark": return "Dark";
      case "light": return "Light";
      default: return "Auto";
    }
  }

  const ThemeIcon = getThemeIcon();
  const themeLabel = getThemeLabel();

  return (
    <aside className="w-20 border-r border-border bg-background flex flex-col items-center py-4 gap-1">
      {/* Logo - Aurelius Avatar */}
      <Link href="/chat" className="mb-4">
        <div className="w-10 h-10 rounded-full overflow-hidden">
          <Image
            src="/avatars/agent.png"
            alt="Aurelius"
            width={40}
            height={40}
            className="w-full h-full object-cover"
          />
        </div>
      </Link>

      {/* Nav Items */}
      <nav className="flex flex-col gap-1 w-full px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-1 py-2 rounded-lg transition-colors",
                isActive
                  ? "bg-gold/20 text-gold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
              {item.href === "/memory" && debugMode && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gold animate-pulse" />
              )}
              {item.href === "/actions" && pendingCount > 0 && (
                <span className="absolute -top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black px-1">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle - at bottom */}
      <div className="mt-auto w-full px-2">
        <button
          onClick={cycleTheme}
          className="w-full flex flex-col items-center gap-1 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title={mounted ? `Theme: ${themeLabel}` : "Theme"}
        >
          {mounted ? <ThemeIcon className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          <span className="text-[10px]">{mounted ? themeLabel : "Theme"}</span>
        </button>
      </div>
    </aside>
  );
}
