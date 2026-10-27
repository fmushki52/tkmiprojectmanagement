import { ZodError, type ZodType } from "zod";
import { AppError } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Wraps a server action body: expected failures (validation, permission, business rules) become
 * `{ ok: false }` with a user-presentable message; anything else is logged and reported generically.
 */
export async function runAction<T = undefined>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(e) };
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    // Next.js control-flow errors (redirect/notFound) must propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error("[action] unexpected error", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Parses untrusted client input on the server. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}
