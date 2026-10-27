/**
 * Applies SQL migrations from ./drizzle. Run explicitly: `npm run db:migrate`.
 * Never invoked automatically at app start-up or during `next build`.
 */
import { config } from "dotenv";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool as PgPool } from "pg";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

  if (local) {
    const pool = new PgPool({ connectionString: url, max: 1 });
    await migratePg(drizzlePg(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
  } else {
    const pool = new NeonPool({ connectionString: url, max: 1 });
    await migrateNeon(drizzleNeon(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
  }
  console.log(`Migrations applied to ${host}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
