import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import type { LocalStorageDriver } from "./index";

/** Development/test driver: files live under `dir`, and the app itself serves uploads and downloads. */
export function createLocalStorage(dir: string): LocalStorageDriver {
  const root = path.resolve(dir);
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };

  return {
    kind: "local",
    async createUploadTarget({ attachmentId, contentType }) {
      return { url: `/api/attachments/${attachmentId}/blob`, method: "PUT", headers: { "Content-Type": contentType } };
    },
    async head(key) {
      const file = resolve(key); // throws on keys that escape the directory
      try {
        return { sizeBytes: (await stat(file)).size };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
    async createDownloadUrl() {
      return null;
    },
    async write(key, body, maxBytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      if (!body) throw new Error("Empty upload");
      let written = 0;
      const out = createWriteStream(file);
      const sink = Writable.toWeb(out);
      const limited = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          written += chunk.byteLength;
          if (written > maxBytes) {
            controller.error(new Error("Upload exceeds the size limit"));
            return;
          }
          controller.enqueue(chunk);
        },
      });
      try {
        await body.pipeThrough(limited).pipeTo(sink as WritableStream<Uint8Array>);
      } catch (e) {
        // Wait for the file handle to close before removing, otherwise the half-open file can reappear.
        out.destroy();
        if (!out.closed) await new Promise<void>((r) => out.once("close", () => r()));
        await rm(file, { force: true });
        throw e;
      }
      return written;
    },
    async read(key) {
      const file = resolve(key);
      try {
        const { size } = await stat(file);
        return { stream: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, sizeBytes: size };
      } catch {
        return null;
      }
    },
  };
}
