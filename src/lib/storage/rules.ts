import { ruleViolation } from "@/lib/errors";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Extensions that can execute or render active content. Files are always served as downloads
 * (`Content-Disposition: attachment`, generic content type, `nosniff`), but we also refuse to store them.
 */
const BLOCKED_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "svg", "js", "mjs", "exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "sh", "jar", "vbs", "apk",
]);

/** Strips path parts, control characters and risky punctuation; keeps a readable, bounded name. */
export function sanitizeFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const name = cleaned || "file";
  if (name.length <= 120) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
  return name.slice(0, 120 - ext.length) + ext;
}

export function validateUpload(input: { fileName: string; sizeBytes: number }): string {
  const name = sanitizeFileName(input.fileName);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw ruleViolation("The file is empty.");
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw ruleViolation(`Files can be at most ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (BLOCKED_EXTENSIONS.has(ext)) throw ruleViolation(`Files of type .${ext} are not allowed.`);
  return name;
}

/** Object key: scoped by workspace and project so keys can never collide or be guessed across tenants. */
export function buildStorageKey(parts: { workspaceId: string; projectId: string; attachmentId: string; fileName: string }): string {
  const safe = parts.fileName.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  return `workspaces/${parts.workspaceId}/projects/${parts.projectId}/${parts.attachmentId}-${safe}`;
}

/** RFC 5987 `Content-Disposition: attachment` value that is safe for any file name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()]/g, escape)}`;
}
