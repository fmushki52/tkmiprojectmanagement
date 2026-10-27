import { vi } from "vitest";

/**
 * Registered as a vitest setup file: every integration test file gets `getDb()` routed to the
 * PGlite instance stored on `globalThis.__TEST_DB__` (created in each file's beforeAll).
 */
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    schema,
    getDb: () => {
      const db = (globalThis as { __TEST_DB__?: unknown }).__TEST_DB__;
      if (!db) throw new Error("Test database not initialised: call useTestDb() in beforeAll");
      return db;
    },
  };
});
