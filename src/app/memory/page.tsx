import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MemoryClient } from "./memory-client";

export default async function MemoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <MemoryClient />;
}
