import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { notFound } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type { RiskInput } from "@/lib/validation";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { requireProject } from "./projects";
import { assertWorkspaceMembers } from "./workspaces";

const { risks, user } = schema;

export async function listRisks(ctx: Ctx, projectId: string) {
  const db = getDb();
  await requireProject(db, ctx, projectId);
  return db
    .select({ risk: risks, ownerName: user.name })
    .from(risks)
    .leftJoin(user, eq(user.id, risks.ownerId))
    .where(and(eq(risks.workspaceId, ctx.workspaceId), eq(risks.projectId, projectId)))
    .orderBy(
      sql`CASE ${risks.status} WHEN 'open' THEN 0 WHEN 'mitigating' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END`,
      sql`CASE ${risks.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      asc(risks.createdAt),
    );
}

export async function createRisk(ctx: Ctx, projectId: string, input: RiskInput) {
  assertCan(ctx.role, "risk:write");
  return getDb().transaction(async (tx) => {
    await requireProject(tx, ctx, projectId);
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId]);
    const [r] = await tx
      .insert(risks)
      .values({ ...input, workspaceId: ctx.workspaceId, projectId, createdById: ctx.userId, resolvedAt: input.status === "resolved" ? new Date() : null })
      .returning();
    await logActivity(tx, ctx, { projectId, entityType: "risk", entityId: r.id, action: "created", metadata: { title: r.title, kind: r.kind } });
    return r;
  });
}

export async function updateRisk(ctx: Ctx, riskId: string, input: RiskInput) {
  assertCan(ctx.role, "risk:write");
  return getDb().transaction(async (tx) => {
    const [prev] = await tx.select().from(risks).where(and(eq(risks.id, riskId), eq(risks.workspaceId, ctx.workspaceId)));
    if (!prev) throw notFound("Risk");
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId]);
    const resolvedNow = input.status === "resolved";
    const [r] = await tx
      .update(risks)
      .set({ ...input, resolvedAt: resolvedNow ? (prev.resolvedAt ?? new Date()) : null })
      .where(eq(risks.id, riskId))
      .returning();
    await logActivity(tx, ctx, {
      projectId: r.projectId, entityType: "risk", entityId: r.id,
      action: prev.status !== "resolved" && resolvedNow ? "resolved" : "updated",
      metadata: { title: r.title, kind: r.kind },
    });
    return r;
  });
}

export async function deleteRisk(ctx: Ctx, riskId: string) {
  assertCan(ctx.role, "update:moderate");
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(risks).where(and(eq(risks.id, riskId), eq(risks.workspaceId, ctx.workspaceId)));
    if (!r) throw notFound("Risk");
    await tx.delete(risks).where(eq(risks.id, riskId));
    await logActivity(tx, ctx, { projectId: r.projectId, entityType: "risk", entityId: r.id, action: "deleted", metadata: { title: r.title, kind: r.kind } });
  });
}
