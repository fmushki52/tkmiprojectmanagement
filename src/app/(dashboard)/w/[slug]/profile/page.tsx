import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileForm } from "@/features/auth/profile-form";
import { ROLE_LABELS } from "@/lib/permissions";
import { getWorkspaceCtx } from "@/server/context";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfilePage({ params }: PageProps<"/w/[slug]/profile">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  return (
    <>
      <PageHeader title="Profile settings" description={`Your role in ${ws.workspaceName}: ${ROLE_LABELS[ws.role]}`} />
      <ProfileForm key={ws.user.name} name={ws.user.name} email={ws.user.email} />
    </>
  );
}
