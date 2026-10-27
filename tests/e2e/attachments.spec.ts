import { expect, test } from "@playwright/test";
import { createProject, createWorkspace, newUser, signUp } from "./helpers";

// Uses the local storage driver (the default when S3_BUCKET is unset in development).
test("upload, download, isolate and delete a project attachment", async ({ page, browser }) => {
  await signUp(page, newUser("files"));
  const slug = await createWorkspace(page, "Files Co");
  const projectId = await createProject(page, "Docs project", "2026-01-01", "2030-12-31");

  await page.getByRole("link", { name: "Files", exact: true }).click();
  await expect(page.getByText("No files attached")).toBeVisible();
  const content = `hello attachment ${Date.now()}`;
  await page.getByLabel("Choose files to attach").setInputFiles({ name: "notes final.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(page.getByText("notes final.txt uploaded")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download notes final.txt" })).toBeVisible();

  // Download through the authorized route: exact bytes, forced download, no sniffing.
  const href = await page.getByRole("link", { name: "Download notes final.txt" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe(content);
  expect(res.headers()["content-disposition"]).toContain('attachment; filename="notes final.txt"');
  expect(res.headers()["content-type"]).toBe("application/octet-stream");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");

  // Persisted across reload.
  await page.reload();
  await expect(page.getByText("notes final.txt")).toBeVisible();

  // Blocked type is refused with a clear message.
  await page.getByLabel("Choose files to attach").setInputFiles({ name: "page.html", mimeType: "text/html", buffer: Buffer.from("<script>1</script>") });
  await expect(page.getByText("Files of type .html are not allowed.")).toBeVisible();

  // Another workspace's user cannot download it.
  const other = await browser.newContext();
  const op = await other.newPage();
  await signUp(op, newUser("snoop"));
  await createWorkspace(op, "Snoop Co");
  expect((await op.request.get(href!)).status()).toBe(404);
  await other.close();
  const anon = await browser.newContext();
  expect((await (await anon.newPage()).request.get(href!)).status()).toBe(401);
  await anon.close();

  // Task-level attachment inside the task sheet.
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Quick add task title").fill("Review spec");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Review spec", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Choose files to attach").setInputFiles({ name: "spec.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expect(page.getByText("spec.pdf uploaded")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Download spec.pdf" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Project Files tab lists both and names the task for the task file.
  await page.goto(`/w/${slug}/projects/${projectId}?tab=files`);
  await expect(page.getByText("on “Review spec”")).toBeVisible();

  // Delete with confirmation; the file is gone from the list and from storage.
  await page.getByRole("button", { name: "Delete notes final.txt" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Attachment deleted")).toBeVisible();
  await expect(page.getByText("notes final.txt")).toHaveCount(0);
  expect((await page.request.get(href!)).status()).toBe(404);
});
