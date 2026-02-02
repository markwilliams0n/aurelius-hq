"use client";

import { useEffect, useState } from "react";
import { X, Brain, Clock, HeartPulse, Play, CheckCircle, AlertCircle, Loader2, User, Building, FolderKanban, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Memory = {
  id: string;
  entityName: string;
  content: string;
  category: string;
  createdAt: string;
  source: string;
};

type EntityDetail = {
  name: string;
  type: 'person' | 'company' | 'project';
  facts: string[];
  action: 'created' | 'updated';
  source: string;
};

type HeartbeatResult = {
  success: boolean;
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  timestamp: string;
  error?: string;
  entities?: EntityDetail[];
  extractionMethod?: 'ollama' | 'pattern';
};

type SynthesisResult = {
  success: boolean;
  entitiesProcessed: number;
  factsArchived: number;
  summariesRegenerated: number;
  timestamp: string;
  error?: string;
};

type MemorySidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | null;
};

export function MemorySidebar({ isOpen, onClose, conversationId }: MemorySidebarProps) {
  const [memories, setMemories] = useState<{
    created: Memory[];
    used: Memory[];
  }>({ created: [], used: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"created" | "used" | "heartbeat">("created");

  // Heartbeat state
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [heartbeatResults, setHeartbeatResults] = useState<HeartbeatResult[]>([]);

  // Synthesis state
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [synthesisResults, setSynthesisResults] = useState<SynthesisResult[]>([]);

  useEffect(() => {
    if (isOpen && conversationId) {
      loadMemories();
    }
  }, [isOpen, conversationId]);

  const loadMemories = async () => {
    if (!conversationId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/conversation/${conversationId}/memories`);
      if (response.ok) {
        const data = await response.json();
        setMemories(data);
      }
    } catch (error) {
      console.error("Failed to load memories:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const runHeartbeat = async () => {
    setHeartbeatRunning(true);
    try {
      const response = await fetch('/api/heartbeat', { method: 'POST' });
      const data = await response.json();

      const result: HeartbeatResult = {
        success: data.success ?? response.ok,
        entitiesCreated: data.entitiesCreated ?? 0,
        entitiesUpdated: data.entitiesUpdated ?? 0,
        reindexed: data.reindexed ?? false,
        timestamp: new Date().toISOString(),
        error: data.error,
        entities: data.entities ?? [],
        extractionMethod: data.extractionMethod,
      };

      setHeartbeatResults(prev => [result, ...prev].slice(0, 10)); // Keep last 10
    } catch (error) {
      setHeartbeatResults(prev => [{
        success: false,
        entitiesCreated: 0,
        entitiesUpdated: 0,
        reindexed: false,
        timestamp: new Date().toISOString(),
        error: String(error),
        entities: [],
      }, ...prev].slice(0, 10));
    } finally {
      setHeartbeatRunning(false);
    }
  };

  const runSynthesis = async () => {
    setSynthesisRunning(true);
    try {
      const response = await fetch('/api/synthesis', { method: 'POST' });
      const data = await response.json();

      const result: SynthesisResult = {
        success: data.success ?? response.ok,
        entitiesProcessed: data.entitiesProcessed ?? 0,
        factsArchived: data.factsArchived ?? 0,
        summariesRegenerated: data.summariesRegenerated ?? 0,
        timestamp: new Date().toISOString(),
        error: data.error,
      };

      setSynthesisResults(prev => [result, ...prev].slice(0, 5)); // Keep last 5
    } catch (error) {
      setSynthesisResults(prev => [{
        success: false,
        entitiesProcessed: 0,
        factsArchived: 0,
        summariesRegenerated: 0,
        timestamp: new Date().toISOString(),
        error: String(error),
      }, ...prev].slice(0, 5));
    } finally {
      setSynthesisRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-serif text-lg text-gold">Memories</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === "created"
                ? "text-gold border-b-2 border-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("created")}
          >
            <Brain className="w-4 h-4 inline mr-1" />
            Created
          </button>
          <button
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === "used"
                ? "text-gold border-b-2 border-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("used")}
          >
            <Clock className="w-4 h-4 inline mr-1" />
            Used
          </button>
          <button
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === "heartbeat"
                ? "text-gold border-b-2 border-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("heartbeat")}
          >
            <HeartPulse className="w-4 h-4 inline mr-1" />
            Heartbeat
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "heartbeat" ? (
            <HeartbeatTab
              isRunning={heartbeatRunning}
              results={heartbeatResults}
              onRun={runHeartbeat}
              synthesisRunning={synthesisRunning}
              synthesisResults={synthesisResults}
              onRunSynthesis={runSynthesis}
            />
          ) : isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              Loading...
            </div>
          ) : !conversationId ? (
            <div className="text-center text-muted-foreground py-8">
              Start a conversation to see memories
            </div>
          ) : (
            <div className="space-y-3">
              {(activeTab === "created" ? memories.created : memories.used).length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No memories {activeTab === "created" ? "created" : "used"} yet
                </div>
              ) : (
                (activeTab === "created" ? memories.created : memories.used).map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function HeartbeatTab({
  isRunning,
  results,
  onRun,
  synthesisRunning,
  synthesisResults,
  onRunSynthesis,
}: {
  isRunning: boolean;
  results: HeartbeatResult[];
  onRun: () => void;
  synthesisRunning: boolean;
  synthesisResults: SynthesisResult[];
  onRunSynthesis: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Heartbeat Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-gold" />
          Heartbeat
        </h3>
        <Button
          onClick={onRun}
          disabled={isRunning || synthesisRunning}
          className="w-full"
          variant="outline"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Extracting entities...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run Heartbeat
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Scans daily notes and extracts entities
        </p>
      </div>

      {/* Synthesis Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          Weekly Synthesis
        </h3>
        <Button
          onClick={onRunSynthesis}
          disabled={synthesisRunning || isRunning}
          className="w-full"
          variant="outline"
        >
          {synthesisRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing decay...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Run Synthesis
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Archives cold facts and regenerates summaries
        </p>
      </div>

      {/* Synthesis Results */}
      {synthesisResults.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Synthesis Results</h4>
          {synthesisResults.map((result, i) => (
            <SynthesisResultCard key={i} result={result} />
          ))}
        </div>
      )}

      {/* Heartbeat Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Heartbeat Results</h4>
          {results.map((result, i) => (
            <HeartbeatResultCard key={i} result={result} />
          ))}
        </div>
      )}

      {results.length === 0 && synthesisResults.length === 0 && !isRunning && !synthesisRunning && (
        <div className="text-center text-muted-foreground py-4 text-sm">
          Run heartbeat to extract entities, or synthesis to process memory decay.
        </div>
      )}
    </div>
  );
}

function SynthesisResultCard({ result }: { result: SynthesisResult }) {
  const time = new Date(result.timestamp).toLocaleTimeString();

  return (
    <div className={`rounded-lg border p-3 ${
      result.success
        ? "bg-purple-500/10 border-purple-500/30"
        : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {result.success ? (
          <CheckCircle className="w-4 h-4 text-purple-400" />
        ) : (
          <AlertCircle className="w-4 h-4 text-red-500" />
        )}
        <span className="text-sm font-medium">
          {result.success ? "Synthesis Complete" : "Failed"}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{time}</span>
      </div>

      {result.success ? (
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-lg font-bold text-purple-400">{result.entitiesProcessed}</div>
            <div className="text-muted-foreground">Processed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-purple-400">{result.factsArchived}</div>
            <div className="text-muted-foreground">Archived</div>
          </div>
          <div>
            <div className="text-lg font-bold text-purple-400">{result.summariesRegenerated}</div>
            <div className="text-muted-foreground">Regenerated</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-red-400">{result.error || "Unknown error"}</p>
      )}
    </div>
  );
}

function HeartbeatResultCard({ result }: { result: HeartbeatResult }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const time = new Date(result.timestamp).toLocaleTimeString();
  const hasEntities = result.entities && result.entities.length > 0;

  return (
    <div className={`rounded-lg border ${
      result.success
        ? "bg-green-500/10 border-green-500/30"
        : "bg-red-500/10 border-red-500/30"
    }`}>
      {/* Header */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          {result.success ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-sm font-medium">
            {result.success ? "Success" : "Failed"}
          </span>
          {result.extractionMethod && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              result.extractionMethod === 'ollama'
                ? 'bg-purple-500/20 text-purple-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}>
              {result.extractionMethod === 'ollama' ? 'LLM' : 'Pattern'}
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{time}</span>
        </div>

        {result.success ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-gold">{result.entitiesCreated}</div>
              <div className="text-xs text-muted-foreground">Created</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gold">{result.entitiesUpdated}</div>
              <div className="text-xs text-muted-foreground">Updated</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gold">
                {result.reindexed ? "✓" : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Indexed</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-400">{result.error || "Unknown error"}</p>
        )}
      </div>

      {/* Entity Details */}
      {hasEntities && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground border-t border-green-500/20 transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {result.entities!.length} {result.entities!.length === 1 ? 'entity' : 'entities'} extracted
          </button>

          {isExpanded && (
            <div className="px-3 pb-3 space-y-2">
              {result.entities!.map((entity, i) => (
                <EntityDetailCard key={i} entity={entity} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EntityDetailCard({ entity }: { entity: EntityDetail }) {
  const TypeIcon = entity.type === 'person' ? User
    : entity.type === 'company' ? Building
    : FolderKanban;

  return (
    <div className="p-2 rounded bg-background/50 border border-border/50">
      <div className="flex items-center gap-2 mb-1">
        <TypeIcon className="w-3 h-3 text-muted-foreground" />
        <span className="text-sm font-medium text-gold">{entity.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          entity.action === 'created'
            ? 'bg-green-500/20 text-green-400'
            : 'bg-blue-500/20 text-blue-400'
        }`}>
          {entity.action}
        </span>
      </div>
      <ul className="text-xs text-muted-foreground space-y-0.5 ml-5">
        {entity.facts.map((fact, i) => (
          <li key={i}>• {fact}</li>
        ))}
      </ul>
    </div>
  );
}

function MemoryCard({ memory }: { memory: Memory }) {
  return (
    <div className="p-3 rounded-lg bg-secondary/50 border border-border">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-gold">{memory.entityName}</span>
        <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-secondary">
          {memory.category}
        </span>
      </div>
      <p className="text-sm text-foreground">{memory.content}</p>
      <div className="mt-2 text-xs text-muted-foreground">
        {new Date(memory.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
