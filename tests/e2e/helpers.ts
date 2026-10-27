import { type Page, expect } from "@playwright/test";

let n = 0;
/** Unique, throwaway test identity per call (never reused, never a real address). */
export function newUser(label = "user") {
  const id = `${label}-${Date.now().toString(36)}-${++n}`;
  return { name: `E2E ${label} ${n}`, email: `${id}@example.test`, password: `Pw-${id}-Aa1!` };
}

export async function signUp(page: Page, u: ReturnType<typeof newUser>) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(u.name);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

export async function createWorkspace(page: Page, name: string) {
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  return new URL(page.url()).pathname.split("/")[2];
}

export async function createProject(page: Page, title: string, start: string, end: string) {
  await page.getByRole("button", { name: "New project" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Start date", { exact: true }).fill(start);
  await dialog.getByLabel("Planned end date").fill(end);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[4];
}
