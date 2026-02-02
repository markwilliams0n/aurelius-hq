import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TriageClient } from "./triage-client";

export default async function TriagePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <TriageClient />;
}
