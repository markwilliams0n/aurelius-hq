import { AureliusAvatar } from "./aurelius-avatar";
import { UserAvatar } from "./user-avatar";
import { ThinkingWaves } from "./thinking-waves";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatMessage({ message }: { message: Message }) {
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
        </div>
      )}
    </div>
  );
}
