import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  // Use the *direct* (non-pooled) Neon connection string for migrations if you have one;
  // the pooled URL also works for drizzle-kit migrate.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
