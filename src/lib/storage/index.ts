import "server-only";
import { createLocalStorage } from "./local";
import { createS3Storage } from "./s3";

export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

/**
 * Object-storage abstraction. File bytes never pass through PostgreSQL; the database only holds
 * metadata and the object key.
 *
 * - `s3`: any S3-compatible service (AWS S3, Cloudflare R2, MinIO...). Browsers upload and download
 *   directly using short-lived presigned URLs, so large files bypass the serverless function limits.
 * - `local`: stores files on disk for development and e2e tests only. Refused in production.
 */
export interface StorageDriver {
  kind: "s3" | "local";
  createUploadTarget(input: { key: string; contentType: string; attachmentId: string }): Promise<UploadTarget>;
  /** Size of the stored object, or null if it does not exist. */
  head(key: string): Promise<{ sizeBytes: number } | null>;
  remove(key: string): Promise<void>;
  /** Short-lived direct download URL (s3), or null when the app streams the file itself (local). */
  createDownloadUrl(key: string, fileName: string): Promise<string | null>;
}

export interface LocalStorageDriver extends StorageDriver {
  kind: "local";
  write(key: string, body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<number>;
  read(key: string): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number } | null>;
}

const globalForStorage = globalThis as unknown as { __storage?: StorageDriver };

export function createStorage(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const driver = env.STORAGE_DRIVER ?? (env.S3_BUCKET ? "s3" : "local");
  if (driver === "s3") return createS3Storage(env);
  if (driver === "local") {
    if (env.NODE_ENV === "production") {
      throw new Error("STORAGE_DRIVER=local is for development only. Configure S3_* variables for production.");
    }
    return createLocalStorage(env.LOCAL_STORAGE_DIR ?? ".data/uploads");
  }
  throw new Error(`Unknown STORAGE_DRIVER "${driver}" (expected "s3" or "local").`);
}

export function getStorage(): StorageDriver {
  globalForStorage.__storage ??= createStorage();
  return globalForStorage.__storage;
}

export function isLocalStorage(s: StorageDriver): s is LocalStorageDriver {
  return s.kind === "local";
}
