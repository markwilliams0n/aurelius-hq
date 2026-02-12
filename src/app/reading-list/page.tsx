import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReadingListClient } from "./reading-list-client";

export default async function ReadingListPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <ReadingListClient />;
}
