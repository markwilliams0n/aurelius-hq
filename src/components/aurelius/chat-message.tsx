import { AureliusAvatar } from "./aurelius-avatar";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";

type Message = {
  role: "user" | "assistant";
  content: string;
  memories?: Array<{ factId: string; content: string }>;
};

export function ChatMessage({
  message,
  onUndo,
}: {
  message: Message;
  onUndo?: (factId: string) => void;
}) {
  const isUser = message.role === "user";

  // Strip <reply> tags from content for display
  const displayContent = message.content
    .replace(/<reply>/g, "")
    .replace(/<\/reply>/g, "")
    .replace(/<memory>[\s\S]*?<\/memory>/g, "")
    .trim();

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      {isUser ? (
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>
      ) : (
        <AureliusAvatar className="flex-shrink-0" />
      )}

      {/* Content */}
      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-lg px-4 py-2 ${
            isUser
              ? "bg-gold text-background"
              : "bg-secondary text-foreground"
          }`}
        >
          <p className="whitespace-pre-wrap">{displayContent || "..."}</p>
        </div>

        {/* Memory chips */}
        {message.memories && message.memories.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.memories.map((memory) => (
              <MemoryChip
                key={memory.factId}
                content={memory.content}
                onUndo={() => onUndo?.(memory.factId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryChip({
  content,
  onUndo,
}: {
  content: string;
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gold/10 border border-gold/20 text-sm">
      <span className="text-gold">💾</span>
      <span className="text-muted-foreground">Remembered:</span>
      <span className="text-foreground truncate max-w-[200px]">{content}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto py-0 px-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={onUndo}
      >
        undo
      </Button>
    </div>
  );
}
