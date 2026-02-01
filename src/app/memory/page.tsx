import { Header } from "@/components/aurelius/header";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllMemory } from "@/lib/memory/search";
import { MemoryBrowser } from "@/components/aurelius/memory-browser";

export default async function MemoryPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const memory = await getAllMemory();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-serif text-3xl text-gold mb-2">Memory</h1>
          <p className="text-muted-foreground mb-8">
            Browse and search Aurelius&apos;s knowledge graph
          </p>

          <MemoryBrowser initialMemory={memory} />
        </div>
      </main>
    </div>
  );
}
