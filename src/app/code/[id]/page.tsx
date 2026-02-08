import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CodeSessionDetail } from "./code-session-detail";

export default async function CodeSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  return <CodeSessionDetail cardId={id} />;
}
