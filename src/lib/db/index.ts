import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export type Database = ReturnType<typeof create>;

function create(url: string) {
  return drizzle(neon(url), { schema });
}

let cached: Database | null = null;

/**
 * Lazily built so that importing this module during `next build` — when no
 * database URL is present — does not throw.
 */
export function getDb(): Database {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Run `vercel env pull` after connecting Neon, " +
        "or copy .env.example to .env.local and fill it in.",
    );
  }

  cached = create(url);
  return cached;
}

export { schema };
