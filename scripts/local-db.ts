/**
 * Local-only Postgres for development and Playwright e2e runs when you do not have
 * a Neon branch handy: an embedded PGlite instance exposed over the Postgres wire protocol.
 *
 *   npm run db:local            -> in-memory, listens on 127.0.0.1:5433
 *   PGLITE_DIR=.data/pg npm run db:local   -> persisted to disk
 *
 * Point DATABASE_URL at postgresql://postgres:postgres@127.0.0.1:5433/postgres.
 * Migrations are applied on start. This is NOT used in production.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const port = Number(process.env.PGLITE_PORT ?? 5433);

async function main() {
  const db = new PGlite(process.env.PGLITE_DIR || undefined);
  await db.waitReady;
  await migrate(drizzle(db), { migrationsFolder: "./drizzle" });

  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  console.log(`PGlite listening on postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
