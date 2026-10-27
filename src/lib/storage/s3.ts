import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentDisposition } from "./rules";
import type { StorageDriver } from "./index";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return v;
}

/**
 * S3-compatible driver. Set S3_ENDPOINT (and usually S3_FORCE_PATH_STYLE=true) for R2/MinIO.
 * The bucket must NOT be public, and needs a CORS rule allowing PUT from the app origin (see README).
 */
export function createS3Storage(env: NodeJS.ProcessEnv): StorageDriver {
  const bucket = required(env, "S3_BUCKET");
  const client = new S3Client({
    region: env.S3_REGION ?? "auto",
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: required(env, "S3_ACCESS_KEY_ID"), secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY") },
    // Avoid adding checksum params to presigned URLs, which browsers cannot satisfy.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    kind: "s3",
    async createUploadTarget({ key, contentType }) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      });
      return { url, method: "PUT", headers: { "Content-Type": contentType } };
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { sizeBytes: Number(r.ContentLength ?? 0) };
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (e as { name?: string }).name === "NotFound") return null;
        throw e;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async createDownloadUrl(key, fileName) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          // Always a download with a generic type, so uploaded content can never render in the app's origin.
          ResponseContentDisposition: attachmentDisposition(fileName),
          ResponseContentType: "application/octet-stream",
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
      );
    },
  };
}
