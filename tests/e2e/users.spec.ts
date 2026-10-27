import { expect, test } from "@playwright/test";
import { createProject, createWorkspace, newUser, signUp } from "./helpers";

test("owner manages users and roles; non-owners cannot", async ({ page, browser }) => {
  const owner = newUser("boss");
  await signUp(page, owner);
  const slug = await createWorkspace(page, "People Co");

  await page.getByRole("link", { name: "User Management" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "User Management" })).toBeVisible();
  await expect(page.getByText("Roles & permissions")).toBeVisible();
  // The owner's own row has no role selector or remove button.
  await expect(page.getByRole("row", { name: /\(you\)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  // Create a user with the Viewer role.
  const teammate = newUser("viewer");
  await page.getByRole("button", { name: "Create user" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Full name").fill(teammate.name);
  await d.getByLabel("Email").fill(teammate.email);
  await d.getByLabel("Temporary password").fill("short");
  await d.getByRole("button", { name: "Create user" }).click();
  await expect(d.getByText("Use at least 8 characters")).toBeVisible();
  await d.getByLabel("Temporary password").fill(teammate.password);
  await d.getByLabel("Role").selectOption("viewer");
  await d.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText("User created")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(teammate.email) })).toBeVisible();

  // Duplicate email is rejected with a clear message.
  await page.getByRole("button", { name: "Create user" }).click();
  const d2 = page.getByRole("dialog");
  await d2.getByLabel("Full name").fill("Dup");
  await d2.getByLabel("Email").fill(teammate.email);
  await d2.getByLabel("Temporary password").fill("another-Pass-1");
  await d2.getByRole("button", { name: "Create user" }).click();
  await expect(d2.getByText(/already exists/)).toBeVisible();
  await page.keyboard.press("Escape");

  // The new user can sign in and is a read-only member without User Management.
  const ctx = await browser.newContext();
  const vp = await ctx.newPage();
  await vp.goto("/sign-in");
  await vp.getByLabel("Email").fill(teammate.email);
  await vp.getByLabel("Password").fill(teammate.password);
  await vp.getByRole("button", { name: "Sign in" }).click();
  await expect(vp).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(vp.getByRole("link", { name: "User Management" })).toHaveCount(0);
  await expect(vp.getByRole("button", { name: "New project" })).toHaveCount(0);
  expect((await vp.goto(`/w/${slug}/users`))?.status()).toBe(404);

  // Promote to Project manager: persists, and the new capabilities appear after a reload.
  await page.getByLabel(`Role of ${teammate.name}`).selectOption("project_manager");
  await expect(page.getByText(`${teammate.name} is now Project manager`)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`Role of ${teammate.name}`)).toHaveValue("project_manager");
  await vp.goto(`/w/${slug}/projects`);
  await expect(vp.getByRole("button", { name: "New project" }).first()).toBeVisible();
  await createProject(vp, "Created by PM", "2026-01-01", "2030-12-31");
  expect((await vp.goto(`/w/${slug}/users`))?.status()).toBe(404); // still not an owner

  // Filter, then remove the member; they lose access immediately.
  await page.getByLabel("Filter by role").selectOption("project_manager");
  await expect(page.getByRole("row", { name: new RegExp(teammate.email) })).toBeVisible();
  await expect(page.getByRole("row", { name: /\(you\)/ })).toHaveCount(0);
  await page.getByLabel("Filter by role").selectOption("");
  await page.getByRole("button", { name: `Remove ${teammate.name}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Member removed")).toBeVisible();
  expect((await vp.goto(`/w/${slug}/projects`))?.status()).toBe(404);
  await ctx.close();
});
