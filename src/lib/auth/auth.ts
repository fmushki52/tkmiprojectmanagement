import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@/db";

const withProtocol = (host: string | undefined) => (host ? (host.startsWith("http") ? host : `https://${host}`) : undefined);

/**
 * Public URL of the deployment. BETTER_AUTH_URL wins; on Vercel the production domain / deployment URL
 * (system environment variables) are used automatically so a missing BETTER_AUTH_URL does not break sign-in.
 */
function appUrls() {
  const configured = process.env.BETTER_AUTH_URL || undefined;
  const vercel = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL].map(withProtocol);
  const all = [configured, ...vercel].filter((u): u is string => !!u);
  return { baseURL: configured ?? vercel.find(Boolean), trusted: Array.from(new Set(all)) };
}

function createAuth() {
  const { baseURL, trusted } = appUrls();
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: trusted,
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // nextCookies must be the last plugin so server actions can set the session cookie.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __auth?: Auth };

/** Lazily created so importing this module never requires env vars (e.g. during `next build`). */
export function getAuth(): Auth {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
