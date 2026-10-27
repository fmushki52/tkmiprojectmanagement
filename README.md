# Project Tracker

Project management and progress tracking: workspaces with role-based access, projects, milestones, tasks (Kanban + list), calculated progress, charts, timeline, updates, risks, in-app notifications, and PDF/CSV/printable reports.

**Stack:** Next.js 16 (App Router, TypeScript) · React 19 · Tailwind 4 + shadcn/ui (Base UI) · Neon PostgreSQL via `@neondatabase/serverless` · Drizzle ORM · Better Auth · React Hook Form + Zod · Recharts · dnd-kit · date-fns · pdf-lib · Vitest + Playwright. No separate backend server.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL, BETTER_AUTH_SECRET, ...
npm run db:migrate              # apply SQL migrations (explicit, never automatic)
npm run dev                     # http://localhost:3000
```

`DATABASE_URL` may be a Neon pooled URL (uses the Neon WebSocket driver, so transactions work on Vercel) or a `localhost` Postgres URL (uses `pg`). No Postgres handy? `npm run db:local` starts an embedded PGlite on `127.0.0.1:5433`.

| Command | Purpose |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit + integration tests (integration runs the real migrations on in-process PGlite) |
| `npm run test:e2e` | Playwright (needs the app + a database; `PW_CHANNEL=msedge` uses an installed browser) |
| `npm run db:generate` | Create a migration from schema changes (`drizzle/`, commit it) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

## Architecture

```
src/app/            routes: (auth), (dashboard)/w/[slug]/..., api/ (auth, exports, cron)
src/features/*      server actions + client UI per feature (projects, milestones, tasks, collab, ...)
src/server/services business logic + queries; every function takes a Ctx {userId, workspaceId, role}
src/server/context  session -> membership -> Ctx (the only producer of Ctx)
src/lib/            pure, tested logic: progress/, permissions/, validation/, transitions, exports/
src/db/schema/      Drizzle schema (auth, workspace, project, collab)
drizzle/            versioned SQL migrations
```

### Security model
- Every page, server action and route handler re-validates the session and **workspace membership on the server**; `proxy.ts` is only an optimistic redirect.
- Actions accept only entity ids; the workspace is derived from the row (`getCtxByProjectId`, `getCtxByEntity`) and membership in *that* workspace is verified. Every service query also filters by `ctx.workspaceId`. Foreign/unknown ids return 404 (no existence leak).
- Role capability matrix: `src/lib/permissions/index.ts` (owner, project manager, contributor, viewer), enforced in services via `assertCan`. UI hiding is cosmetic.
- All input is re-validated with Zod on the server. CSV exports neutralise formula injection.

### Progress rules (`src/lib/progress`, documented in code and tests)
- Task: done = 100; else explicit `progress` override; else status default (backlog 0, todo 0, in progress 50, blocked 0).
- Only leaf tasks count (parents are represented by their subtasks). Weighting is `equal` or `effort` (estimate hours; missing estimates get the mean; no estimates → equal), set per project.
- Milestone = weighted average of its tasks (calculated). Manual mode is explicit and labelled "manual". Empty calculated milestone: 0% (100% if completed).
- Project = weighted average of milestones; tasks without a milestone form one implicit bucket. Empty → 0, never divides by zero.
- Calculated milestones follow their tasks: completing the last task completes the milestone (notifying the team); reopening a task reopens it.
- **Health** (`health.ts`): deterministic On track / At risk / Off track from schedule slip, overdue milestones/tasks, blocked tasks and critical risks, with the reasons shown. Setting health on a project is a manual override, labelled as such.
- **Planned vs actual** (`burnup.ts`) is built only from task due dates and real completion timestamps; with fewer than 2 dated tasks it says there isn't enough data instead of inventing a curve.

### Other design decisions
- Published updates are append-only: edit = new revision (old one kept, marked superseded); delete = retract with actor + reason. Both are audited in `activity_logs`.
- Notifications: persistent in-app rows created by one `notify()` function (add email there later). Deadline/overdue notices are generated lazily on page load and by the daily Vercel cron `/api/cron/deadlines` (idempotent).
- Kanban moves are persisted server-side (`moveTask`), with fractional positions computed from stored column order.
- Deleting a project cascades; archiving is the reversible alternative. Deleting a milestone keeps its tasks (unassigned).

## User management and roles

`/w/<workspace>/users` (owners only; other roles get a 404, and every service call re-checks `member:manage`):
- Members table with workload (projects owned, open tasks), search, role filter, inline role changes and removal.
- **Create user:** creates a brand-new sign-in account with a temporary password and adds it to the workspace. It goes through Better Auth's internal adapter so the owner's session is untouched, and it never changes an existing account's password (so an owner cannot take over an account that belongs to other workspaces). There is no password reset or forced password change yet.
- **Add existing user** by email, for people who already have an account.
- Guardrails: a workspace always keeps at least one owner; you cannot remove yourself or change your own role from this screen; removing a member clears their task assignments and project ownerships but does not delete their account.
- The roles and permissions matrix on the page is generated from the same `can()` rules the server enforces (a unit test fails if a capability is missing from it).

## File attachments

Files are stored in object storage, never in PostgreSQL; the `attachments` table holds metadata and the object key (`workspaces/<ws>/projects/<project>/<id>-<name>`). Max 25 MB per file; executable/active-content types (.html, .svg, .js, .exe, ...) are refused.

- **Upload (two-phase):** the server authorizes the request and creates a *pending* row plus a 5-minute presigned PUT URL; the browser uploads straight to the bucket (large files bypass serverless body limits); then the server verifies the stored object (exists, exact declared size) before the file becomes visible. Mismatches are deleted. Abandoned pending uploads are purged by the daily cron.
- **Download:** `GET /api/attachments/:id/download` checks the caller's workspace membership, then redirects to a 60-second presigned URL that forces `Content-Disposition: attachment` and a generic content type. Nothing is ever served inline.
- **Permissions:** contributors and above can upload; the uploader or a project manager/owner can delete; any member can download. Deleting a task, project or workspace also deletes its stored objects (best effort, logged on failure).
- **Drivers:** `s3` (any S3-compatible service) or `local` (development/e2e only, files in `.data/uploads`; refused when `NODE_ENV=production`). Without `S3_BUCKET` the local driver is used in development.

Bucket setup (S3/R2/MinIO): keep it private, create an access key limited to PutObject, GetObject, DeleteObject and HeadObject on that bucket, and add a CORS rule so browsers can PUT directly:

```json
[{ "AllowedOrigins": ["https://your-app.example.com", "http://localhost:3000"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3000 }]
```

## Deploying to Vercel + Neon
1. Create a Neon project with separate branches/databases for development, preview and production. Use the **pooled** connection string as `DATABASE_URL` in each Vercel environment (Production / Preview / Development).
2. Set env vars in Vercel (Project → Settings → Environment Variables): `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (the deployment URL), `CRON_SECRET`, and `STORAGE_DRIVER=s3` with the `S3_*` variables from `.env.example`.
3. Run migrations explicitly against each database before/after deploying: `DATABASE_URL=<that db> npm run db:migrate`. Migrations are never run on app start or build.
4. Deploy. `vercel.json` registers the daily deadline cron. PDF export uses pdf-lib (pure JS), so it runs in the Node.js runtime without native dependencies.

## Not implemented / known limitations
- **Attachments against a real bucket:** the S3 driver is verified offline (presigned URL generation) and the full flow through the app uses the local driver and an in-memory fake, but it has **not been run against a real S3/R2/MinIO bucket**. Check credentials and the CORS rule after configuring. No virus scanning, previews or per-workspace storage quota.
- **Email notifications** and **invitations to unregistered users** (members are added by email if they already have an account). No password reset or email verification flow.
- Live chat is not implemented (the activity feed and comments are not real-time).
- Gantt-style timeline is read-only and does not draw dependency arrows (dependencies are listed per task).
- Not verified against a real Neon database or a Vercel deployment: the Neon WebSocket driver path is implemented per its docs but only the `pg`/PGlite paths were exercised here.
