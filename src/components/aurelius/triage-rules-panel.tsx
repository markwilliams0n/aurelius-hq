"use client";

import { useState } from "react";
import {
  X,
  Check,
  XCircle,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Trash2,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { TriageRule } from "@/lib/db/schema";

interface RulesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  rules: TriageRule[];
  onMutateRules: () => void;
}

export function TriageRulesPanel({ isOpen, onClose, rules, onMutateRules }: RulesPanelProps) {
  const [showDismissed, setShowDismissed] = useState(false);

  if (!isOpen) return null;

  const proposedRules = rules.filter((r) => r.status === "proposed");
  const activeRules = rules.filter((r) => r.status === "active");
  const dismissedRules = rules.filter((r) => r.status === "dismissed");

  const handleAccept = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}/accept`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Rule activated");
      onMutateRules();
    } catch {
      toast.error("Failed to accept rule");
    }
  };

  const handleDismiss = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Rule dismissed");
      onMutateRules();
    } catch {
      toast.error("Failed to dismiss rule");
    }
  };

  const handleToggle = async (rule: TriageRule) => {
    const newStatus = rule.status === "active" ? "inactive" : "active";
    try {
      const res = await fetch(`/api/triage/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      onMutateRules();
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Rule deleted");
      onMutateRules();
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const handleUndismiss = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "proposed" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Rule restored to proposals");
      onMutateRules();
    } catch {
      toast.error("Failed to restore rule");
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-background border-l border-border z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Triage Rules</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary/50 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
          {proposedRules.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gold mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Pending Proposals ({proposedRules.length})
              </h3>
              <div className="space-y-2">
                {proposedRules.map((rule) => (
                  <div key={rule.id} className="border border-gold/20 bg-gold/5 rounded-lg p-3">
                    <p className="text-sm font-medium">{rule.guidance || rule.name}</p>
                    {rule.evidence && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on: {formatEvidence(rule.evidence as Record<string, number>)}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleAccept(rule.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Approve
                      </button>
                      <button
                        onClick={() => handleDismiss(rule.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-secondary text-muted-foreground rounded hover:bg-secondary/80 transition-colors"
                      >
                        <XCircle className="w-3 h-3" /> Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-medium text-foreground mb-3">
              Active Rules ({activeRules.length})
            </h3>
            <div className="space-y-1.5">
              {activeRules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border/50 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{rule.guidance || rule.name}</span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full",
                        rule.source === "learned" ? "bg-purple-500/20 text-purple-400" : "bg-secondary text-muted-foreground"
                      )}>
                        {rule.source === "learned" ? "learned" : "you"}
                      </span>
                    </div>
                    {rule.matchCount > 0 && (
                      <span className="text-[10px] text-muted-foreground/60">
                        Matched {rule.matchCount} times
                        {rule.lastMatchedAt && ` · last ${new Date(rule.lastMatchedAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleToggle(rule)} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Disable">
                      <ToggleRight className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {activeRules.length === 0 && (
                <p className="text-xs text-muted-foreground/60 py-2">
                  No active rules yet. Type one in the activity feed or wait for suggestions.
                </p>
              )}
            </div>
          </section>

          {dismissedRules.length > 0 && (
            <section>
              <button onClick={() => setShowDismissed(!showDismissed)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                {showDismissed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Dismissed ({dismissedRules.length})
              </button>
              {showDismissed && (
                <div className="mt-2 space-y-1.5">
                  {dismissedRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/20 text-muted-foreground">
                      <span className="flex-1 text-sm truncate line-through opacity-60">{rule.guidance || rule.name}</span>
                      <button onClick={() => handleUndismiss(rule.id)} className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-secondary transition-colors" title="Restore">
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function formatEvidence(evidence: Record<string, number>): string {
  const parts: string[] = [];
  if (evidence.bulk) parts.push(`bulk-archived ${evidence.bulk}`);
  if (evidence.quick) parts.push(`quick-archived ${evidence.quick}`);
  if (evidence.engaged) parts.push(`engaged ${evidence.engaged}`);
  if (evidence.total) parts.push(`of ${evidence.total} total`);
  if (evidence.overrideCount) parts.push(`${evidence.overrideCount} overrides`);
  return parts.join(", ");
}
