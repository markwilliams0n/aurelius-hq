"use client";

import { ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { X, GripVertical, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 320;

interface RightSidebarProps {
  /** Header title */
  title: string;
  /** Optional icon to show next to title */
  icon?: ReactNode;
  /** Content to render in the sidebar body (scrollable) */
  children: ReactNode;
  /** Called when close button is clicked */
  onClose?: () => void;
  /** Whether sidebar is expanded (wider) */
  isExpanded?: boolean;
  /** Called when expand/collapse button is clicked */
  onToggleExpand?: () => void;
  /** Current width in pixels (for resizable sidebars) */
  width?: number;
  /** Called when width changes via drag (for resizable sidebars) */
  onWidthChange?: (width: number) => void;
  /** Whether to show the resize handle */
  resizable?: boolean;
  /** Additional header content (right side, before close button) */
  headerActions?: ReactNode;
  /** Footer content (sticky at bottom, outside scroll area) */
  footer?: ReactNode;
  /** Content between header and scroll area (e.g., tabs) */
  subHeader?: ReactNode;
  /** Additional className for the outer container */
  className?: string;
  /** Render as modal with backdrop (fixed positioning) */
  modal?: boolean;
  /** For modals: called when backdrop is clicked */
  onBackdropClick?: () => void;
}

/**
 * Reusable right sidebar component with:
 * - Proper height constraints (doesn't scroll page)
 * - Internal scrolling
 * - Optional expand/collapse
 * - Optional resize handle
 * - Consistent header with close button
 */
export function RightSidebar({
  title,
  icon,
  children,
  onClose,
  isExpanded = false,
  onToggleExpand,
  width = DEFAULT_WIDTH,
  onWidthChange,
  resizable = false,
  headerActions,
  footer,
  subHeader,
  className,
  modal = false,
  onBackdropClick,
}: RightSidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing || !resizable) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current || !onWidthChange) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onWidthChange, resizable]);

  const sidebar = (
    <aside
      ref={sidebarRef}
      className={cn(
        "h-full border-l border-border bg-background flex flex-col overflow-hidden relative",
        modal && "fixed right-0 top-0 z-50",
        className
      )}
      style={{ width: resizable || modal ? `${width}px` : undefined }}
    >
      {/* Resize handle */}
      {resizable && onWidthChange && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gold/30 transition-colors z-10 flex items-center",
            isResizing && "bg-gold/50"
          )}
        >
          <GripVertical className="w-3 h-3 text-muted-foreground/50 -ml-1" />
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          {onToggleExpand && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpand}
              className="h-7 w-7 p-0"
              title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isExpanded ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeft className="w-4 h-4" />
              )}
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Sub-header (e.g., tabs) - outside scroll area */}
      {subHeader}

      {/* Content - scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {children}
      </div>

      {/* Footer - sticky at bottom */}
      {footer}
    </aside>
  );

  // For modal mode, wrap sidebar with backdrop
  if (modal) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onBackdropClick ?? onClose}
        />
        {sidebar}
      </>
    );
  }

  return sidebar;
}

/**
 * Export constants for consistent sizing
 */
export const SIDEBAR_MIN_WIDTH = MIN_WIDTH;
export const SIDEBAR_MAX_WIDTH = MAX_WIDTH;
export const SIDEBAR_DEFAULT_WIDTH = DEFAULT_WIDTH;
