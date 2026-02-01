"use client";

import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { useChatPanel } from "./chat-provider";

export function CmdKButton() {
  const { toggle } = useChatPanel();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      className="gap-2 text-muted-foreground hover:text-foreground"
    >
      <MessageSquare className="w-4 h-4" />
      <span className="hidden sm:inline">Chat</span>
      <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
        <span className="text-xs">⌘</span>K
      </kbd>
    </Button>
  );
}
