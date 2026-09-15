import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env.local the way Next does.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: "snake_case",
});
