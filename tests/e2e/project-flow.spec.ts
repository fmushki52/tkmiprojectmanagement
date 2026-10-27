import { expect, test } from "@playwright/test";
import { createProject, createWorkspace, newUser, signUp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("sign up → workspace → project → milestone → tasks → progress → update → exports → persistence", async ({ page, browser }) => {
  // Component-library misuse (e.g. a non-button used as a button trigger) is reported as a console error.
  const libraryErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && /Base UI|Warning:|hydrat/i.test(m.text()) && libraryErrors.push(m.text().slice(0, 200)));
  const user = newUser("owner");
  await signUp(page, user);
  const slug = await createWorkspace(page, "E2E Studio");
  await expect(page.getByRole("heading", { name: "Welcome to E2E Studio" })).toBeVisible();

  // Project with validation: end before start is rejected inline.
  await page.getByRole("button", { name: "New project" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Website relaunch");
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-03-10");
  await dialog.getByLabel("Planned end date").fill("2026-03-01");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText("End date cannot be before the start date")).toBeVisible();
  await dialog.getByLabel("Planned end date").fill("2030-12-31");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split("/")[4];

  // Editing a project (it has an owner whose id is not a UUID) saves and shows the new scope.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Scope").fill("In scope: new marketing site.");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden(); // closes only after the server accepted the change
  await page.reload();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog").getByLabel("Scope")).toHaveValue("In scope: new marketing site.");
  await page.keyboard.press("Escape");

  // The delete confirmation opens from the overflow menu (and can be cancelled).
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: /Delete project/ }).click();
  await expect(page.getByRole("alertdialog")).toContainText("permanently");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Milestone.
  await page.getByRole("link", { name: "Milestones" }).click();
  await page.getByRole("button", { name: "Add milestone" }).click();
  const md = page.getByRole("dialog");
  await md.getByLabel("Title").fill("Design complete");
  await md.getByLabel("Planned due date").fill("2030-06-30");
  await md.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByRole("heading", { name: "Design complete" })).toBeVisible();

  // Tasks via quick add (attached to the milestone).
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  for (const title of ["Wireframes", "Visual design"]) {
    await page.getByLabel("Quick add task title").fill(title);
    await page.getByLabel("Milestone for quick add").selectOption({ label: "Design complete" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  }

  // Open a task, assign it to the owner and give it a due date + estimate.
  await page.getByRole("button", { name: "Wireframes", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Title")).toHaveValue("Wireframes");
  await sheet.getByLabel("Assignee").selectOption({ label: user.name });
  await sheet.getByLabel("Due date").fill("2030-05-01");
  await sheet.getByLabel("Estimated effort (hours)").fill("8");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Task updated")).toBeVisible();

  // Update progress: complete one task from the list view.
  await page.getByRole("button", { name: "List" }).click();
  await page.getByLabel("Status of Wireframes").selectOption("done");
  await expect(page.getByText("Status updated")).toBeVisible();

  // Calculated progress: 1 of 2 tasks done => milestone and project at 50%.
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("1 of 2 tasks done")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Overall project progress" })).toHaveAttribute("aria-valuenow", "50");

  // Reload: persisted.
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Overall project progress" })).toHaveAttribute("aria-valuenow", "50");
  await page.getByRole("link", { name: "Milestones" }).click();
  await expect(page.getByText("1/2 tasks done · calculated")).toBeVisible();

  // Project update + activity history.
  await page.getByRole("link", { name: "Updates" }).click();
  await page.getByRole("button", { name: "Publish update" }).click();
  const ud = page.getByRole("dialog");
  await ud.getByLabel("Title").fill("Week 1 status");
  await ud.getByLabel("Progress summary").fill("Wireframes are done.");
  await ud.getByRole("button", { name: "Publish update" }).click();
  await expect(page.getByRole("heading", { name: "Week 1 status" })).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("published the update")).toBeVisible();

  // Exports use real data and the caller's session.
  const pdf = await page.request.get(`/api/projects/${projectId}/export?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const csv = await page.request.get(`/api/projects/${projectId}/export?format=tasks-csv`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain("Wireframes");
  expect(text).toContain("Visual design");
  expect(text.split("\r\n")[0]).toContain("Task ID,Title,Status");

  // Printable report page renders.
  await page.goto(`/w/${slug}/reports/${projectId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Website relaunch" })).toBeVisible();

  // Workspace isolation: a different user in a different workspace gets 404/401 for the same ids.
  const other = await browser.newContext();
  const op = await other.newPage();
  await signUp(op, newUser("intruder"));
  await createWorkspace(op, "Other Co");
  expect((await op.goto(`/w/${slug}/projects/${projectId}`))?.status()).toBe(404);
  expect((await op.request.get(`/api/projects/${projectId}/export?format=pdf`)).status()).toBe(404);
  expect((await op.request.get(`/api/projects/${projectId}/export?format=tasks-csv`)).status()).toBe(404);
  await other.close();

  // Signed-out requests are rejected.
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  expect((await ap.request.get(`/api/projects/${projectId}/export?format=pdf`)).status()).toBe(401);
  await ap.goto(`/w/${slug}/projects`);
  await expect(ap).toHaveURL(/\/sign-in/);
  await anon.close();

  // Sign out and back in.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Website relaunch/ }).first()).toBeVisible();
  expect(libraryErrors).toEqual([]);
});

test("kanban drag and drop persists to the database", async ({ page }) => {
  await signUp(page, newUser("kanban"));
  await createWorkspace(page, "Kanban Co");
  const projectId = await createProject(page, "Board test", "2026-01-01", "2030-12-31");
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Quick add task title").fill("Drag me");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const card = page.getByRole("button", { name: "Drag me", exact: true });
  await expect(card).toBeVisible();

  const handle = page.getByRole("button", { name: /Reorder Drag me/ });
  const target = page.getByRole("region", { name: "In progress column" });
  const hb = (await handle.boundingBox())!;
  const tb = (await target.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 20, hb.y + 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 120, { steps: 15 });
  await page.mouse.up();

  await expect(page.getByRole("region", { name: "In progress column" }).getByText("Drag me")).toBeVisible();
  // Reload to prove it was saved, not just moved on screen.
  await page.reload();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("region", { name: "In progress column" }).getByText("Drag me")).toBeVisible();
  const csv = await (await page.request.get(`/api/projects/${projectId}/export?format=tasks-csv`)).text();
  expect(csv).toMatch(/Drag me,in progress/);
});
