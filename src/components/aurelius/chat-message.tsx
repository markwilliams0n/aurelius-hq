import { AureliusAvatar } from "./aurelius-avatar";
import { UserAvatar } from "./user-avatar";
import { ThinkingWaves } from "./thinking-waves";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type WaveState = "thinking" | "error" | "streaming";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  hasError?: boolean;
}

export function ChatMessage({ message, isStreaming = false, hasError = false }: ChatMessageProps) {
  const isUser = message.role === "user";

  // Strip <reply> tags from content for display
  const displayContent = message.content
    .replace(/<reply>/g, "")
    .replace(/<\/reply>/g, "")
    .replace(/<memory>[\s\S]*?<\/memory>/g, "")
    .trim();

  // Determine wave state
  const getWaveState = (): WaveState => {
    if (hasError) return "error";
    if (isStreaming && displayContent) return "streaming";
    return "thinking";
  };

  // Only show waves if actively streaming with no content yet
  // Dead/old empty messages just show nothing
  const showWaves = !isUser && !displayContent && isStreaming;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      {isUser ? (
        <UserAvatar className="flex-shrink-0" />
      ) : (
        <AureliusAvatar className="flex-shrink-0" />
      )}

      {/* Content */}
      {showWaves ? (
        // Active thinking/streaming state - waves extend across full width
        <div className="flex-1 -ml-3">
          <ThinkingWaves state={getWaveState()} />
        </div>
      ) : !isUser && !displayContent ? (
        // Dead empty message - show minimal placeholder
        <div className="text-muted-foreground text-sm italic">...</div>
      ) : (
        <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : ""}`}>
          <div
            className={`rounded-lg px-4 py-2 ${
              isUser
                ? "bg-gold text-background"
                : "bg-secondary text-foreground"
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{displayContent}</p>
            ) : (
              <div className="chat-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {displayContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
