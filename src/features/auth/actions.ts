"use server";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/auth";
import { profileSchema } from "@/lib/validation";
import { requireUserOrThrow } from "@/server/context";
import { parse, runAction } from "@/server/action";

export async function updateProfileAction(input: unknown) {
  return runAction(async () => {
    await requireUserOrThrow();
    const { name } = parse(profileSchema, input);
    await getAuth().api.updateUser({ headers: await headers(), body: { name } });
  });
}
