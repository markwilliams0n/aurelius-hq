import { Brain, Cpu, Database } from "lucide-react";

type ChatStats = {
  model: string;
  tokenCount: number;
  factsSaved: number;
};

// Context window sizes by model (in tokens)
const CONTEXT_WINDOWS: Record<string, number> = {
  "moonshotai/kimi-k2": 128000,
  "moonshotai/kimi-k2:free": 128000,
  "moonshotai/kimi-k2.5": 128000,
  "openai/gpt-4o": 128000,
  "openai/gpt-4o-mini": 128000,
  "anthropic/claude-3.5-sonnet": 200000,
  "anthropic/claude-3-opus": 200000,
};

const DEFAULT_CONTEXT_WINDOW = 128000;

export function ChatStatus({ stats }: { stats: ChatStats }) {
  // Format model name for display
  const modelDisplay = stats.model
    ? stats.model.split("/").pop() || stats.model
    : "—";

  // Get context window for this model
  const contextWindow = CONTEXT_WINDOWS[stats.model] || DEFAULT_CONTEXT_WINDOW;

  // Calculate percentage used
  const percentUsed = stats.tokenCount > 0
    ? Math.min(100, (stats.tokenCount / contextWindow) * 100)
    : 0;

  // Format token count with percentage
  const tokenDisplay = stats.tokenCount > 0
    ? `${stats.tokenCount.toLocaleString()} (${percentUsed.toFixed(1)}%)`
    : "—";

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5" title="Model">
        <Cpu className="w-3.5 h-3.5" />
        <span>{modelDisplay}</span>
      </div>
      <div className="flex items-center gap-1.5" title={`Context: ${stats.tokenCount.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}>
        <Brain className="w-3.5 h-3.5" />
        <span>{tokenDisplay}</span>
      </div>
      <div
        className="flex items-center gap-1.5"
        title="Facts saved this session"
      >
        <Database className="w-3.5 h-3.5" />
        <span>{stats.factsSaved}</span>
      </div>
    </div>
  );
}
