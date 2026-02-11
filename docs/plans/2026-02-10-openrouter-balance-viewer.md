# OpenRouter Balance/Usage Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a page to Aurelius HQ that displays the user's OpenRouter credit balance, usage stats (daily/weekly/monthly), and key metadata — fetched from the OpenRouter `/api/v1/key` endpoint.

**Architecture:** A single new API route (`/api/openrouter/balance`) proxies the OpenRouter API, keeping the API key server-side. A new `/credits` page renders the data using the existing `AppShell` layout and shadcn/ui `Card` components. Navigation is added via the sidebar.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS 4, Lucide React icons, Sonner toasts.

---

### Task 1: Create the backend API route

**Files:**
- Create: `src/app/api/openrouter/balance/route.ts`

**Step 1: Create the API route file**

```typescript
// src/app/api/openrouter/balance/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OpenRouter Balance] API error:", response.status, errorText);
      return NextResponse.json(
        { error: `OpenRouter API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[OpenRouter Balance] Fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch balance data" },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify the route compiles**

Run: `cd /Users/markwilliamson/Claude\ Code/aurelius-worktrees/29aBesx9TDhX && npx tsc --noEmit`
Expected: No errors related to the new route.

**Step 3: Commit**

```bash
git add src/app/api/openrouter/balance/route.ts
git commit -m "feat: add OpenRouter balance API endpoint"
```

---

### Task 2: Create the credits page (client component)

**Files:**
- Create: `src/app/credits/page.tsx`

The OpenRouter `/api/v1/key` endpoint returns:
```json
{
  "data": {
    "label": "string",
    "limit": null | number,
    "usage": number,
    "usage_daily": number,
    "usage_weekly": number,
    "usage_monthly": number,
    "limit_remaining": null | number,
    "is_free_tier": boolean,
    "rate_limit": object,
    "expires_at": "ISO 8601 timestamp" | null
  }
}
```

All monetary values are in USD.

**Step 1: Create the page component**

```typescript
// src/app/credits/page.tsx
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
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/credits/page.tsx
git commit -m "feat: add credits page with balance and usage display"
```

---

### Task 3: Add navigation to the sidebar

**Files:**
- Modify: `src/components/aurelius/app-sidebar.tsx`

**Step 1: Add the nav item**

In `src/components/aurelius/app-sidebar.tsx`:

1. Add `CreditCard` to the lucide-react import (line 8-21):
```typescript
import {
  MessageSquare,
  Brain,
  Activity,
  Inbox,
  CheckSquare,
  Archive,
  Settings,
  Bell,
  Code,
  Sun,
  Moon,
  Monitor,
  CreditCard,
} from "lucide-react";
```

2. Add the credits nav item to the `navItems` array (after the "System" entry, before "Cortex"):
```typescript
const navItems = [
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/triage", icon: Inbox, label: "Triage" },
  { href: "/actions", icon: Bell, label: "Actions" },
  { href: "/code", icon: Code, label: "Code" },
  { href: "/tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/vault", icon: Archive, label: "Vault" },
  { href: "/memory", icon: Brain, label: "Memory" },
  { href: "/system", icon: Activity, label: "System" },
  { href: "/credits", icon: CreditCard, label: "Credits" },
  { href: "/config", icon: Settings, label: "Cortex" },
];
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/aurelius/app-sidebar.tsx
git commit -m "feat: add credits link to sidebar navigation"
```

---

### Task 4: Manual verification

**Step 1: Start the dev server (if not running)**

Run: `bun run dev`

**Step 2: Verify the API route**

Run: `curl http://localhost:3333/api/openrouter/balance`
Expected: JSON response with `data.usage`, `data.limit_remaining`, etc.

**Step 3: Verify the page renders**

Open `http://localhost:3333/credits` in a browser. Verify:
- Header says "Credits" with "OpenRouter balance & usage" subtitle
- Balance cards show: Total Usage, Remaining
- Period cards show: Today, This Week, This Month
- Key Details section shows label, tier, limit, etc.
- Refresh button reloads data
- If API key is missing, error message displays with helpful hint

**Step 4: Verify sidebar nav**

Check that the "Credits" icon appears in the sidebar between "System" and "Cortex". Click it — navigates to `/credits`. Active state highlights correctly.

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```

---

### Design Decisions

1. **`/api/v1/key` over `/api/v1/credits`** — The `/key` endpoint works with standard API keys and returns richer data (daily/weekly/monthly breakdowns). The `/credits` endpoint requires a management key which the user likely doesn't have.

2. **No model-by-model breakdown** — The OpenRouter API doesn't provide per-model usage breakdowns via a standard API key endpoint. This would require collecting and storing generation data locally over time, which is out of scope for v1.

3. **`/credits` route, not `/openrouter`** — Shorter, more intuitive name. Matches the sidebar label.

4. **Server-side API key only** — The API key stays on the server via the Next.js API route. No client-side exposure. User doesn't need to enter a key if `OPENROUTER_API_KEY` is in `.env`.

5. **No database schema changes** — This is a read-only viewer that proxies the OpenRouter API. No persistent storage needed.

### Risks

- **OpenRouter API changes** — The `/api/v1/key` response shape could change. The TypeScript type provides a compile-time contract, but the runtime response is unchecked. If fields are missing, the UI will show `$0.0000` or "No limit" rather than crashing.
- **Rate limiting** — The OpenRouter API may rate-limit balance checks. The refresh button is manual, so this is unlikely to be an issue. No auto-polling added.
- **Free tier keys** — Free tier keys may return zeroes for usage fields. The UI handles this gracefully.
