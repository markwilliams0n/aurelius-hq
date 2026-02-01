# Aurelius

Personal AI Command Center

A unified interface for managing communications, tasks, and knowledge with an AI agent that learns and evolves over time.

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Set up database
pnpm drizzle-kit push
pnpm db:seed

# Run development server
pnpm dev
# → http://localhost:3333
```

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** PostgreSQL + Drizzle ORM
- **Auth:** Magic link (single user)
- **AI:** Claude Max (coming Phase 2)

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/          # Magic link auth
│   │   └── config/        # Config CRUD
│   ├── (auth)/            # Auth pages (login)
│   └── (app)/             # Protected pages
├── components/
│   ├── ui/                # shadcn/ui components
│   └── aurelius/          # App-specific components
└── lib/
    ├── db/                # Drizzle schema & queries
    ├── auth.ts            # Auth utilities
    ├── activity.ts        # Activity logging
    └── config.ts          # Config utilities
```

## Development Progress

See [docs/PROGRESS.md](docs/PROGRESS.md) for detailed progress tracking.

- **Phase 1:** Foundation ✅
- **Phase 2:** Memory + Chat (in progress)
- **Phase 3:** Chat Polish
- **Phase 4:** Connectors + Triage
- **Phase 5:** Actions + Background

## Environment Variables

```bash
DATABASE_URL=             # PostgreSQL connection string
ADMIN_EMAIL=              # Single admin user email
RESEND_API_KEY=           # Resend.com API key for magic links
NEXT_PUBLIC_APP_URL=      # App URL (http://localhost:3333)
```
