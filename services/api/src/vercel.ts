import { handle } from "hono/vercel";
import { createApp } from "./app.js";
import { assertAuthConfigured } from "./middleware/auth.js";

assertAuthConfigured();

const app = createApp();

export default handle(app);
