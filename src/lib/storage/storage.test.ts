import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createStorage } from "./index";
import { createLocalStorage } from "./local";
import { MAX_ATTACHMENT_BYTES, attachmentDisposition, buildStorageKey, sanitizeFileName, validateUpload } from "./rules";
import { createS3Storage } from "./s3";

describe("sanitizeFileName", () => {
  it("drops paths, control chars and leading dots", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName(".htaccess")).toBe("htaccess");
    expect(sanitizeFileName('a"b<c>|d.txt\u0000')).toBe("abcd.txt");
    expect(sanitizeFileName("   ")).toBe("file");
  });
  it("bounds length while keeping the extension", () => {
    const n = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith(".pdf")).toBe(true);
  });
});

describe("validateUpload", () => {
  it("accepts normal files and returns the sanitized name", () => {
    expect(validateUpload({ fileName: "dir/Spec v2.pdf", sizeBytes: 1024 })).toBe("Spec v2.pdf");
  });
  it("rejects empty, oversized and active-content files", () => {
    expect(() => validateUpload({ fileName: "a.txt", sizeBytes: 0 })).toThrow(/empty/);
    expect(() => validateUpload({ fileName: "a.txt", sizeBytes: MAX_ATTACHMENT_BYTES + 1 })).toThrow(/at most/);
    expect(() => validateUpload({ fileName: "evil.HTML", sizeBytes: 10 })).toThrow(/not allowed/);
    expect(() => validateUpload({ fileName: "logo.svg", sizeBytes: 10 })).toThrow(/not allowed/);
    expect(() => validateUpload({ fileName: "run.exe", sizeBytes: 10 })).toThrow(/not allowed/);
  });
});

describe("buildStorageKey / attachmentDisposition", () => {
  it("scopes keys by workspace and project and neutralises odd characters", () => {
    const key = buildStorageKey({ workspaceId: "w1", projectId: "p1", attachmentId: "a1", fileName: "Résumé final (1).pdf" });
    expect(key).toMatch(/^workspaces\/w1\/projects\/p1\/a1-[A-Za-z0-9._-]+$/);
    expect(key).not.toContain("..");
  });
  it("always produces an attachment disposition with an RFC 5987 name", () => {
    const d = attachmentDisposition('Résumé "x".pdf');
    expect(d).toMatch(/^attachment; filename="R_sum_ _x_\.pdf"; filename\*=UTF-8''/);
    expect(d).toContain("R%C3%A9sum%C3%A9");
  });
});

describe("createStorage", () => {
  it("refuses the local driver in production and unknown drivers", () => {
    expect(() => createStorage({ NODE_ENV: "production", STORAGE_DRIVER: "local" } as unknown as NodeJS.ProcessEnv)).toThrow(/development only/);
    expect(() => createStorage({ STORAGE_DRIVER: "ftp" } as unknown as NodeJS.ProcessEnv)).toThrow(/Unknown STORAGE_DRIVER/);
  });
  it("requires S3 settings", () => {
    expect(() => createStorage({ STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv)).toThrow(/S3_BUCKET/);
  });
});

describe("S3 driver presigning (offline: no network or real bucket involved)", () => {
  const storage = createS3Storage({
    S3_BUCKET: "tracker-files",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
    S3_SECRET_ACCESS_KEY: "secret-example",
    S3_ENDPOINT: "https://s3.example.test",
    S3_FORCE_PATH_STYLE: "true",
  } as unknown as NodeJS.ProcessEnv);

  it("creates a short-lived signed PUT URL for the exact key", async () => {
    const t = await storage.createUploadTarget({ key: "workspaces/w/projects/p/a-file.pdf", contentType: "application/pdf", attachmentId: "a" });
    const url = new URL(t.url);
    expect(url.origin).toBe("https://s3.example.test");
    expect(url.pathname).toBe("/tracker-files/workspaces/w/projects/p/a-file.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(t.method).toBe("PUT");
    expect(t.headers["Content-Type"]).toBe("application/pdf");
  });

  it("creates a 60-second download URL forced to download with a generic content type", async () => {
    const link = await storage.createDownloadUrl("workspaces/w/projects/p/a-file.pdf", "Plan v2.pdf");
    const url = new URL(link!);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment; filename="Plan v2\.pdf"/);
  });
});

describe("local driver", () => {
  const dirs: string[] = [];
  const make = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pt-storage-"));
    dirs.push(dir);
    return { dir, storage: createLocalStorage(dir) };
  };
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });
  const body = (s: string) => new Response(s).body!;

  it("writes, reads, heads and removes objects", async () => {
    const { storage } = await make();
    expect(await storage.head("a/b.txt")).toBeNull();
    expect(await storage.write("a/b.txt", body("hello world"), 100)).toBe(11);
    expect(await storage.head("a/b.txt")).toEqual({ sizeBytes: 11 });
    const file = await storage.read("a/b.txt");
    expect(await new Response(file!.stream).text()).toBe("hello world");
    await storage.remove("a/b.txt");
    expect(await storage.head("a/b.txt")).toBeNull();
    await storage.remove("a/b.txt"); // idempotent
  });

  it("rejects keys that escape the storage directory", async () => {
    const { storage } = await make();
    await expect(storage.write("../escape.txt", body("x"), 10)).rejects.toThrow(/Invalid storage key/);
    await expect(storage.head("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });

  it("aborts and cleans up when the size limit is exceeded", async () => {
    const { dir, storage } = await make();
    await expect(storage.write("big.bin", body("0123456789"), 5)).rejects.toThrow();
    expect(await storage.head("big.bin")).toBeNull();
    expect(await readdir(dir)).toEqual([]);
    await storage.write("ok.bin", body("12345"), 5);
    expect((await readFile(path.join(dir, "ok.bin"))).toString()).toBe("12345");
  });
});
