import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await getSession();

  if (session) {
    redirect("/triage");
  }

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
