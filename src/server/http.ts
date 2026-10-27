import { AppError } from "@/lib/errors";

const STATUS = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, RULE: 422 } as const;

/** Maps an error from a route handler to a JSON response; unexpected errors are logged, not leaked. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) return Response.json({ error: e.message }, { status: STATUS[e.code] });
  console.error("[route] unexpected error", e);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
