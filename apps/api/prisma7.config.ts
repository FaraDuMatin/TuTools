import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Single source of truth for env is the monorepo root .env, so the Postgres
// credentials in docker-compose.yml and DATABASE_URL can never drift apart.
config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
