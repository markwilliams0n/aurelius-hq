import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <TasksClient />;
}
