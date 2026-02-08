"use client";

import { useState } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import { Key, FileText, Hash, Link, Lock, Loader2, Eye } from "lucide-react";

export const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  credential: Key,
  fact: Hash,
  reference: Link,
};

interface VaultCardContentProps {
  card: ActionCardData;
}

/**
 * Renders vault-specific action cards in main chat.
 *
 * Two variants:
 * 1. Save confirmation — shows what was saved (title, type, tags, sensitive flag)
 * 2. Sensitive reveal — shows metadata + "Reveal" button that fetches the actual value
 */
export function VaultCardContent({ card }: VaultCardContentProps) {
  const data = card.data as {
    vault_item_id?: string;
    title?: string;
    type?: string;
    tags?: string[];
    sensitive?: boolean;
    reveal_available?: boolean;
    supermemoryStatus?: string;
    results?: Array<Record<string, unknown>>;
    first_sensitive_id?: string;
  };

  // Multi-result search card
  if (data.results && Array.isArray(data.results)) {
    return <VaultSearchResults results={data.results} firstSensitiveId={data.first_sensitive_id} />;
  }

  // Single item card (save confirmation or reveal)
  return <VaultSingleItem data={data} />;
}

function VaultSingleItem({
  data,
}: {
  data: {
    vault_item_id?: string;
    title?: string;
    type?: string;
    tags?: string[];
    sensitive?: boolean;
    reveal_available?: boolean;
    supermemoryStatus?: string;
  };
}) {
  const [revealedContent, setRevealedContent] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState(false);

  const TypeIcon = TYPE_ICONS[data.type || "fact"] || FileText;

  const handleReveal = async () => {
    if (!data.vault_item_id) return;
    setIsRevealing(true);
    setRevealError(false);
    try {
      const res = await fetch(`/api/vault/items/${data.vault_item_id}/reveal`);
      if (!res.ok) throw new Error("Reveal failed");
      const result = await res.json();
      setRevealedContent(result.content);
    } catch {
      setRevealError(true);
    } finally {
      setIsRevealing(false);
    }
  };

  return (
    <div className="space-y-2 text-sm">
      {/* Item metadata row */}
      <div className="flex items-center gap-2">
        <TypeIcon className="w-4 h-4 text-muted-foreground" />
        {data.sensitive && <Lock className="w-3.5 h-3.5 text-amber-400" />}
        <span className="font-medium text-foreground">{data.title}</span>
        <span className="text-xs text-muted-foreground capitalize">({data.type})</span>
      </div>

      {/* Tags */}
      {data.tags && data.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {data.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold/80"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Reveal section for sensitive items */}
      {data.reveal_available && data.sensitive && (
        <div className="mt-2">
          {revealedContent !== null ? (
            <div className="bg-muted/50 rounded p-3 border border-amber-400/20">
              <pre className="whitespace-pre-wrap text-foreground text-sm">{revealedContent}</pre>
            </div>
          ) : revealError ? (
            <p className="text-xs text-destructive">Failed to reveal content.</p>
          ) : (
            <button
              onClick={handleReveal}
              disabled={isRevealing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-400/30 text-amber-400 text-xs font-medium hover:bg-amber-400/10 transition-colors disabled:opacity-50"
            >
              {isRevealing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {isRevealing ? "Revealing..." : "Reveal Value"}
            </button>
          )}
        </div>
      )}

      {/* SM status (save confirmation cards) */}
      {data.supermemoryStatus && data.supermemoryStatus !== "sent" && (
        <p className="text-xs text-muted-foreground">
          Not yet in SuperMemory — visit the Vault page to send.
        </p>
      )}
    </div>
  );
}

function VaultSearchResults({
  results,
  firstSensitiveId,
}: {
  results: Array<Record<string, unknown>>;
  firstSensitiveId?: string;
}) {
  const [revealedContent, setRevealedContent] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  const handleReveal = async (itemId: string) => {
    setIsRevealing(true);
    try {
      const res = await fetch(`/api/vault/items/${itemId}/reveal`);
      if (!res.ok) throw new Error("Reveal failed");
      const data = await res.json();
      setRevealedContent(data.content);
    } catch {
      setRevealedContent(null);
    } finally {
      setIsRevealing(false);
    }
  };

  return (
    <div className="space-y-2 text-sm">
      {results.map((item) => {
        const TypeIcon = TYPE_ICONS[(item.type as string) || "fact"] || FileText;
        const isSensitive = item.sensitive as boolean;
        const itemId = item.vault_item_id as string;

        return (
          <div key={itemId} className="flex items-center gap-2 py-1">
            <TypeIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {isSensitive && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
            <span className="text-foreground">{item.title as string}</span>
            {(item.tags as string[])?.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[10px] px-1 py-0.5 rounded bg-gold/10 text-gold/80">
                {tag}
              </span>
            ))}
          </div>
        );
      })}

      {/* Reveal button for first sensitive result */}
      {firstSensitiveId && (
        <div className="mt-2">
          {revealedContent !== null ? (
            <div className="bg-muted/50 rounded p-3 border border-amber-400/20">
              <pre className="whitespace-pre-wrap text-foreground text-sm">{revealedContent}</pre>
            </div>
          ) : (
            <button
              onClick={() => handleReveal(firstSensitiveId)}
              disabled={isRevealing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-400/30 text-amber-400 text-xs font-medium hover:bg-amber-400/10 transition-colors disabled:opacity-50"
            >
              {isRevealing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {isRevealing ? "Revealing..." : "Reveal Sensitive Value"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
