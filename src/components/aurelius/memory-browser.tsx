"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, Trash2, User, Briefcase, Building, Hash, FileText, Users } from "lucide-react";
import { toast } from "sonner";

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

const typeIcons: Record<string, React.ReactNode> = {
  person: <User className="w-4 h-4" />,
  project: <Briefcase className="w-4 h-4" />,
  company: <Building className="w-4 h-4" />,
  topic: <Hash className="w-4 h-4" />,
  document: <FileText className="w-4 h-4" />,
  team: <Users className="w-4 h-4" />,
};

export function MemoryBrowser({
  initialMemory,
}: {
  initialMemory: MemoryItem[];
}) {
  const [memory, setMemory] = useState(initialMemory);
  const [search, setSearch] = useState("");
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  // Filter entities by search
  const filteredMemory = memory.filter((item) => {
    const searchLower = search.toLowerCase();
    return (
      item.entity.name.toLowerCase().includes(searchLower) ||
      item.entity.type.toLowerCase().includes(searchLower) ||
      item.facts.some((f) => f.content.toLowerCase().includes(searchLower))
    );
  });

  const handleDeleteFact = async (factId: string) => {
    try {
      const response = await fetch(`/api/memory/${factId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      // Remove fact from state
      setMemory((prev) =>
        prev.map((item) => ({
          ...item,
          facts: item.facts.filter((f) => f.id !== factId),
        }))
      );

      toast.success("Fact deleted");
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete fact");
    }
  };

  const totalFacts = memory.reduce((sum, item) => sum + item.facts.length, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{memory.length} entities</span>
        <span>·</span>
        <span>{totalFacts} facts</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search memory..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Entity list */}
      <div className="space-y-4">
        {filteredMemory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? "No matching memories" : "No memories yet. Start chatting to build knowledge."}
          </div>
        ) : (
          filteredMemory.map((item) => (
            <Card key={item.entity.id}>
              <CardHeader
                className="cursor-pointer"
                onClick={() =>
                  setExpandedEntity(
                    expandedEntity === item.entity.id ? null : item.entity.id
                  )
                }
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-gold">
                    {typeIcons[item.entity.type] || <Hash className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{item.entity.name}</CardTitle>
                    <CardDescription className="capitalize">
                      {item.entity.type} · {item.facts.length} facts
                    </CardDescription>
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {expandedEntity === item.entity.id ? "▼" : "▶"}
                  </span>
                </div>
              </CardHeader>

              {expandedEntity === item.entity.id && (
                <CardContent>
                  {item.entity.summary && (
                    <p className="text-sm text-muted-foreground mb-4 italic">
                      {item.entity.summary}
                    </p>
                  )}

                  <div className="space-y-2">
                    {item.facts.map((fact) => (
                      <div
                        key={fact.id}
                        className="flex items-start gap-3 py-2 px-3 rounded-md bg-secondary/50 group"
                      >
                        <div className="flex-1">
                          <p className="text-sm">{fact.content}</p>
                          {fact.category && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {fact.category}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                          onClick={() => handleDeleteFact(fact.id)}
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
