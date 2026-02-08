import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import VaultClient from "./vault-client";

export default async function VaultPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <VaultClient />;
}
