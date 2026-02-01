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
              />
              <NavCard
                href="/chat"
                title="Chat"
                description="Talk to Aurelius"
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
