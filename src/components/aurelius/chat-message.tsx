import { AureliusAvatar } from "./aurelius-avatar";
import { UserAvatar } from "./user-avatar";
import { ThinkingWaves } from "./thinking-waves";
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
        <UserAvatar className="flex-shrink-0" />
      ) : (
        <AureliusAvatar className="flex-shrink-0" />
      )}

      {/* Content */}
      {!isUser && !displayContent ? (
        // Thinking state - waves extend across full width, no chat bubble
        <div className="flex-1 -ml-3">
          <ThinkingWaves />
        </div>
      ) : (
        <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : ""}`}>
          <div
            className={`rounded-lg px-4 py-2 ${
              isUser
                ? "bg-gold text-background"
                : "bg-secondary text-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap">{displayContent}</p>
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
      )}
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
