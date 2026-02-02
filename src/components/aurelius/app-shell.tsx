"use client";

import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";

type AppShellProps = {
  children: ReactNode;
  rightSidebar?: ReactNode;
  wideSidebar?: boolean;
  sidebarWidth?: number;
};

export function AppShell({ children, rightSidebar, wideSidebar = false, sidebarWidth }: AppShellProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left Navigation Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      {/* Right Sidebar (optional) - uses dynamic width when provided */}
      {rightSidebar && (
        <div
          className={!wideSidebar ? "w-80" : undefined}
          style={wideSidebar && sidebarWidth ? { width: `${sidebarWidth}px` } : undefined}
        >
          {rightSidebar}
        </div>
      )}
    </div>
  );
}
