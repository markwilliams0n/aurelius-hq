"use client";

import { AppShell } from "@/components/aurelius/app-shell";
import { MemoryBrowser } from "@/components/aurelius/memory-browser";

type MemoryItem = {
  entity: {
    id: string;
    name: string;
    type: string;
    summary: string | null;
  };
  facts: Array<{
    id: string;
    content: string;
    category: string | null;
    createdAt: Date;
  }>;
};

type MemoryClientProps = {
  initialMemory: MemoryItem[];
};

export function MemoryClient({ initialMemory }: MemoryClientProps) {
  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Browse and search the knowledge graph
          </p>
        </div>

        <div className="p-6">
          <MemoryBrowser initialMemory={initialMemory} />
        </div>
      </div>
    </AppShell>
  );
}
