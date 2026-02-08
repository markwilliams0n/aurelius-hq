import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CodeSessionsClient } from "./code-sessions-client";

export default async function CodePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <CodeSessionsClient />;
}
