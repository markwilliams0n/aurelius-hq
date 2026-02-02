"use client";

import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";

type AppShellProps = {
  children: ReactNode;
  rightSidebar?: ReactNode;
  wideSidebar?: boolean;
};

export function AppShell({ children, rightSidebar, wideSidebar = false }: AppShellProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left Navigation Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      {/* Right Sidebar (optional) - wider when showing tool panel */}
      {rightSidebar && (
        <div className={wideSidebar ? "w-[480px]" : "w-80"}>
          {rightSidebar}
        </div>
      )}
    </div>
  );
}
