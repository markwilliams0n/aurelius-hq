"use client";

import { cn } from "@/lib/utils";
import type { ActionCardData, CardPattern, CardStatus } from "@/lib/types/action-card";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Code,
  Layers,
  Settings,
  AlertTriangle,
  Info,
  ExternalLink,
} from "lucide-react";

const PATTERN_META: Record<CardPattern, { icon: typeof CheckCircle; label: string }> = {
  approval: { icon: CheckCircle, label: "Approval" },
  batch: { icon: Layers, label: "Batch" },
  code: { icon: Code, label: "Code Session" },
  config: { icon: Settings, label: "Configuration" },
  confirmation: { icon: AlertTriangle, label: "Confirmation" },
  info: { icon: Info, label: "Info" },
  vault: { icon: Info, label: "Vault" },
};

const STATUS_STYLES: Record<CardStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  confirmed: "bg-green-500/15 text-green-400 border-green-500/30",
  dismissed: "bg-muted text-muted-foreground border-border",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<CardStatus, string> = {
  pending: "Pending",
  confirmed: "Done",
  dismissed: "Dismissed",
  error: "Error",
};

/** Default actions per pattern */
const PATTERN_ACTIONS: Record<CardPattern, string[]> = {
  approval: ["send", "cancel"],
  batch: ["confirm", "dismiss"],
  code: ["confirm", "cancel"],
  config: ["save", "dismiss"],
  confirmation: ["confirm", "cancel"],
  info: ["dismiss"],
  vault: ["supermemory", "delete", "dismiss"],
};

function getButtonProps(action: string): {
  variant: "default" | "destructive" | "outline" | "secondary" | "ghost";
  label: string;
} {
  switch (action) {
    case "send":
      return { variant: "default", label: "Send" };
    case "supermemory":
      return { variant: "default", label: "Send to SuperMemory" };
    case "confirm":
      return { variant: "default", label: "Confirm" };
    case "save":
      return { variant: "default", label: "Save" };
    case "cancel":
      return { variant: "ghost", label: "Cancel" };
    case "dismiss":
      return { variant: "ghost", label: "Dismiss" };
    case "delete":
      return { variant: "destructive", label: "Delete" };
    case "edit":
      return { variant: "outline", label: "Edit" };
    default:
      return { variant: "secondary", label: action.charAt(0).toUpperCase() + action.slice(1) };
  }
}

interface ActionCardProps {
  card: ActionCardData;
  onAction: (actionName: string, editedData?: Record<string, unknown>) => void;
  children: React.ReactNode;
}

export function ActionCard({ card, onAction, children }: ActionCardProps) {
  const patternMeta = PATTERN_META[card.pattern] ?? {
    icon: Info,
    label: card.pattern,
  };
  const Icon = patternMeta.icon;
  const isPending = card.status === "pending";
  const actions = PATTERN_ACTIONS[card.pattern] ?? [];
  const resultUrl = (card.result as Record<string, unknown> | undefined)?.resultUrl as string | undefined;
  const error = (card.result as Record<string, unknown> | undefined)?.error as string | undefined;

  return (
    <Card
      className={cn(
        "mt-2 border-border/60 bg-card/80",
        isPending && "border-gold/20"
      )}
    >
      <CardHeader className="pb-0 gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Icon className="size-4 text-gold" />
            <CardTitle className="text-sm font-medium">
              {card.title}
            </CardTitle>
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[card.status]
            )}
          >
            {STATUS_LABELS[card.status]}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-2 pb-0">
        {children}
        {card.status === "error" && error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </CardContent>

      <CardFooter className="pt-3 gap-2 flex-wrap">
        {isPending ? (
          actions.map((action) => {
            const { variant, label } = getButtonProps(action);
            return (
              <Button
                key={action}
                variant={variant}
                size="sm"
                onClick={() => onAction(action)}
              >
                {label}
              </Button>
            );
          })
        ) : (
          <>
            {resultUrl && (
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-gold-bright transition-colors"
              >
                <ExternalLink className="size-3" />
                View
              </a>
            )}
          </>
        )}
      </CardFooter>
    </Card>
  );
}
