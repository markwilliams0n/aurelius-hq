"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Loader2,
  DollarSign,
  TrendingUp,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

type KeyData = {
  label: string;
  limit: number | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  limit_remaining: number | null;
  is_free_tier: boolean;
  rate_limit: Record<string, unknown>;
  expires_at: string | null;
};

function formatUSD(value: number): string {
  return `$${value.toFixed(4)}`;
}

export default function CreditsPage() {
  const [data, setData] = useState<KeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/openrouter/balance");
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      const result = await response.json();
      setData(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">Credits</h1>
          <p className="text-sm text-muted-foreground">
            OpenRouter balance &amp; usage
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Refresh button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchBalance}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Error state */}
          {error && !loading && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">{error}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Check that OPENROUTER_API_KEY is set in your .env file.
                </p>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-lg border border-border bg-card animate-pulse"
                />
              ))}
            </div>
          )}

          {/* Data cards */}
          {data && (
            <>
              {/* Balance overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Total usage (all time) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Total Usage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">
                      {formatUSD(data.usage)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      All-time spend
                    </p>
                  </CardContent>
                </Card>

                {/* Remaining balance */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Remaining
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">
                      {data.limit_remaining != null
                        ? formatUSD(data.limit_remaining)
                        : "No limit"}
                    </div>
                    {data.limit != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        of {formatUSD(data.limit)} limit
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Usage breakdown by period */}
              <div>
                <h2 className="font-serif text-lg text-gold mb-4">
                  Usage by Period
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Today
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-semibold">
                        {formatUSD(data.usage_daily)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        This Week
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-semibold">
                        {formatUSD(data.usage_weekly)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        This Month
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-semibold">
                        {formatUSD(data.usage_monthly)}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Key metadata */}
              <div>
                <h2 className="font-serif text-lg text-gold mb-4">
                  Key Details
                </h2>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-3 text-sm">
                      {data.label && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Label</span>
                          <span>{data.label}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tier</span>
                        <span>
                          {data.is_free_tier ? "Free" : "Paid"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Spending Limit
                        </span>
                        <span>
                          {data.limit != null
                            ? formatUSD(data.limit)
                            : "Unlimited"}
                        </span>
                      </div>
                      {data.expires_at && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Expires
                          </span>
                          <span>
                            {new Date(data.expires_at).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {data.rate_limit &&
                        Object.keys(data.rate_limit).length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Rate Limit
                            </span>
                            <span className="text-right">
                              {JSON.stringify(data.rate_limit)}
                            </span>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
