import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { MessageSquare, Brain, Activity, Settings, Inbox, CheckSquare } from "lucide-react";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-4xl text-gold mb-4">Aurelius</h1>
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
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Navigation */}
      <aside className="w-16 border-r border-border bg-background flex flex-col items-center py-4 gap-2">
        <Link href="/" className="mb-4">
          <div className="w-10 h-10 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
            <span className="font-serif text-gold text-lg">A</span>
          </div>
        </Link>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-4xl mx-auto">
          <h1 className="font-serif text-3xl text-gold mb-2">
            Welcome back
          </h1>
          <p className="text-muted-foreground mb-8">
            Your personal AI command center is ready.
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <NavCard
              href="/chat"
              title="Chat"
              description="Talk to Aurelius"
              icon={MessageSquare}
            />
            <NavCard
              href="/memory"
              title="Memory"
              description="Browse knowledge graph"
              icon={Brain}
            />
            <NavCard
              href="/system"
              title="System"
              description="Activity & controls"
              icon={Activity}
            />
            <NavCard
              href="/triage"
              title="Triage"
              description="Process incoming items"
              icon={Inbox}
              disabled
            />
            <NavCard
              href="/actions"
              title="Actions"
              description="Your task list"
              icon={CheckSquare}
              disabled
            />
            <NavCard
              href="/settings"
              title="Settings"
              description="Configure Aurelius"
              icon={Settings}
              disabled
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
  icon: Icon,
  disabled,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Card className="opacity-50 cursor-not-allowed">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
              <Icon className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-gold" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
