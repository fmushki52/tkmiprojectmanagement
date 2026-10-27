export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RULE";

/**
 * Expected, user-presentable failure. Anything that is not an AppError is treated as an
 * unexpected bug: it is logged server-side and surfaced to the user as a generic message.
 */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Please sign in to continue.");
export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError("FORBIDDEN", message);
/** Used instead of FORBIDDEN for resources outside the caller's workspace, so existence is not leaked. */
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const ruleViolation = (message: string) => new AppError("RULE", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
