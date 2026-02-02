"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Brain,
  Activity,
  Settings,
  Home,
  Inbox,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/memory", icon: Brain, label: "Memory" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/triage", icon: Inbox, label: "Triage", disabled: true },
  { href: "/actions", icon: CheckSquare, label: "Actions", disabled: true },
  { href: "/settings", icon: Settings, label: "Settings", disabled: true },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-16 border-r border-border bg-background flex flex-col items-center py-4 gap-2">
      {/* Logo */}
      <Link href="/" className="mb-4">
        <div className="w-10 h-10 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
          <span className="font-serif text-gold text-lg">A</span>
        </div>
      </Link>

      {/* Nav Items */}
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="w-10 h-10 rounded-lg flex items-center justify-center opacity-30 cursor-not-allowed"
                title={`${item.label} (coming soon)`}
              >
                <Icon className="w-5 h-5" />
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                isActive
                  ? "bg-gold/20 text-gold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              title={item.label}
            >
              <Icon className="w-5 h-5" />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
