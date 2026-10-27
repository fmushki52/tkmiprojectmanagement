import { redirect } from "next/navigation";
import { getSession } from "@/server/context";
import { listUserWorkspaces } from "@/server/services/workspaces";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const workspaces = await listUserWorkspaces(session.user.id);
  redirect(workspaces[0] ? `/w/${workspaces[0].slug}` : "/onboarding");
}
