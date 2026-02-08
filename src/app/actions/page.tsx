import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ActionsClient } from "./actions-client";

export default async function ActionsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <ActionsClient />;
}
