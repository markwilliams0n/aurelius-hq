"use client";

import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";

type AppShellProps = {
  children: ReactNode;
  rightSidebar?: ReactNode;
};

export function AppShell({ children, rightSidebar }: AppShellProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left Navigation Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      {/* Right Sidebar (optional) */}
      {rightSidebar && (
        <aside className="w-80 border-l border-border bg-background overflow-y-auto">
          {rightSidebar}
        </aside>
      )}
    </div>
  );
}
