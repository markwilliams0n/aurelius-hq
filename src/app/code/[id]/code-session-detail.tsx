"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/aurelius/app-shell";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import { useChat } from "@/hooks/use-chat";
import { toast } from "sonner";
import {
  ArrowLeft,
  Code,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionCardData } from "@/lib/types/action-card";
import type { SessionMode, CodeSessionData } from "@/lib/code/types";
import { deriveSessionMode } from "@/lib/code/state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProgressResponse {
  lines: string[];
  totalLines: number;
  card: {
    id: string;
    status: string;
    title: string;
    data: Record<string, unknown>;
    result: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  };
}

function getMode(card: ProgressResponse["card"] | null): SessionMode {
  if (!card) return "loading";
  return deriveSessionMode(card.status, card.data as unknown as CodeSessionData);
}

// ---------------------------------------------------------------------------
// Log line component
// ---------------------------------------------------------------------------

function LogLine({ line }: { line: string }) {
  // Parse: [2026-02-08T12:00:00.000Z] [info] message
  const match = line.match(/^\[([^\]]+)\] \[(\w+)\] (.+)$/);
  if (!match) return <div className="text-xs font-mono text-muted-foreground">{line}</div>;

  const [, , level, message] = match;
  const isError = level === "error";
  const isTool = message.startsWith("Tool:");

  return (
    <div
      className={cn(
        "text-xs font-mono py-0.5",
        isError
          ? "text-red-400"
          : isTool
            ? "text-amber-400"
            : "text-muted-foreground",
      )}
    >
      {isTool && <span className="text-muted-foreground/50 mr-1">&gt;</span>}
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session stats display
// ---------------------------------------------------------------------------

function SessionStats({ data }: { data: Record<string, unknown> }) {
  const turns = data.totalTurns as number | undefined;
  const cost = data.totalCostUsd as number | null | undefined;

  if (!turns && !cost) return null;

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {turns !== undefined && turns > 0 && (
        <span>{turns} turn{turns !== 1 ? "s" : ""}</span>
      )}
      {cost !== undefined && cost !== null && (
        <span>${cost.toFixed(4)}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CodeSessionDetail({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [card, setCard] = useState<ProgressResponse["card"] | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [lineOffset, setLineOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [respondText, setRespondText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const respondInputRef = useRef<HTMLTextAreaElement>(null);

  const mode = getMode(card);
  const data = (card?.data ?? {}) as Record<string, unknown>;
  const task = (data.task as string) || "";
  const branchName = (data.branchName as string) || "";
  const sessionId = (data.sessionId as string) || "";
  const lastMessage = (data.lastMessage as string) || "";

  // Build a conversation ID unique to this session for post-session chat
  const chatConversationId = `code-${cardId}`;

  // Build page context for the AI
  const pageContext = card
    ? [
        `Coding session: ${task}`,
        `Branch: ${branchName}`,
        card.status === "error"
          ? `Status: FAILED — ${(card.result?.error as string) || "unknown error"}`
          : `Status: ${card.status}`,
        data.result
          ? `Result: ${JSON.stringify(data.result, null, 2).slice(0, 1000)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const {
    messages,
    isStreaming,
    actionCards,
    send,
    handleCardAction,
    updateCardData,
  } = useChat({
    conversationId: chatConversationId,
    context: {
      surface: "code",
      pageContext,
    },
    loadOnMount: mode === "completed" || mode === "error",
  });

  // -------------------------------------------------------------------------
  // Fetch progress (polling)
  // -------------------------------------------------------------------------

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/code-sessions/${cardId}/progress?after=${lineOffset}`,
      );
      if (!res.ok) return;
      const data: ProgressResponse = await res.json();

      setCard(data.card);

      if (data.lines.length > 0) {
        setLogLines((prev) => [...prev, ...data.lines]);
        setLineOffset(data.totalLines);
      }
    } catch {
      // Silently fail on poll errors
    } finally {
      setIsLoading(false);
    }
  }, [cardId, lineOffset]);

  useEffect(() => {
    fetchProgress();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- only on mount

  // Poll while running or waiting
  useEffect(() => {
    if (mode !== "running" && mode !== "loading" && mode !== "pending" && mode !== "waiting") return;
    const interval = setInterval(fetchProgress, 2000);
    return () => clearInterval(interval);
  }, [mode, fetchProgress]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  // Focus respond input when entering waiting mode
  useEffect(() => {
    if (mode === "waiting") {
      respondInputRef.current?.focus();
    }
  }, [mode]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleAction = useCallback(
    async (
      actionCardId: string,
      actionName: string,
      editedData?: Record<string, unknown>,
    ) => {
      try {
        const response = await fetch(`/api/action-card/${actionCardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: editedData }),
        });
        if (!response.ok) throw new Error("Action failed");
        const result = await response.json();

        if (result.status === "needs_confirmation") {
          if (confirm(result.confirmMessage || "Are you sure?")) {
            return handleAction(actionCardId, actionName, {
              ...editedData,
              _confirmed: true,
            });
          }
          return;
        }

        if (result.status === "confirmed") {
          toast.success(result.successMessage || "Done!");
        } else if (result.status === "dismissed") {
          toast.success("Dismissed");
        } else if (result.status === "error") {
          toast.error(result.result?.error || "Action failed");
        }

        // Refresh card state
        fetchProgress();
      } catch {
        toast.error("Action failed");
      }
    },
    [fetchProgress],
  );

  const handleStop = useCallback(() => {
    if (!card) return;
    handleAction(cardId, "stop", {
      sessionId,
      worktreePath: data.worktreePath as string,
      branchName,
    });
  }, [card, cardId, sessionId, data.worktreePath, branchName, handleAction]);

  const handleRestart = useCallback(async () => {
    try {
      const res = await fetch("/api/code-sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, context: data.context }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const { card: newCard } = await res.json();
      toast.success("New session created");
      router.push(`/code/${newCard.id}`);
    } catch {
      toast.error("Failed to restart session");
    }
  }, [task, data.context, router]);

  const handleStart = useCallback(() => {
    handleAction(cardId, "confirm", {
      ...data,
      _confirmed: true,
    });
  }, [cardId, data, handleAction]);

  const handleRespond = useCallback(async () => {
    if (!respondText.trim() || isSending) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/code-sessions/${cardId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: respondText.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send response");
      }

      setRespondText("");
      // Refresh to pick up the new state
      fetchProgress();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send response");
    } finally {
      setIsSending(false);
    }
  }, [respondText, isSending, cardId, fetchProgress]);

  const handleFinish = useCallback(() => {
    handleAction(cardId, "finish", { sessionId });
  }, [cardId, sessionId, handleAction]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!card) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-full text-center">
          <p className="text-muted-foreground">Session not found</p>
          <Link href="/code" className="text-gold hover:underline mt-2 text-sm">
            Back to sessions
          </Link>
        </div>
      </AppShell>
    );
  }

  // Build card object for ActionCard component
  const cardObj: ActionCardData = {
    id: card.id,
    pattern: "code",
    status: card.status as ActionCardData["status"],
    title: card.title,
    data: card.data,
    handler: "code:start",
    result: card.result,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };

  const showPostChat = mode === "completed" || mode === "error";
  const showLog = mode === "running" || mode === "waiting";

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-3">
          <div className="max-w-3xl mx-auto">
            <Link
              href="/code"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Sessions
            </Link>
            <div className="flex items-center gap-3">
              <Code className="w-5 h-5 text-gold" />
              <h1 className="font-serif text-lg truncate">{card.title}</h1>
              <StatusBadge mode={mode} />
            </div>
            <div className="flex items-center gap-4 mt-1">
              {branchName && (
                <p className="text-xs text-muted-foreground">
                  Branch:{" "}
                  <code className="bg-muted/50 px-1.5 py-0.5 rounded font-mono">
                    {branchName}
                  </code>
                </p>
              )}
              <SessionStats data={data} />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-4 space-y-6">
            {/* Pending — show card with Start button */}
            {mode === "pending" && (
              <div className="space-y-4">
                <p className="text-sm text-foreground">{task}</p>
                {data.context ? (
                  <p className="text-sm text-muted-foreground">
                    {String(data.context)}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    onClick={handleStart}
                    className="bg-green-600 hover:bg-green-500 text-white"
                    size="sm"
                  >
                    Start Session
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleAction(cardId, "dismiss", data);
                      router.push("/code");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Running / Waiting — live progress + optional chat */}
            {showLog && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    {mode === "running" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                        <span className="text-amber-400 font-medium">
                          Working...
                        </span>
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4 text-blue-400" />
                        <span className="text-blue-400 font-medium">
                          Waiting for your response
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {mode === "waiting" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFinish}
                      >
                        Finish Session
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleStop}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Stop
                    </Button>
                  </div>
                </div>

                {/* Log viewer */}
                <div className="bg-muted/30 rounded-lg p-4 max-h-72 overflow-y-auto">
                  {logLines.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Waiting for output...
                    </p>
                  ) : (
                    logLines.map((line, i) => <LogLine key={i} line={line} />)
                  )}
                  <div ref={logEndRef} />
                </div>

                {/* Claude's message + respond input (waiting mode) */}
                {mode === "waiting" && (
                  <div className="space-y-3">
                    {lastMessage && (
                      <div className="bg-muted/50 border border-border rounded-lg p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Claude says:
                        </p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {lastMessage}
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <textarea
                        ref={respondInputRef}
                        value={respondText}
                        onChange={(e) => setRespondText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleRespond();
                          }
                        }}
                        placeholder="Type your response..."
                        className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-gold/50"
                        rows={2}
                        disabled={isSending}
                      />
                      <Button
                        onClick={handleRespond}
                        disabled={!respondText.trim() || isSending}
                        size="sm"
                        className="self-end"
                      >
                        {isSending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Completed — results card */}
            {mode === "completed" && (
              <ActionCard
                card={cardObj}
                onAction={(action, editedData) =>
                  handleAction(cardId, action, editedData ?? card.data)
                }
              >
                <CardContent
                  card={cardObj}
                  onDataChange={() => {}}
                  onAction={(action, actionData) =>
                    handleAction(
                      cardId,
                      action,
                      actionData ?? card.data,
                    )
                  }
                />
              </ActionCard>
            )}

            {/* Error — show error + restart */}
            {mode === "error" && (
              <div className="space-y-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <p className="text-sm text-red-400 font-medium mb-1">
                    Session failed
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {(card.result?.error as string) || "Unknown error"}
                  </p>
                </div>

                {logLines.length > 0 && (
                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      <Terminal className="w-3 h-3 inline mr-1" />
                      Session log ({logLines.length} lines)
                    </summary>
                    <div className="bg-muted/30 rounded-lg p-4 mt-2 max-h-64 overflow-y-auto">
                      {logLines.map((line, i) => (
                        <LogLine key={i} line={line} />
                      ))}
                    </div>
                  </details>
                )}

                <Button onClick={handleRestart} variant="outline" size="sm">
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Restart with same task
                </Button>
              </div>
            )}

            {/* Chat section — for completed and error modes */}
            {showPostChat && (
              <div className="border-t border-border pt-6 space-y-4">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Chat
                </h2>

                {messages.length > 0 && (
                  <div className="space-y-4">
                    {messages.map((message, index) => {
                      const cards = actionCards.get(message.id);
                      const isLast = index === messages.length - 1;
                      return (
                        <div key={message.id || index}>
                          <ChatMessage
                            message={message}
                            isStreaming={
                              isStreaming && isLast && message.role === "assistant"
                            }
                          />
                          {cards?.map((c) => (
                            <div key={c.id} className="ml-11 mt-2">
                              <ActionCard
                                card={c}
                                onAction={(action, editedData) =>
                                  handleCardAction(
                                    c.id,
                                    action,
                                    editedData ?? c.data,
                                  )
                                }
                              >
                                <CardContent
                                  card={c}
                                  onDataChange={(newData) =>
                                    updateCardData(c.id, newData)
                                  }
                                  onAction={(action, actionData) =>
                                    handleCardAction(
                                      c.id,
                                      action,
                                      actionData ?? c.data,
                                    )
                                  }
                                />
                              </ActionCard>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chat input — pinned to bottom for completed/error modes */}
        {showPostChat && (
          <div className="shrink-0 border-t border-border px-6 py-3">
            <div className="max-w-3xl mx-auto">
              <ChatInput onSend={send} disabled={isStreaming} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ mode }: { mode: SessionMode }) {
  const config: Record<SessionMode, { label: string; className: string }> = {
    loading: { label: "Loading", className: "text-muted-foreground" },
    pending: {
      label: "Pending",
      className: "bg-amber-500/20 text-amber-400",
    },
    running: {
      label: "Running",
      className: "bg-amber-500/20 text-amber-400",
    },
    waiting: {
      label: "Needs Response",
      className: "bg-blue-500/20 text-blue-400",
    },
    completed: {
      label: "Completed",
      className: "bg-green-500/20 text-green-400",
    },
    error: { label: "Failed", className: "bg-red-500/20 text-red-400" },
  };

  const { label, className } = config[mode];

  return (
    <span
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full",
        className,
      )}
    >
      {label}
    </span>
  );
}
