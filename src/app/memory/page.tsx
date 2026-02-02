import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllMemory } from "@/lib/memory/search";
import { MemoryClient } from "./memory-client";

export default async function MemoryPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const memory = await getAllMemory();

  return <MemoryClient initialMemory={memory} />;
}
