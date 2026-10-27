import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

/** Driver-agnostic database type shared by the Neon, node-postgres and PGlite (tests) drivers. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle; accepted anywhere a `Db` is, so services compose inside transactions. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __db?: Db };

function isLocalUrl(url: string) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function create(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  // Neon (pooled URL) over WebSockets so interactive transactions work on Vercel.
  // A local URL (Docker/local Postgres, or the PGlite socket used by e2e tests) uses node-postgres.
  if (isLocalUrl(url)) {
    return drizzlePg(new PgPool({ connectionString: url, max: 5 }), { schema }) as unknown as Db;
  }
  return drizzleNeon(new NeonPool({ connectionString: url }), { schema }) as unknown as Db;
}

/** Lazily created singleton so importing this module never needs env vars (e.g. during `next build`). */
export function getDb(): Db {
  globalForDb.__db ??= create();
  return globalForDb.__db;
}

export { schema };
