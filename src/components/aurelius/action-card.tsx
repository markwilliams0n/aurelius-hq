"use client";

import { cn } from "@/lib/utils";
import type { ActionCardData, ActionCardStatus, ActionCardType } from "@/lib/types/action-card";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  CheckSquare,
  Mail,
  ExternalLink,
} from "lucide-react";

const CARD_TYPE_META: Record<ActionCardType, { icon: typeof MessageSquare; label: string }> = {
  slack_message: { icon: MessageSquare, label: "Slack Message" },
  task: { icon: CheckSquare, label: "Task" },
  email_draft: { icon: Mail, label: "Email Draft" },
};

const STATUS_STYLES: Record<ActionCardStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  confirmed: "bg-green-500/15 text-green-400 border-green-500/30",
  sent: "bg-green-500/15 text-green-400 border-green-500/30",
  canceled: "bg-muted text-muted-foreground border-border",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<ActionCardStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  sent: "Sent",
  canceled: "Canceled",
  error: "Error",
};

function getButtonProps(action: string): {
  variant: "default" | "destructive" | "outline" | "secondary" | "ghost";
  label: string;
} {
  switch (action) {
    case "send":
      return { variant: "default", label: "Send" };
    case "confirm":
      return { variant: "default", label: "Confirm" };
    case "cancel":
      return { variant: "ghost", label: "Cancel" };
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
  const typeMeta = CARD_TYPE_META[card.cardType] ?? {
    icon: MessageSquare,
    label: card.cardType,
  };
  const Icon = typeMeta.icon;
  const isPending = card.status === "pending";

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
              {typeMeta.label}
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
        {card.status === "error" && card.error && (
          <p className="mt-2 text-xs text-red-400">{card.error}</p>
        )}
      </CardContent>

      <CardFooter className="pt-3 gap-2 flex-wrap">
        {isPending ? (
          card.actions.map((action) => {
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
            {card.resultUrl && (
              <a
                href={card.resultUrl}
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
