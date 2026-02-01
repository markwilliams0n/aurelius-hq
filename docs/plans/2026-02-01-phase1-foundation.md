# Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the Next.js project with authentication, database, theming, and initial config seeding.

**Architecture:** Next.js 14 App Router with Drizzle ORM connecting to Railway Postgres (pgvector enabled). Magic link auth for single user. Configs stored as versioned markdown in database.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM, PostgreSQL + pgvector, Resend (email)

---

## Task 1: Initialize Next.js Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

**Step 1: Create Next.js app with TypeScript**

Run:
```bash
cd /Users/markwilliamson/Claude\ Code/aurelius-hq
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

When prompted, accept defaults. This creates the base Next.js structure.

**Step 2: Verify the app runs**

Run:
```bash
pnpm dev
```

Expected: Server starts at http://localhost:3000, default Next.js page renders.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: initialize Next.js 14 with TypeScript and Tailwind"
```

---

## Task 2: Install Core Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install shadcn/ui and dependencies**

Run:
```bash
pnpm add drizzle-orm postgres @neondatabase/serverless
pnpm add -D drizzle-kit
pnpm add resend
pnpm add @anthropic-ai/sdk
pnpm add nanoid
pnpm add zod
```

**Step 2: Initialize shadcn/ui**

Run:
```bash
pnpm dlx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Slate (we'll customize)
- CSS variables: Yes

**Step 3: Add shadcn components we'll need**

Run:
```bash
pnpm dlx shadcn@latest add button card input label toast sonner
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: add drizzle, shadcn/ui, resend, anthropic SDK"
```

---

## Task 3: Configure Aurelius Theme

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`
- Create: `src/lib/fonts.ts`
- Modify: `src/app/layout.tsx`

**Step 1: Update globals.css with Aurelius color scheme**

Replace contents of `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 240 20% 4%;
    --foreground: 30 10% 90%;
    --card: 240 15% 8%;
    --card-foreground: 30 10% 90%;
    --popover: 240 15% 8%;
    --popover-foreground: 30 10% 90%;
    --primary: 42 65% 58%;
    --primary-foreground: 240 20% 4%;
    --secondary: 240 10% 15%;
    --secondary-foreground: 30 10% 90%;
    --muted: 240 10% 20%;
    --muted-foreground: 0 0% 60%;
    --accent: 42 65% 58%;
    --accent-foreground: 240 20% 4%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 30 10% 90%;
    --border: 240 10% 18%;
    --input: 240 10% 18%;
    --ring: 42 65% 58%;
    --radius: 0.5rem;

    /* Custom Aurelius tokens */
    --gold: 42 65% 58%;
    --gold-muted: 30 25% 44%;
    --gold-bright: 45 88% 67%;
    --status-urgent: 0 72% 60%;
    --status-high: 30 80% 57%;
    --status-normal: 195 40% 47%;
    --status-low: 240 5% 40%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

**Step 2: Update tailwind.config.ts with custom colors**

Replace contents of `tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        gold: {
          DEFAULT: "hsl(var(--gold))",
          muted: "hsl(var(--gold-muted))",
          bright: "hsl(var(--gold-bright))",
        },
        status: {
          urgent: "hsl(var(--status-urgent))",
          high: "hsl(var(--status-high))",
          normal: "hsl(var(--status-normal))",
          low: "hsl(var(--status-low))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        serif: ["var(--font-playfair)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

**Step 3: Create fonts configuration**

Create `src/lib/fonts.ts`:

```typescript
import { Inter, Playfair_Display, JetBrains_Mono } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

export const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});
```

**Step 4: Update layout.tsx with fonts and dark mode**

Replace contents of `src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { inter, playfair, jetbrains } from "@/lib/fonts";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurelius",
  description: "Personal AI Command Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} dark`}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

**Step 5: Verify theme renders**

Run:
```bash
pnpm dev
```

Expected: Dark background (#0D0D14 range), page should be very dark with no white flash.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: configure Aurelius dark/gold theme with custom fonts"
```

---

## Task 4: Set Up Drizzle Schema (Auth Tables)

**Files:**
- Create: `src/lib/db/schema/auth.ts`
- Create: `src/lib/db/schema/index.ts`
- Create: `src/lib/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `.env.local` (template)

**Step 1: Create environment template**

Create `.env.example`:

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/aurelius

# Auth
ADMIN_EMAIL=your@email.com
MAGIC_LINK_SECRET=generate-a-32-char-secret

# Email (Resend)
RESEND_API_KEY=re_xxxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 2: Create Drizzle config**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 3: Create auth schema**

Create `src/lib/db/schema/auth.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Step 4: Create schema index**

Create `src/lib/db/schema/index.ts`:

```typescript
export * from "./auth";
```

**Step 5: Create database client**

Create `src/lib/db/index.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });

export type DB = typeof db;
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Drizzle schema for auth (users, sessions, magic_links)"
```

---

## Task 5: Add Config and Activity Log Schema

**Files:**
- Create: `src/lib/db/schema/config.ts`
- Create: `src/lib/db/schema/activity.ts`
- Modify: `src/lib/db/schema/index.ts`

**Step 1: Create config schema**

Create `src/lib/db/schema/config.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

export const configKeyEnum = pgEnum("config_key", ["soul", "agents", "processes"]);
export const actorEnum = pgEnum("actor", ["system", "user", "aurelius"]);

export const configs = pgTable("configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: configKeyEnum("key").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  createdBy: actorEnum("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Step 2: Create activity log schema**

Create `src/lib/db/schema/activity.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { actorEnum } from "./config";

export const eventTypeEnum = pgEnum("event_type", [
  "auth_login",
  "auth_logout",
  "config_created",
  "config_updated",
  "memory_created",
  "memory_updated",
  "memory_deleted",
  "triage_action",
  "task_created",
  "task_updated",
  "connector_sync",
  "system_error",
]);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: eventTypeEnum("event_type").notNull(),
  actor: actorEnum("actor").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Step 3: Update schema index**

Replace contents of `src/lib/db/schema/index.ts`:

```typescript
export * from "./auth";
export * from "./config";
export * from "./activity";
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add config and activity_log schema"
```

---

## Task 6: Create Database and Run Migrations

**Files:**
- Create: `drizzle/0000_*.sql` (generated)
- Create: `.env.local`

**Step 1: Set up Railway Postgres**

Go to Railway dashboard and create a new Postgres database. Copy the connection string.

Create `.env.local`:

```bash
DATABASE_URL=your-railway-connection-string
ADMIN_EMAIL=your@email.com
MAGIC_LINK_SECRET=generate-with-openssl-rand-hex-32
RESEND_API_KEY=re_xxxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 2: Enable pgvector extension**

Connect to your Railway Postgres and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

(Railway UI has a query tab, or use psql)

**Step 3: Generate migration**

Run:
```bash
pnpm drizzle-kit generate
```

Expected: Creates `drizzle/0000_*.sql` with CREATE TABLE statements.

**Step 4: Push schema to database**

Run:
```bash
pnpm drizzle-kit push
```

Expected: Tables created in Railway Postgres.

**Step 5: Verify tables exist**

Run:
```bash
pnpm drizzle-kit studio
```

Expected: Opens Drizzle Studio at https://local.drizzle.studio, shows empty tables.

**Step 6: Commit**

```bash
git add drizzle/
git commit -m "chore: add initial database migration"
```

---

## Task 7: Create Activity Logger Utility

**Files:**
- Create: `src/lib/activity.ts`

**Step 1: Create activity logger**

Create `src/lib/activity.ts`:

```typescript
import { db } from "@/lib/db";
import { activityLog, eventTypeEnum, actorEnum } from "@/lib/db/schema";

type EventType = (typeof eventTypeEnum.enumValues)[number];
type Actor = (typeof actorEnum.enumValues)[number];

interface LogActivityParams {
  eventType: EventType;
  actor: Actor;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity({
  eventType,
  actor,
  description,
  metadata,
}: LogActivityParams) {
  const [entry] = await db
    .insert(activityLog)
    .values({
      eventType,
      actor,
      description,
      metadata,
    })
    .returning();

  return entry;
}

export async function getRecentActivity(limit = 50) {
  return db.query.activityLog.findMany({
    orderBy: (log, { desc }) => [desc(log.createdAt)],
    limit,
  });
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add activity logger utility"
```

---

## Task 8: Implement Magic Link Auth - Send Link

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/send-magic-link/route.ts`
- Create: `src/app/(auth)/login/page.tsx`

**Step 1: Create auth utilities**

Create `src/lib/auth.ts`:

```typescript
import { db } from "@/lib/db";
import { users, sessions, magicLinks } from "@/lib/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";

const SESSION_COOKIE = "aurelius_session";
const SESSION_DURATION_DAYS = 30;
const MAGIC_LINK_EXPIRY_MINUTES = 15;

export async function createMagicLink(email: string) {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(magicLinks).values({
    email,
    token,
    expiresAt,
  });

  return token;
}

export async function verifyMagicLink(token: string) {
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.token, token),
        gt(magicLinks.expiresAt, new Date()),
        isNull(magicLinks.usedAt)
      )
    );

  if (!link) return null;

  // Mark as used
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  return link;
}

export async function createSession(email: string) {
  // Get or create user
  let [user] = await db.select().from(users).where(eq(users.email, email));

  if (!user) {
    [user] = await db.insert(users).values({ email }).returning();
  }

  // Create session
  const token = nanoid(32);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(sessions).values({
    userId: user.id,
    token,
    expiresAt,
  });

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return user;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const [session] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));

  return session ?? null;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
    cookieStore.delete(SESSION_COOKIE);
  }
}

export function isAdminEmail(email: string) {
  return email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase();
}
```

**Step 2: Create send magic link API route**

Create `src/app/api/auth/send-magic-link/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createMagicLink, isAdminEmail } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Only allow admin email
    if (!isAdminEmail(email)) {
      // Don't reveal that email isn't authorized
      return NextResponse.json({ success: true });
    }

    const token = await createMagicLink(email);
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/verify?token=${token}`;

    await resend.emails.send({
      from: "Aurelius <noreply@yourdomain.com>",
      to: email,
      subject: "Your Aurelius login link",
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="color: #D4A853; font-size: 24px; margin-bottom: 24px;">Aurelius</h1>
          <p style="color: #666; margin-bottom: 24px;">Click the link below to sign in. This link expires in 15 minutes.</p>
          <a href="${magicLinkUrl}" style="display: inline-block; background: #D4A853; color: #0D0D14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Sign in to Aurelius</a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">If you didn't request this link, you can safely ignore this email.</p>
        </div>
      `,
    });

    await logActivity({
      eventType: "auth_login",
      actor: "system",
      description: `Magic link sent to ${email}`,
      metadata: { email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send magic link:", error);
    return NextResponse.json(
      { error: "Failed to send login link" },
      { status: 500 }
    );
  }
}
```

**Step 3: Create login page**

Create `src/app/(auth)/login/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="font-serif text-2xl text-gold">Check your email</CardTitle>
            <CardDescription>
              We sent a login link to {email}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground text-sm">
            <p>The link expires in 15 minutes.</p>
            <Button
              variant="ghost"
              className="mt-4"
              onClick={() => setSent(false)}
            >
              Use a different email
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-3xl text-gold">Aurelius</CardTitle>
          <CardDescription>
            Personal AI Command Center
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send login link"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add magic link auth - send link flow"
```

---

## Task 9: Implement Magic Link Auth - Verify and Session

**Files:**
- Create: `src/app/api/auth/verify/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/middleware.ts`

**Step 1: Create verify API route**

Create `src/app/api/auth/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, createSession, isAdminEmail } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const link = await verifyMagicLink(token);

  if (!link) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  if (!isAdminEmail(link.email)) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  const user = await createSession(link.email);

  await logActivity({
    eventType: "auth_login",
    actor: "user",
    description: `User logged in: ${user.email}`,
    metadata: { userId: user.id, email: user.email },
  });

  return NextResponse.redirect(new URL("/", request.url));
}
```

**Step 2: Create logout API route**

Create `src/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST() {
  const session = await getSession();

  if (session) {
    await logActivity({
      eventType: "auth_logout",
      actor: "user",
      description: `User logged out: ${session.user.email}`,
      metadata: { userId: session.user.id },
    });
  }

  await destroySession();

  return NextResponse.json({ success: true });
}
```

**Step 3: Create middleware for auth protection**

Create `src/middleware.ts`:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/login", "/api/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get("aurelius_session");

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add magic link verification and session middleware"
```

---

## Task 10: Seed Initial Configs

**Files:**
- Create: `seed/soul.md`
- Create: `seed/agents.md`
- Create: `seed/processes.md`
- Create: `src/lib/db/seed.ts`
- Modify: `package.json` (add seed script)

**Step 1: Create soul.md seed**

Create `seed/soul.md`:

```markdown
# Soul

You are Aurelius, a personal AI command center. You help your user manage communications, tasks, and knowledge with calm deliberation.

## Personality

- **Stoic**: Measured, thoughtful, never reactive
- **Direct**: Concise and clear, no unnecessary words
- **Observant**: Notice patterns, remember context, connect dots
- **Helpful**: Proactive but not presumptuous

## Communication Style

- Prefer brevity over verbosity
- Lead with the answer, then explain if needed
- Use "I" when taking actions, "you" when advising
- Acknowledge uncertainty when it exists

## Values

- Accuracy over speed
- Privacy is paramount
- Transparency in actions taken
- Learn from corrections gracefully
```

**Step 2: Create agents.md seed**

Create `seed/agents.md`:

```markdown
# Agents

## Model Routing

| Task | Model | Notes |
|------|-------|-------|
| draft_reply | claude-sonnet-4 | Needs nuance and style |
| classify | claude-haiku | Fast, high volume |
| extract_facts | claude-sonnet-4 | Reasoning about relevance |
| summarize | claude-haiku | Straightforward compression |
| chat | claude-sonnet-4 | Default for conversation |
| chat_complex | claude-opus-4 | Deep analysis on request |

## Autonomy Levels

### Automatic (visible + undoable)

- Create/modify entities
- Supersede facts
- Create/modify triage rules
- Generate embeddings
- Sync connector state
- Write to activity log

### Requires Approval

- Update configs (soul, agents, processes)
- Change model routing
- Modify autonomy levels

## Capabilities

- Read and search memory
- Draft replies to messages
- Classify and prioritize items
- Extract facts from content
- Propose config changes
- Answer questions about your data
```

**Step 3: Create processes.md seed**

Create `seed/processes.md`:

```markdown
# Processes

## Connector Sync

Polls connected services for new items.

```yaml
schedule: "*/1 * * * *"  # every minute
enabled: true
```

## Heartbeat

Extracts facts from recent triage activity.

```yaml
schedule: "0 * * * *"  # hourly
enabled: true
```

## Summary Regeneration

Refreshes entity summaries with latest facts.

```yaml
schedule: "0 3 * * *"  # daily at 3am
enabled: true
```
```

**Step 4: Create seed script**

Create `src/lib/db/seed.ts`:

```typescript
import { db } from "./index";
import { configs, users } from "./schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function seed() {
  console.log("Seeding database...");

  // Seed configs
  const configFiles = ["soul", "agents", "processes"] as const;

  for (const key of configFiles) {
    const filePath = path.join(process.cwd(), "seed", `${key}.md`);
    const content = fs.readFileSync(filePath, "utf-8");

    // Check if config exists
    const existing = await db
      .select()
      .from(configs)
      .where(eq(configs.key, key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(configs).values({
        key,
        content,
        version: 1,
        createdBy: "system",
      });
      console.log(`Created config: ${key}`);
    } else {
      console.log(`Config already exists: ${key}`);
    }
  }

  // Seed admin user if ADMIN_EMAIL is set
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({ email: adminEmail });
      console.log(`Created admin user: ${adminEmail}`);
    } else {
      console.log(`Admin user already exists: ${adminEmail}`);
    }
  }

  console.log("Seeding complete!");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
```

**Step 5: Add seed script to package.json**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "db:seed": "npx tsx src/lib/db/seed.ts"
  }
}
```

**Step 6: Run seed**

Run:
```bash
pnpm db:seed
```

Expected: "Created config: soul", "Created config: agents", "Created config: processes"

**Step 7: Verify in Drizzle Studio**

Run:
```bash
pnpm drizzle-kit studio
```

Expected: `configs` table has 3 rows with soul, agents, processes content.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add config seeds (soul, agents, processes) and seed script"
```

---

## Task 11: Create Landing Page with Auth Status

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/aurelius/header.tsx`

**Step 1: Create header component**

Create `src/components/aurelius/header.tsx`:

```typescript
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export async function Header() {
  const session = await getSession();

  return (
    <header className="border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-serif text-xl text-gold">
          Aurelius
        </Link>

        {session ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <form action="/api/auth/logout" method="POST">
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
```

**Step 2: Update landing page**

Replace contents of `src/app/page.tsx`:

```typescript
import { Header } from "@/components/aurelius/header";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default async function Home() {
  const session = await getSession();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        {session ? (
          <div className="max-w-4xl mx-auto">
            <h1 className="font-serif text-4xl text-gold mb-2">
              Welcome back
            </h1>
            <p className="text-muted-foreground mb-8">
              Your personal AI command center is ready.
            </p>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <NavCard
                href="/triage"
                title="Triage"
                description="Process incoming items"
                disabled
              />
              <NavCard
                href="/actions"
                title="Actions"
                description="Your task list"
                disabled
              />
              <NavCard
                href="/memory"
                title="Memory"
                description="Browse knowledge graph"
                disabled
              />
              <NavCard
                href="/chat"
                title="Chat"
                description="Talk to Aurelius"
                disabled
              />
              <NavCard
                href="/activity"
                title="Activity"
                description="System log"
                disabled
              />
              <NavCard
                href="/settings"
                title="Settings"
                description="Configure Aurelius"
                disabled
              />
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto text-center py-20">
            <h1 className="font-serif text-4xl text-gold mb-4">
              Aurelius
            </h1>
            <p className="text-muted-foreground mb-8">
              Personal AI Command Center
            </p>
            <Link
              href="/login"
              className="inline-block bg-gold text-background px-6 py-3 rounded-md font-medium hover:bg-gold-bright transition-colors"
            >
              Sign in to get started
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
  disabled,
}: {
  href: string;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Card className="opacity-50 cursor-not-allowed">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <span className="text-xs text-muted-foreground">Coming soon</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Link href={href}>
      <Card className="hover:border-gold/50 transition-colors cursor-pointer">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
```

**Step 3: Verify the app**

Run:
```bash
pnpm dev
```

Expected:
- Visit http://localhost:3000 without session → shows sign in prompt
- After logging in → shows navigation cards (disabled for now)
- Header shows email and sign out button

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add landing page with auth status and navigation cards"
```

---

## Task 12: Create Config API Endpoints

**Files:**
- Create: `src/app/api/config/[key]/route.ts`
- Create: `src/lib/config.ts`

**Step 1: Create config utility**

Create `src/lib/config.ts`:

```typescript
import { db } from "@/lib/db";
import { configs, configKeyEnum } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

type ConfigKey = (typeof configKeyEnum.enumValues)[number];

export async function getConfig(key: ConfigKey) {
  const [config] = await db
    .select()
    .from(configs)
    .where(eq(configs.key, key))
    .orderBy(desc(configs.version))
    .limit(1);

  return config ?? null;
}

export async function getConfigHistory(key: ConfigKey, limit = 10) {
  return db
    .select()
    .from(configs)
    .where(eq(configs.key, key))
    .orderBy(desc(configs.version))
    .limit(limit);
}

export async function updateConfig(
  key: ConfigKey,
  content: string,
  createdBy: "user" | "aurelius"
) {
  const current = await getConfig(key);
  const nextVersion = (current?.version ?? 0) + 1;

  const [newConfig] = await db
    .insert(configs)
    .values({
      key,
      content,
      version: nextVersion,
      createdBy,
    })
    .returning();

  return newConfig;
}
```

**Step 2: Create config API route**

Create `src/app/api/config/[key]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getConfig, updateConfig, getConfigHistory } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { configKeyEnum } from "@/lib/db/schema";

type ConfigKey = (typeof configKeyEnum.enumValues)[number];

function isValidKey(key: string): key is ConfigKey {
  return configKeyEnum.enumValues.includes(key as ConfigKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid config key" }, { status: 400 });
  }

  const history = request.nextUrl.searchParams.get("history") === "true";

  if (history) {
    const configs = await getConfigHistory(key);
    return NextResponse.json({ configs });
  }

  const config = await getConfig(key);

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  return NextResponse.json({ config });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid config key" }, { status: 400 });
  }

  const { content } = await request.json();

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  const config = await updateConfig(key, content, "user");

  await logActivity({
    eventType: "config_updated",
    actor: "user",
    description: `Updated config: ${key} (v${config.version})`,
    metadata: { key, version: config.version },
  });

  return NextResponse.json({ config });
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add config API endpoints with version history"
```

---

## Task 13: Final Verification and Push

**Step 1: Run the app and test full flow**

Run:
```bash
pnpm dev
```

Test:
1. Visit http://localhost:3000 → Should redirect to /login
2. Enter admin email → Should send magic link (check Resend dashboard or email)
3. Click magic link → Should redirect to home with navigation cards
4. Sign out → Should return to signed out state

**Step 2: Verify database state**

Run:
```bash
pnpm drizzle-kit studio
```

Check:
- `users` table has admin user
- `configs` table has soul, agents, processes
- `activity_log` has login events

**Step 3: Test config API**

```bash
curl http://localhost:3000/api/config/soul -H "Cookie: aurelius_session=YOUR_TOKEN"
```

Expected: Returns soul config JSON

**Step 4: Final commit and push**

```bash
git add -A
git status
```

If any uncommitted changes:

```bash
git commit -m "chore: final Phase 1 cleanup"
```

Push to remote:

```bash
git push origin main
```

---

## Phase 1 Complete

You now have:

- ✅ Next.js 14 with TypeScript and App Router
- ✅ Tailwind CSS with shadcn/ui and Aurelius dark/gold theme
- ✅ Drizzle ORM with Railway Postgres
- ✅ Magic link authentication (single user)
- ✅ Session management with middleware protection
- ✅ Config table with versioning (soul, agents, processes seeded)
- ✅ Activity log infrastructure
- ✅ Landing page with navigation

**Next:** Phase 2 - Memory + Chat
