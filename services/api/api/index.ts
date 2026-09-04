import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";
import { assertAuthConfigured } from "../src/middleware/auth.js";

export const config = {
  runtime: "nodejs",
};

assertAuthConfigured();

if (process.env.VERCEL && !process.env.DATABASE_URL) {
  console.warn(
    "[persist] Vercel requires DATABASE_URL (Postgres/Neon). SQLite is not durable on serverless.",
  );
}

const app = createApp();

export default handle(app);
