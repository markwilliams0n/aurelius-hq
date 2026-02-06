"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";
import {
  MessageSquare,
  Brain,
  Activity,
  Settings,
  Inbox,
  CheckSquare,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryDebug } from "./memory-debug-provider";

const navItems = [
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/triage", icon: Inbox, label: "Triage" },
  { href: "/memory", icon: Brain, label: "Memory" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/actions", icon: CheckSquare, label: "Actions", disabled: true },
  { href: "/settings", icon: Settings, label: "Settings", disabled: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { debugMode } = useMemoryDebug();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    if (theme === "dark") {
      setTheme("light");
    } else if (theme === "light") {
      setTheme("system");
    } else {
      setTheme("dark");
    }
  };

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto";

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

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="flex flex-col items-center gap-1 py-2 rounded-lg opacity-30 cursor-not-allowed"
                title={`${item.label} (coming soon)`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px]">{item.label}</span>
              </div>
            );
          }

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
