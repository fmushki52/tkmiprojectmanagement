import type { Metadata } from "next";
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form";
import { requireUser } from "@/server/context";

export const metadata: Metadata = { title: "Create workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireUser();
  return <CreateWorkspaceForm />;
}
